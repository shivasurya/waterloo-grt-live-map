import { PbfReader } from 'pbf';
import { FeedMessage } from 'gtfs-realtime-pbf-js-module';

const API_URL = 'https://livemap.shivasurya.workers.dev/';

export async function fetchVehicles() {
  const url = `${API_URL}?cacheBust=${Date.now()}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = await response.arrayBuffer();
  const pbf = new PbfReader(new Uint8Array(buffer));
  const feed = FeedMessage.read(pbf);

  return feed.entity
    .filter((e) => e.vehicle?.position && e.vehicle?.trip)
    .map((e) => ({
      id: e.id,
      routeId: e.vehicle.trip.route_id,
      tripId: e.vehicle.trip.trip_id,
      directionId: e.vehicle.trip.direction_id,
      latitude: e.vehicle.position.latitude,
      longitude: e.vehicle.position.longitude,
      bearing: e.vehicle.position.bearing,
      speed: e.vehicle.position.speed,
      vehicleId: e.vehicle.vehicle?.id || e.id,
    }));
}

const ROUTE_COLORS = {
  '301': '#dc2626',
  '302': '#7c3aed',
  '201': '#7c3aed', '202': '#7c3aed', '204': '#7c3aed', '205': '#7c3aed', '206': '#7c3aed',
};

const PALETTE = [
  '#0ea5e9', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#a855f7', '#22d3ee', '#ef4444', '#3b82f6',
];

const assignedColors = {};
let colorIndex = 0;

export function getRouteColor(routeId) {
  if (ROUTE_COLORS[routeId]) return ROUTE_COLORS[routeId];
  if (!assignedColors[routeId]) {
    assignedColors[routeId] = PALETTE[colorIndex % PALETTE.length];
    colorIndex++;
  }
  return assignedColors[routeId];
}

export function getRouteType(routeId) {
  if (routeId === '301') return 'LRT';
  const num = parseInt(routeId);
  if (num >= 200) return 'iXpress';
  if (num >= 50) return 'Express';
  return 'Local';
}

let shapesCache = null;

export async function fetchRouteShapes() {
  if (shapesCache) return shapesCache;
  const res = await fetch('/route-shapes.json');
  if (!res.ok) throw new Error(`Shapes: HTTP ${res.status}`);
  shapesCache = await res.json();
  return shapesCache;
}

function distSq(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function projectOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { t: 0, dist: distSq(p, a) };
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const proj = [a[0] + t * dx, a[1] + t * dy];
  return { t, dist: distSq(p, proj), point: proj };
}

export function splitShapeAtVehicle(shapeCoords, vehicleLng, vehicleLat) {
  const pos = [vehicleLng, vehicleLat];
  let bestDist = Infinity;
  let bestIdx = 0;
  let bestT = 0;
  let bestPoint = shapeCoords[0];

  for (let i = 0; i < shapeCoords.length - 1; i++) {
    const { t, dist, point } = projectOnSegment(pos, shapeCoords[i], shapeCoords[i + 1]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
      bestT = t;
      bestPoint = point;
    }
  }

  const covered = shapeCoords.slice(0, bestIdx + 1).concat([bestPoint]);
  const upcoming = [bestPoint].concat(shapeCoords.slice(bestIdx + 1));

  return { covered, upcoming };
}

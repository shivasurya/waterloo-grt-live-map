import { PbfReader } from 'pbf';
import { FeedMessage } from 'gtfs-realtime-pbf-js-module';

const API_URL = 'https://livemap.shivasurya.workers.dev/';

async function fetchFeed(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  return FeedMessage.read(new PbfReader(new Uint8Array(buffer))).entity;
}

export async function fetchVehicles() {
  const ts = Date.now();
  const results = await Promise.allSettled([
    fetchFeed(`${API_URL}?feed=0&t=${ts}`),
    fetchFeed(`${API_URL}?feed=1&t=${ts}`),
    fetchFeed(`${API_URL}?feed=2&t=${ts}`),
  ]);

  const seen = new Set();
  const vehicles = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const e of result.value) {
      if (!e.vehicle?.position || !e.vehicle?.trip) continue;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      vehicles.push({
        id: e.id,
        routeId: e.vehicle.trip.route_id,
        tripId: e.vehicle.trip.trip_id,
        directionId: e.vehicle.trip.direction_id,
        latitude: e.vehicle.position.latitude,
        longitude: e.vehicle.position.longitude,
        bearing: e.vehicle.position.bearing,
        speed: e.vehicle.position.speed,
        vehicleId: e.vehicle.vehicle?.id || e.id,
      });
    }
  }

  return vehicles;
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

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function getDirectionColor(routeId, directionId) {
  const base = getRouteColor(routeId);
  if (directionId === 0 || directionId === '0') return base;
  // Direction 1: rotate hue by 180° (complementary color)
  const [h, s, l] = hexToHsl(base);
  return hslToHex((h + 180) % 360, s, l);
}

export function lightenColor(hex, amount = 30) {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, Math.max(s - 15, 20), Math.min(l + amount, 85));
}

let shapesCache = null;

export async function fetchRouteShapes() {
  if (shapesCache) return shapesCache;
  const res = await fetch('/route-shapes.json');
  if (!res.ok) throw new Error(`Shapes: HTTP ${res.status}`);
  shapesCache = await res.json();
  return shapesCache;
}

export function getRouteShape(shapes, routeId, directionId) {
  const route = shapes?.[routeId];
  if (!route) return null;
  const dir = route[String(directionId)] || route['0'] || route['1'];
  if (!dir) return null;
  // Handle both old format (array of coords) and new format ({shape, stops})
  if (Array.isArray(dir)) return { shape: dir, stops: [] };
  return dir;
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

  return { covered, upcoming, segmentIdx: bestDist === Infinity ? -1 : bestIdx, dist: bestDist };
}

// Returns the better-matching direction (0 or 1) for a vehicle by comparing
// distance to both shapes. Falls back to claimed directionId if only one exists.
export function inferDirection(shapes, routeId, vehicleLng, vehicleLat, claimedDirectionId) {
  const route = shapes?.[routeId];
  if (!route) return claimedDirectionId;

  const dir0 = route['0'];
  const dir1 = route['1'];

  const get = (d) => (Array.isArray(d) ? d : d?.shape);
  const shape0 = get(dir0);
  const shape1 = get(dir1);

  if (!shape0 && !shape1) return claimedDirectionId;
  if (!shape1) return 0;
  if (!shape0) return 1;

  const { dist: d0 } = splitShapeAtVehicle(shape0, vehicleLng, vehicleLat);
  const { dist: d1 } = splitShapeAtVehicle(shape1, vehicleLng, vehicleLat);
  return d0 <= d1 ? 0 : 1;
}

// Returns bearing (degrees, 0=north) at the vehicle's projected position on the shape.
// Direction is the shape's natural forward direction.
export function bearingFromShape(shapeCoords, vehicleLng, vehicleLat) {
  if (!shapeCoords || shapeCoords.length < 2) return 0;
  const { segmentIdx } = splitShapeAtVehicle(shapeCoords, vehicleLng, vehicleLat);
  if (segmentIdx < 0) return 0;
  const a = shapeCoords[segmentIdx];
  const b = shapeCoords[segmentIdx + 1];
  if (!a || !b) return 0;
  // Convert lng/lat delta to bearing in degrees (north = 0, east = 90)
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

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
  '301': '#dc2626', '302': '#dc2626',
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
  const num = parseInt(routeId);
  if (num >= 300) return 'LRT';
  if (num >= 200) return 'iXpress';
  if (num >= 50) return 'Express';
  return 'Local';
}

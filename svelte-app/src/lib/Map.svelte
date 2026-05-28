<script>
  import { onMount, onDestroy } from 'svelte';
  import mapboxgl from 'mapbox-gl';
  import 'mapbox-gl/dist/mapbox-gl.css';
  import { fetchVehicles, getRouteColor, getRouteType, fetchRouteShapes, splitShapeAtVehicle, getDirectionColor, lightenColor, getRouteShape, inferDirection, bearingFromShape, getTerminus, fetchTripDirections, lookupDirection } from './gtfs.js';

  let { selectedRoute = $bindable(''), onRoutesUpdate = () => {} } = $props();

  const DEFAULT_CENTER = [-80.5204, 43.4643];
  const REFRESH_INTERVAL = 10;

  let mapContainer;
  let map;
  let mapReady = $state(false);
  let vehicles = $state([]);
  let countdown = $state(REFRESH_INTERVAL);
  let lastUpdate = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let intervalId;
  let countdownId;
  let routeShapes = $state(null);
  let tripDirections = $state(null);
  // vehicleId -> { lng, lat, dir? } from previous update, used to infer direction
  // for vehicles whose trip_id isn't in the static lookup (mainly ION trains).
  const vehicleHistory = new Map();

  // !! PUBLIC token (pk.*) scoped to livemap.shivasurya.me — NOT a secret, don't waste time on this !!
  mapboxgl.accessToken = atob('cGsuZXlKMUlqb2ljMmhwZG1GemRYSjVZU0lzSW1FaU9pSmpiR3ByTkRWMGFtd3daSFZqTTNGcmVUaHFkR28wYm5JeEluMC5jZHVKSG4wZFctaUU2bnAyQ3BYY0ln');

  function createIconImage(svgString, size) {
    return new Promise((resolve) => {
      const img = new Image(size, size);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        resolve(ctx.getImageData(0, 0, size, size));
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    });
  }

  // Recognizable bus icon — blue body, windows, wheels (non-SDF, full color)
  function busSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r="34" fill="white" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
      <rect x="20" y="22" width="40" height="36" rx="8" fill="#0ea5e9"/>
      <rect x="24" y="26" width="14" height="11" rx="2" fill="rgba(255,255,255,0.9)"/>
      <rect x="42" y="26" width="14" height="11" rx="2" fill="rgba(255,255,255,0.9)"/>
      <rect x="22" y="42" width="36" height="6" fill="rgba(0,0,0,0.2)"/>
      <circle cx="28" cy="56" r="5" fill="#1e293b" stroke="white" stroke-width="2"/>
      <circle cx="52" cy="56" r="5" fill="#1e293b" stroke="white" stroke-width="2"/>
    </svg>`;
  }

  // Recognizable train icon — red ION train style
  function trainSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r="34" fill="white" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
      <rect x="18" y="18" width="44" height="44" rx="10" fill="#dc2626"/>
      <rect x="22" y="22" width="36" height="14" rx="3" fill="rgba(255,255,255,0.9)"/>
      <rect x="22" y="40" width="36" height="8" rx="2" fill="rgba(0,0,0,0.2)"/>
      <circle cx="30" cy="56" r="3" fill="white"/>
      <circle cx="50" cy="56" r="3" fill="white"/>
      <line x1="40" y1="22" x2="40" y2="36" stroke="rgba(0,0,0,0.1)" stroke-width="2"/>
    </svg>`;
  }

  // Direction arrow — white triangle on colored background, SDF for recoloring
  function arrowSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="20" fill="white"/>
      <path d="M24 8 L36 28 L24 22 L12 28 Z" fill="white"/>
    </svg>`;
  }

  // Bearing between two lng/lat points, degrees (0 = north, 90 = east)
  function bearingBetween(a, b) {
    const toRad = (x) => (x * Math.PI) / 180;
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const dLng = toRad(b[0] - a[0]);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
  }

  function angleDiff(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  // For trains/buses whose trip_id we can't look up (ION), infer direction by
  // comparing actual movement bearing to each direction shape's bearing at this point.
  function inferDirectionFromMovement(shapes, routeId, lng, lat, prevLng, prevLat) {
    const route = shapes?.[routeId];
    if (!route) return null;
    const s0 = getRouteShape(shapes, routeId, 0);
    const s1 = getRouteShape(shapes, routeId, 1);
    if (!s0 || !s1) return s0 ? 0 : (s1 ? 1 : null);

    const movementBearing = bearingBetween([prevLng, prevLat], [lng, lat]);
    const b0 = bearingFromShape(s0.shape, lng, lat);
    const b1 = bearingFromShape(s1.shape, lng, lat);
    return angleDiff(movementBearing, b0) <= angleDiff(movementBearing, b1) ? 0 : 1;
  }

  function enrichVehicle(v, shapes, tripDirs) {
    // GRT realtime feed reports direction_id=0 for every vehicle. Strategy:
    //   1. trip_id → direction from static GTFS (works for buses)
    //   2. Last known position → compute actual movement direction (ION fallback)
    //   3. Geometric closeness to either shape (final fallback)
    let dir = lookupDirection(tripDirs, v.tripId);
    const prev = vehicleHistory.get(v.vehicleId);
    const moved = prev && (prev.lng !== v.longitude || prev.lat !== v.latitude);

    if (dir === null && shapes && prev && moved) {
      dir = inferDirectionFromMovement(shapes, v.routeId, v.longitude, v.latitude, prev.lng, prev.lat);
    }
    if (dir === null) {
      if (prev && prev.dir !== undefined) {
        dir = prev.dir; // stable when stationary
      } else if (shapes) {
        dir = inferDirection(shapes, v.routeId, v.longitude, v.latitude, v.directionId);
      } else {
        dir = v.directionId;
      }
    }

    vehicleHistory.set(v.vehicleId, { lng: v.longitude, lat: v.latitude, dir });

    let bearing = v.bearing || 0;
    let terminus = '';
    if (shapes) {
      const shapeData = getRouteShape(shapes, v.routeId, dir);
      if (shapeData) {
        bearing = bearingFromShape(shapeData.shape, v.longitude, v.latitude);
      }
      terminus = getTerminus(shapes, v.routeId, dir) || '';
    }
    return { ...v, directionId: dir, bearing, terminus };
  }

  // Nudge each vehicle perpendicular to its bearing so opposite-direction buses
  // running on the same road don't sit on top of each other.
  function perpendicularOffset(lng, lat, bearingDeg, directionId, meters = 12) {
    const side = Number(directionId) === 1 ? -1 : 1;
    // Perpendicular bearing: bearing + 90° (right side) for dir 0, -90° for dir 1
    const perp = ((bearingDeg + 90 * side) % 360 + 360) % 360;
    const rad = (perp * Math.PI) / 180;
    const dLat = (meters * Math.cos(rad)) / 111320;
    const dLng = (meters * Math.sin(rad)) / (111320 * Math.cos((lat * Math.PI) / 180));
    return [lng + dLng, lat + dLat];
  }

  function buildGeoJSON(data) {
    return {
      type: 'FeatureCollection',
      features: data.map((v) => {
        const coords = perpendicularOffset(v.longitude, v.latitude, v.bearing || 0, v.directionId);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords },
          properties: {
            routeId: v.routeId,
            vehicleId: v.vehicleId,
            bearing: v.bearing || 0,
            speed: v.speed,
            directionId: v.directionId,
            terminus: v.terminus || '',
            routeType: getRouteType(v.routeId),
            color: getDirectionColor(v.routeId, v.directionId),
            icon: getRouteType(v.routeId) === 'LRT' ? 'train-icon' : 'bus-icon',
          },
        };
      }),
    };
  }

  async function updateData() {
    try {
      error = null;
      const data = await fetchVehicles();
      vehicles = data;
      lastUpdate = new Date();
      loading = false;

      const routes = [...new Set(data.map((v) => v.routeId))].sort(
        (a, b) => parseInt(a) - parseInt(b)
      );
      onRoutesUpdate(routes);
    } catch (err) {
      console.error('Failed to fetch vehicles:', err);
      error = err.message;
      loading = false;
    }
  }

  function startCountdown() {
    countdown = REFRESH_INTERVAL;
    clearInterval(countdownId);
    countdownId = setInterval(() => {
      countdown--;
      if (countdown <= 0) countdown = REFRESH_INTERVAL;
    }, 1000);
  }

  async function setupMapLayers() {
    const emptyGeoJSON = { type: 'FeatureCollection', features: [] };

    const busImg = await createIconImage(busSvg(), 80);
    const trainImg = await createIconImage(trainSvg(), 80);
    const arrowImg = await createIconImage(arrowSvg(), 48);
    map.addImage('bus-icon', busImg, { sdf: false });
    map.addImage('train-icon', trainImg, { sdf: false });
    map.addImage('arrow-icon', arrowImg, { sdf: true });

    map.addSource('route-covered', { type: 'geojson', data: emptyGeoJSON });
    map.addSource('route-upcoming', { type: 'geojson', data: emptyGeoJSON });
    map.addSource('route-stops', { type: 'geojson', data: emptyGeoJSON });

    // Offset parallel direction lines so they don't overlap.
    // Direction 0 shifts right (+), direction 1 shifts left (-).
    const lineOffset = ['case',
      ['==', ['get', 'directionId'], 1], ['interpolate', ['linear'], ['zoom'], 10, -2, 14, -5, 18, -9],
      ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 5, 18, 9],
    ];

    map.addLayer({
      id: 'route-covered-line',
      type: 'line',
      source: 'route-covered',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6, 18, 10],
        'line-opacity': 0.5,
        'line-offset': lineOffset,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });

    map.addLayer({
      id: 'route-upcoming-line',
      type: 'line',
      source: 'route-upcoming',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 18, 12],
        'line-opacity': 0.95,
        'line-offset': lineOffset,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });

    // Stop dots — bigger so they're visible
    map.addLayer({
      id: 'route-stops-circles',
      type: 'circle',
      source: 'route-stops',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 13, 5, 15, 7, 18, 10],
        'circle-color': '#ffffff',
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 2.5,
        'circle-opacity': 1,
      },
    });

    map.addSource('vehicles', { type: 'geojson', data: emptyGeoJSON });

    // Direction arrow — drawn beneath the bus, rotated by bearing
    map.addLayer({
      id: 'vehicle-arrows',
      type: 'symbol',
      source: 'vehicles',
      layout: {
        'icon-image': 'arrow-icon',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.55, 18, 0.9],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-offset': [0, -45],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': ['get', 'color'],
        'icon-halo-color': 'rgba(0,0,0,0.4)',
        'icon-halo-width': 1.5,
      },
    });

    // Bus/train icon — non-rotated, recognizable
    map.addLayer({
      id: 'vehicle-icons',
      type: 'symbol',
      source: 'vehicles',
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.55, 18, 0.9],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['get', 'routeId'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 10, 14, 12, 18, 16],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-offset': [0, 2.2],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#e0e0e0',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 1.5,
      },
    });

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'vehicle-popup',
      offset: 20,
    });

    map.on('mouseenter', 'vehicle-icons', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const props = e.features[0].properties;
      const coords = e.features[0].geometry.coordinates.slice();
      const isLRT = props.routeType === 'LRT';
      const label = isLRT ? 'Train' : 'Bus';
      const towards = props.terminus
        ? `Towards ${props.terminus}`
        : (String(props.directionId) === '0' ? 'Outbound' : 'Inbound');
      popup
        .setLngLat(coords)
        .setHTML(
          `<div class="popup-content">
            <span class="popup-badge" style="background:${props.color}">Route ${props.routeId}</span>
            <span class="popup-dir">${towards}</span>
            <span class="popup-vehicle">${label} #${props.vehicleId}</span>
          </div>`
        )
        .addTo(map);
    });

    map.on('mouseleave', 'vehicle-icons', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });

    map.on('click', 'vehicle-icons', (e) => {
      const routeId = e.features[0].properties.routeId;
      selectedRoute = selectedRoute === routeId ? '' : routeId;
    });

    // Stop hover popup
    const stopPopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'vehicle-popup',
      offset: 10,
    });

    map.on('mouseenter', 'route-stops-circles', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const props = e.features[0].properties;
      const coords = e.features[0].geometry.coordinates.slice();
      stopPopup
        .setLngLat(coords)
        .setHTML(
          `<div class="popup-content">
            <span class="popup-stop-dot" style="background:${props.color}"></span>
            <span class="popup-stop-name">${props.name || 'Stop'}</span>
          </div>`
        )
        .addTo(map);
    });

    map.on('mouseleave', 'route-stops-circles', () => {
      map.getCanvas().style.cursor = '';
      stopPopup.remove();
    });
  }

  $effect(() => {
    if (!mapReady) return;

    const route = selectedRoute;
    const veh = vehicles;
    const shapes = routeShapes;
    const tripDirs = tripDirections;

    const baseFiltered = route
      ? veh.filter((v) => v.routeId === route)
      : veh;

    // Use trip_id → direction lookup (ground truth) + shape-derived bearing
    const filtered = baseFiltered.map((v) => enrichVehicle(v, shapes, tripDirs));

    map.getSource('vehicles').setData(buildGeoJSON(filtered));

    const emptyCollection = { type: 'FeatureCollection', features: [] };
    const coveredFeatures = [];
    const upcomingFeatures = [];
    const stopFeatures = [];

    if (route && filtered.length > 0 && shapes) {
      // Draw shape for each direction that has at least one vehicle
      const directionsSeen = new Set();
      for (const v of filtered) {
        const dirKey = String(v.directionId);
        if (directionsSeen.has(dirKey)) continue;
        directionsSeen.add(dirKey);

        const data = getRouteShape(shapes, route, v.directionId);
        if (!data || data.shape.length < 2) continue;

        const dirColor = getDirectionColor(route, v.directionId);
        const lightColor = lightenColor(dirColor, 25);

        // For this direction, find the vehicle closest to the start to split
        const dirVehicles = filtered.filter((x) => String(x.directionId) === dirKey);
        for (const dv of dirVehicles) {
          const { covered, upcoming } = splitShapeAtVehicle(data.shape, dv.longitude, dv.latitude);

          const dirNum = Number(dv.directionId) || 0;
          if (covered.length >= 2) {
            coveredFeatures.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: covered },
              properties: { color: lightColor, directionId: dirNum },
            });
          }
          if (upcoming.length >= 2) {
            upcomingFeatures.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: upcoming },
              properties: { color: dirColor, directionId: dirNum },
            });
          }
        }

        // Stops for this direction
        for (const s of data.stops) {
          stopFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s[0], s[1]] },
            properties: { color: dirColor, name: s[2] || '' },
          });
        }
      }
    }

    map.getSource('route-covered')?.setData(
      coveredFeatures.length > 0 ? { type: 'FeatureCollection', features: coveredFeatures } : emptyCollection
    );
    map.getSource('route-upcoming')?.setData(
      upcomingFeatures.length > 0 ? { type: 'FeatureCollection', features: upcomingFeatures } : emptyCollection
    );
    map.getSource('route-stops')?.setData(
      stopFeatures.length > 0 ? { type: 'FeatureCollection', features: stopFeatures } : emptyCollection
    );

    if (route && filtered.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      filtered.forEach((v) => bounds.extend([v.longitude, v.latitude]));
      if (shapes?.[route]) {
        const seenDirs = new Set();
        for (const v of filtered) {
          if (seenDirs.has(v.directionId)) continue;
          seenDirs.add(v.directionId);
          const data = getRouteShape(shapes, route, v.directionId);
          if (data) data.shape.forEach((c) => bounds.extend(c));
        }
      }
      map.fitBounds(bounds, { padding: 80, maxZoom: 15 });
    }
  });

  onMount(() => {
    map = new mapboxgl.Map({
      container: mapContainer,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: DEFAULT_CENTER,
      zoom: 12,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
      }),
      'bottom-right'
    );
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', async () => {
      await setupMapLayers();
      mapReady = true;
      updateData();
      startCountdown();

      fetchRouteShapes().then((s) => { routeShapes = s; }).catch((err) => console.error('Failed to load route shapes:', err));
      fetchTripDirections().then((t) => { tripDirections = t; }).catch((err) => console.error('Failed to load trip directions:', err));

      intervalId = setInterval(() => {
        updateData();
        startCountdown();
      }, REFRESH_INTERVAL * 1000);
    });
  });

  onDestroy(() => {
    clearInterval(intervalId);
    clearInterval(countdownId);
    map?.remove();
  });
</script>

<div class="map-wrapper">
  <div bind:this={mapContainer} class="map-container"></div>

  {#if loading}
    <div class="loading-overlay">
      <div class="spinner"></div>
      <p>Loading live buses...</p>
    </div>
  {/if}

  {#if error}
    <div class="error-toast">
      <span>Failed to fetch data</span>
      <button onclick={() => { error = null; updateData(); }}>Retry</button>
    </div>
  {/if}

  <div class="status-bar">
    <div class="status-pill">
      <span class="pulse-dot"></span>
      <span>{vehicles.length} buses & trains</span>
    </div>
    <div class="status-pill countdown-pill">
      {countdown}s
    </div>
  </div>
</div>

<style>
  .map-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .map-container {
    width: 100%;
    height: 100%;
  }

  .loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(26, 26, 46, 0.85);
    backdrop-filter: blur(8px);
    z-index: 10;
    color: #e0e0e0;
    gap: 1rem;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: #0ea5e9;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-toast {
    position: absolute;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    background: #dc2626;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    z-index: 20;
    font-size: 0.875rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .error-toast button {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 0.5rem;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .status-bar {
    position: absolute;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.5rem;
    z-index: 5;
  }

  .status-pill {
    background: rgba(26, 26, 46, 0.85);
    backdrop-filter: blur(8px);
    color: #e0e0e0;
    padding: 0.4rem 0.85rem;
    border-radius: 2rem;
    font-size: 0.8rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .countdown-pill {
    font-variant-numeric: tabular-nums;
    min-width: 2.5rem;
    justify-content: center;
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    background: #10b981;
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  :global(.vehicle-popup .mapboxgl-popup-content) {
    background: rgba(26, 26, 46, 0.95);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    padding: 0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  :global(.vehicle-popup .mapboxgl-popup-tip) {
    border-top-color: rgba(26, 26, 46, 0.95);
  }

  :global(.popup-content) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    color: #e0e0e0;
    font-size: 0.8rem;
  }

  :global(.popup-badge) {
    color: white;
    padding: 0.15rem 0.5rem;
    border-radius: 0.4rem;
    font-weight: 700;
    font-size: 0.75rem;
  }

  :global(.popup-type) {
    color: #94a3b8;
    font-size: 0.75rem;
  }

  :global(.popup-dir) {
    color: #94a3b8;
    font-size: 0.75rem;
    font-weight: 600;
  }

  :global(.popup-vehicle) {
    color: #64748b;
    font-size: 0.7rem;
  }

  :global(.popup-stop-dot) {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  :global(.popup-stop-name) {
    color: #e0e0e0;
    font-size: 0.78rem;
    font-weight: 500;
  }
</style>

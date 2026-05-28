<script>
  import { onMount, onDestroy } from 'svelte';
  import mapboxgl from 'mapbox-gl';
  import 'mapbox-gl/dist/mapbox-gl.css';
  import { fetchVehicles, getRouteColor, getRouteType, fetchRouteShapes, splitShapeAtVehicle, getDirectionColor, lightenColor, getRouteShape } from './gtfs.js';

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

  // Solid silhouette icons with arrow tip — pointing up (north). Rotated by bearing.
  // SDF so we can recolor per-vehicle by direction.
  function busSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <path d="M32 4 L46 22 L42 22 L42 52 Q42 56 38 56 L26 56 Q22 56 22 52 L22 22 L18 22 Z" fill="white"/>
    </svg>`;
  }

  function trainSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <path d="M32 4 L48 22 L44 22 L44 52 Q44 58 38 58 L26 58 Q20 58 20 52 L20 22 L16 22 Z" fill="white"/>
    </svg>`;
  }

  function buildGeoJSON(data) {
    return {
      type: 'FeatureCollection',
      features: data.map((v) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
        properties: {
          routeId: v.routeId,
          vehicleId: v.vehicleId,
          bearing: v.bearing || 0,
          speed: v.speed,
          directionId: v.directionId,
          routeType: getRouteType(v.routeId),
          color: getDirectionColor(v.routeId, v.directionId),
          icon: getRouteType(v.routeId) === 'LRT' ? 'train-icon' : 'bus-icon',
        },
      })),
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

    const busImg = await createIconImage(busSvg(), 64);
    const trainImg = await createIconImage(trainSvg(), 64);
    map.addImage('bus-icon', busImg, { sdf: true });
    map.addImage('train-icon', trainImg, { sdf: true });

    map.addSource('route-covered', { type: 'geojson', data: emptyGeoJSON });
    map.addSource('route-upcoming', { type: 'geojson', data: emptyGeoJSON });
    map.addSource('route-stops', { type: 'geojson', data: emptyGeoJSON });

    map.addLayer({
      id: 'route-covered-line',
      type: 'line',
      source: 'route-covered',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6, 18, 10],
        'line-opacity': 0.5,
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
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });

    // Stop dots — only visible at moderate+ zoom
    map.addLayer({
      id: 'route-stops-circles',
      type: 'circle',
      source: 'route-stops',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 3, 15, 5, 18, 8],
        'circle-color': '#ffffff',
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-opacity': 0.95,
      },
    });

    map.addSource('vehicles', { type: 'geojson', data: emptyGeoJSON });

    map.addLayer({
      id: 'vehicle-icons',
      type: 'symbol',
      source: 'vehicles',
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 14, 0.65, 18, 1],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['get', 'routeId'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 10, 14, 12, 18, 16],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-offset': [0, 2.4],
        'text-allow-overlap': false,
      },
      paint: {
        'icon-color': ['get', 'color'],
        'icon-halo-color': '#ffffff',
        'icon-halo-width': 1.5,
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
      const dirLabel = String(props.directionId) === '0' ? 'Outbound' : 'Inbound';
      popup
        .setLngLat(coords)
        .setHTML(
          `<div class="popup-content">
            <span class="popup-badge" style="background:${props.color}">Route ${props.routeId}</span>
            <span class="popup-dir">${dirLabel}</span>
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
  }

  $effect(() => {
    if (!mapReady) return;

    const route = selectedRoute;
    const veh = vehicles;
    const shapes = routeShapes;

    const filtered = route
      ? veh.filter((v) => v.routeId === route)
      : veh;

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

          if (covered.length >= 2) {
            coveredFeatures.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: covered },
              properties: { color: lightColor },
            });
          }
          if (upcoming.length >= 2) {
            upcomingFeatures.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: upcoming },
              properties: { color: dirColor },
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
</style>

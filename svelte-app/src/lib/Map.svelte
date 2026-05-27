<script>
  import { onMount, onDestroy } from 'svelte';
  import mapboxgl from 'mapbox-gl';
  import 'mapbox-gl/dist/mapbox-gl.css';
  import { fetchVehicles, getRouteColor, getRouteType, fetchRouteShapes, splitShapeAtVehicle } from './gtfs.js';

  let { selectedRoute = $bindable(''), onRoutesUpdate = () => {} } = $props();

  const DEFAULT_CENTER = [-80.5204, 43.4643];
  const REFRESH_INTERVAL = 10;

  let mapContainer;
  let map;
  let vehicles = $state([]);
  let countdown = $state(REFRESH_INTERVAL);
  let lastUpdate = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let intervalId;
  let countdownId;
  let routeShapes = null;

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

  function busSvg(color) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="8" y="8" width="48" height="48" rx="12" fill="${color}" stroke="white" stroke-width="3"/>
      <rect x="16" y="14" width="14" height="12" rx="3" fill="rgba(255,255,255,0.85)"/>
      <rect x="34" y="14" width="14" height="12" rx="3" fill="rgba(255,255,255,0.85)"/>
      <circle cx="20" cy="46" r="5" fill="#1e293b" stroke="white" stroke-width="1.5"/>
      <circle cx="44" cy="46" r="5" fill="#1e293b" stroke="white" stroke-width="1.5"/>
      <rect x="14" y="30" width="36" height="8" rx="2" fill="rgba(0,0,0,0.15)"/>
    </svg>`;
  }

  function trainSvg(color) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="8" y="6" width="48" height="52" rx="14" fill="${color}" stroke="white" stroke-width="3"/>
      <rect x="14" y="12" width="36" height="16" rx="4" fill="rgba(255,255,255,0.85)"/>
      <rect x="14" y="32" width="36" height="10" rx="3" fill="rgba(0,0,0,0.15)"/>
      <circle cx="22" cy="50" r="4" fill="white"/>
      <circle cx="42" cy="50" r="4" fill="white"/>
      <line x1="32" y1="12" x2="32" y2="28" stroke="rgba(0,0,0,0.1)" stroke-width="2"/>
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
          bearing: v.bearing,
          speed: v.speed,
          routeType: getRouteType(v.routeId),
          color: getRouteColor(v.routeId),
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

      if (map?.getSource('vehicles')) {
        const filtered = selectedRoute
          ? data.filter((v) => v.routeId === selectedRoute)
          : data;
        map.getSource('vehicles').setData(buildGeoJSON(filtered));
      }
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

    const busImg = await createIconImage(busSvg('#0ea5e9'), 64);
    const trainImg = await createIconImage(trainSvg('#dc2626'), 64);
    map.addImage('bus-icon', busImg, { sdf: false });
    map.addImage('train-icon', trainImg, { sdf: false });

    map.addSource('route-covered', { type: 'geojson', data: emptyGeoJSON });
    map.addSource('route-upcoming', { type: 'geojson', data: emptyGeoJSON });

    map.addLayer({
      id: 'route-covered-line',
      type: 'line',
      source: 'route-covered',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 5, 18, 8],
        'line-opacity': 0.4,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });

    map.addLayer({
      id: 'route-upcoming-line',
      type: 'line',
      source: 'route-upcoming',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6, 18, 10],
        'line-opacity': 0.85,
        'line-dasharray': [2, 1],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });

    map.addSource('vehicles', { type: 'geojson', data: emptyGeoJSON });

    map.addLayer({
      id: 'vehicle-icons',
      type: 'symbol',
      source: 'vehicles',
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.6, 18, 1],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['get', 'routeId'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 9, 14, 12, 18, 16],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-offset': [0, 2.2],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#e0e0e0',
        'text-halo-color': 'rgba(0,0,0,0.7)',
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
      popup
        .setLngLat(coords)
        .setHTML(
          `<div class="popup-content">
            <span class="popup-badge" style="background:${props.color}">Route ${props.routeId}</span>
            <span class="popup-type">${props.routeType}</span>
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

  function updateRouteShapes(filtered) {
    if (!map?.getSource('route-covered') || !routeShapes) return;

    const coveredFeatures = [];
    const upcomingFeatures = [];

    if (selectedRoute && filtered.length > 0) {
      const shapeData = routeShapes[selectedRoute];
      if (shapeData) {
        for (const v of filtered) {
          const dirCoords = shapeData[String(v.directionId)] || shapeData['0'] || shapeData['1'];
          if (!dirCoords || dirCoords.length < 2) continue;

          const color = getRouteColor(v.routeId);
          const { covered, upcoming } = splitShapeAtVehicle(dirCoords, v.longitude, v.latitude);

          if (covered.length >= 2) {
            coveredFeatures.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: covered },
              properties: { color },
            });
          }
          if (upcoming.length >= 2) {
            upcomingFeatures.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: upcoming },
              properties: { color },
            });
          }
        }
      }
    }

    map.getSource('route-covered').setData({ type: 'FeatureCollection', features: coveredFeatures });
    map.getSource('route-upcoming').setData({ type: 'FeatureCollection', features: upcomingFeatures });
  }

  $effect(() => {
    if (!map || !map.getSource('vehicles')) return;
    const filtered = selectedRoute
      ? vehicles.filter((v) => v.routeId === selectedRoute)
      : vehicles;
    map.getSource('vehicles').setData(buildGeoJSON(filtered));
    updateRouteShapes(filtered);

    if (selectedRoute && filtered.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      filtered.forEach((v) => bounds.extend([v.longitude, v.latitude]));
      // Also include shape points in bounds for better framing
      const shapeData = routeShapes?.[selectedRoute];
      if (shapeData) {
        for (const v of filtered) {
          const dirCoords = shapeData[String(v.directionId)] || shapeData['0'];
          if (dirCoords) dirCoords.forEach((c) => bounds.extend(c));
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
      updateData();
      startCountdown();

      fetchRouteShapes().then((s) => { routeShapes = s; }).catch(() => {});

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
      <span>{vehicles.length} buses</span>
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

  :global(.popup-vehicle) {
    color: #64748b;
    font-size: 0.7rem;
  }
</style>

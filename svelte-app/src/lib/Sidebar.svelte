<script>
  import { getRouteColor, getRouteType } from './gtfs.js';

  let { routes = [], selectedRoute = $bindable(''), collapsed = $bindable(true) } = $props();

  let search = $state('');

  let filteredRoutes = $derived(
    search
      ? routes.filter((r) => r.toLowerCase().includes(search.toLowerCase()))
      : routes
  );

  let groupedRoutes = $derived(() => {
    const groups = { LRT: [], iXpress: [], Express: [], Local: [] };
    filteredRoutes.forEach((r) => {
      const type = getRouteType(r);
      groups[type].push(r);
    });
    return groups;
  });

  function selectRoute(routeId) {
    selectedRoute = selectedRoute === routeId ? '' : routeId;
    if (selectedRoute) collapsed = true;
  }

  function clearFilter() {
    selectedRoute = '';
    search = '';
    collapsed = true;
  }
</script>

<div class="sidebar" class:collapsed>
  <button class="toggle-btn" onclick={() => { if (!collapsed) { selectedRoute = ''; search = ''; } collapsed = !collapsed; }} aria-label={collapsed ? 'Open route panel' : 'Close route panel'}>
    {#if collapsed}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    {:else}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    {/if}
  </button>

  {#if !collapsed}
    <div class="sidebar-content">
      <div class="header">
        <h1>GRT Live</h1>
        <p class="subtitle">Waterloo Region Transit</p>
      </div>

      <div class="search-box">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input
          type="text"
          placeholder="Search routes..."
          bind:value={search}
        />
        {#if search || selectedRoute}
          <button class="clear-btn" onclick={clearFilter} aria-label="Clear search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        {/if}
      </div>

      {#if selectedRoute}
        <div class="active-filter">
          <span class="filter-badge" style="background: {getRouteColor(selectedRoute)}">
            Route {selectedRoute}
          </span>
          <button class="clear-filter" onclick={clearFilter}>Show all</button>
        </div>
      {/if}

      <div class="route-list">
        {#each Object.entries(groupedRoutes()) as [type, routeIds]}
          {#if routeIds.length > 0}
            <div class="route-group">
              <div class="group-header">{type}</div>
              <div class="route-chips">
                {#each routeIds as routeId}
                  <button
                    class="route-chip"
                    class:active={selectedRoute === routeId}
                    style="--route-color: {getRouteColor(routeId)}"
                    onclick={() => selectRoute(routeId)}
                  >
                    {routeId}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        {#if filteredRoutes.length === 0}
          <p class="no-results">No routes match "{search}"</p>
        {/if}
      </div>

      <div class="sidebar-footer">
        <a href="https://shivasurya.me" target="_blank" rel="noopener">By Shiva</a>
      </div>
    </div>
  {/if}
</div>

<style>
  .sidebar {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    z-index: 10;
    display: flex;
    flex-direction: column;
    transition: width 0.3s ease;
    pointer-events: none;
  }

  .sidebar > * {
    pointer-events: auto;
  }

  .sidebar:not(.collapsed) {
    width: 300px;
  }

  .toggle-btn {
    position: absolute;
    top: 1rem;
    left: 1rem;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(26, 26, 46, 0.9);
    backdrop-filter: blur(12px);
    color: #e0e0e0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    transition: background 0.2s;
    z-index: 11;
  }

  .toggle-btn:hover {
    background: rgba(40, 40, 70, 0.95);
  }

  .sidebar-content {
    margin-top: 0;
    height: 100%;
    background: rgba(26, 26, 46, 0.92);
    backdrop-filter: blur(16px);
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    padding: 1.25rem 1.25rem 0.75rem;
    padding-top: 4.5rem;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 800;
    background: linear-gradient(135deg, #0ea5e9, #a855f7);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.02em;
  }

  .subtitle {
    margin: 0.15rem 0 0;
    font-size: 0.8rem;
    color: #64748b;
  }

  .search-box {
    margin: 0.5rem 1rem;
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 0.75rem;
    color: #64748b;
    pointer-events: none;
  }

  .search-box input {
    width: 100%;
    padding: 0.6rem 2rem 0.6rem 2.25rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.75rem;
    color: #e0e0e0;
    font-size: 0.85rem;
    outline: none;
    transition: border-color 0.2s, background 0.2s;
  }

  .search-box input::placeholder {
    color: #4a5568;
  }

  .search-box input:focus {
    border-color: rgba(14, 165, 233, 0.4);
    background: rgba(255, 255, 255, 0.08);
  }

  .clear-btn {
    position: absolute;
    right: 0.5rem;
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    border-radius: 50%;
  }

  .clear-btn:hover {
    color: #e0e0e0;
  }

  .active-filter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 1rem 0.5rem;
    padding: 0.5rem 0.75rem;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .filter-badge {
    color: white;
    padding: 0.2rem 0.6rem;
    border-radius: 0.4rem;
    font-weight: 700;
    font-size: 0.8rem;
  }

  .clear-filter {
    background: none;
    border: none;
    color: #0ea5e9;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 500;
  }

  .clear-filter:hover {
    text-decoration: underline;
  }

  .route-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 1rem 1rem;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
  }

  .route-group {
    margin-bottom: 1rem;
  }

  .group-header {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    margin-bottom: 0.5rem;
    padding-left: 0.1rem;
  }

  .route-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .route-chip {
    padding: 0.35rem 0.7rem;
    border-radius: 0.6rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: #cbd5e1;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    font-variant-numeric: tabular-nums;
  }

  .route-chip:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--route-color);
    color: white;
  }

  .route-chip.active {
    background: var(--route-color);
    border-color: var(--route-color);
    color: white;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--route-color) 40%, transparent);
  }

  .no-results {
    color: #4a5568;
    font-size: 0.85rem;
    text-align: center;
    margin-top: 2rem;
  }

  .sidebar-footer {
    padding: 0.75rem 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    text-align: center;
  }

  .sidebar-footer a {
    color: #4a5568;
    text-decoration: none;
    font-size: 0.75rem;
  }

  .sidebar-footer a:hover {
    color: #64748b;
  }

  @media (max-width: 640px) {
    .sidebar:not(.collapsed) {
      width: 100%;
      max-height: 55vh;
      height: auto;
      bottom: 0;
      top: auto;
    }

    .sidebar-content {
      border-right: none;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 1.25rem 1.25rem 0 0;
      max-height: 55vh;
    }

    .header {
      padding-top: 1rem;
    }

    .toggle-btn {
      top: auto;
      bottom: 5rem;
    }

    .sidebar.collapsed .toggle-btn {
      bottom: 5rem;
    }
  }
</style>

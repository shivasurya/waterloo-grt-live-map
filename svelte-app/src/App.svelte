<script>
  import Map from './lib/Map.svelte';
  import Sidebar from './lib/Sidebar.svelte';

  let selectedRoute = $state('');
  let routes = $state([]);
  let sidebarCollapsed = $state(true);
</script>

<main>
  <Map bind:selectedRoute onRoutesUpdate={(r) => (routes = r)} />
  <Sidebar {routes} bind:selectedRoute bind:collapsed={sidebarCollapsed} />
</main>

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(html, body) {
    height: 100%;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e;
  }

  :global(#app) {
    height: 100%;
  }

  main {
    width: 100%;
    height: 100%;
    position: relative;
  }
</style>

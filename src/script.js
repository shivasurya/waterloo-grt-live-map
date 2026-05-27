const DEFAULT_LAT = 43.4643;
const DEFAULT_LNG = -80.5204;

const protobufUpdate = async () => {
  const url =
    "https://livemap.shivasurya.workers.dev/?cacheBust=" + new Date().getTime();
  try {
    let response = await fetch(url);
    if (response.ok) {
      const bufferRes = await response.arrayBuffer();
      const pbf = new Pbf(new Uint8Array(bufferRes));
      const obj = FeedMessage.read(pbf);
      return obj.entity;
    } else {
      console.error("error:", response.status);
      return [];
    }
  } catch (err) {
    console.error("fetch failed:", err);
    return [];
  }
};

let timerInterval;
const resetTimer = () => {
  clearInterval(timerInterval);

  const node = document.querySelector(".countdownTimer");
  node.innerHTML = 10;
  timerInterval = setInterval(() => {
    const n = document.querySelector(".countdownTimer");
    n.innerHTML = n.innerHTML - 1;
  }, 1000);
};

let map;
let clickHandlerAdded = false;

function getLocation() {
  if (window.gtag) {
    gtag("event", "page_view");
  }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        main(position.coords.latitude, position.coords.longitude);
        new mapboxgl.Marker()
          .setLngLat([position.coords.longitude, position.coords.latitude])
          .addTo(map);
      },
      () => {
        main(DEFAULT_LAT, DEFAULT_LNG);
      }
    );
  } else {
    main(DEFAULT_LAT, DEFAULT_LNG);
  }
}

const updateLayer = async (map) => {
  const locations = await protobufUpdate();
  if (!locations || locations.length === 0) return;

  const features = locations.map((locationObject) => {
    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [
          locationObject.vehicle.position.longitude,
          locationObject.vehicle.position.latitude,
        ],
      },
      properties: {
        name: locationObject.vehicle.trip.route_id,
        text: locationObject.vehicle.trip.route_id,
      },
    };
  });

  const geojson = {
    type: "FeatureCollection",
    features: features,
  };

  const source = map.getSource("locations");
  if (source) {
    source.setData(geojson);
  } else {
    map.addSource("locations", {
      type: "geojson",
      data: geojson,
    });

    map.loadImage("./bus.webp", (error, image) => {
      if (error) {
        console.error("Failed to load bus icon:", error);
        return;
      }

      map.addImage("mapbox-icons", image);

      map.addLayer({
        id: "locations",
        type: "symbol",
        source: "locations",
        layout: {
          "icon-image": "mapbox-icons",
          "icon-size": 0.1,
        },
      });
    });
  }

  if (!clickHandlerAdded) {
    clickHandlerAdded = true;
    const popup = new mapboxgl.Popup();
    map.on("click", "locations", (e) => {
      const coordinates = e.features[0].geometry.coordinates.slice();
      const name = e.features[0].properties.name;
      popup.setLngLat(coordinates).setHTML(name).addTo(map);
    });
  }
};

const main = async (latitude, longitude) => {
  map = new mapboxgl.Map({
    container: "viewDiv",
    style: "mapbox://styles/mapbox/streets-v11",
    center: [longitude, latitude],
    zoom: 14,
  });

  map.on("load", () => {
    updateLayer(map);
    resetTimer();

    setInterval(() => {
      updateLayer(map);
      resetTimer();
    }, 10000);
  });
};

getLocation();

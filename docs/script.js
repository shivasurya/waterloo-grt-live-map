/* Security Enthusiasts: I want to save your time here
   This mapbox access token is supposed to be used on public domains and doesn't have any additional scope.
   This token is scoped for livemap.shivasurya.me. Thanks for your time
*/ 
mapboxgl.accessToken =
  "pk.eyJ1Ijoic2hpdmFzdXJ5YSIsImEiOiJjbGprNDV0amwwZHVjM3FreThqdGo0bnIxIn0.cduJHn0dW-iE6np2CpXcIg";

const protobufUpdate = async () => {
  const url =
    "https://livemap.shivasurya.workers.dev/?cacheBust=" + new Date().getTime();
  let response = await fetch(url);
  if (response.ok) {
    const bufferRes = await response.arrayBuffer();
    const pbf = new Pbf(new Uint8Array(bufferRes));
    const obj = FeedMessage.read(pbf);
    return obj.entity;
  } else {
    console.error("error:", response.status);
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

function getLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(showPosition);
  } else {
    x.innerHTML = "Geolocation is not supported by this browser.";
  }
}

function showPosition(position) {
  main(position.coords.latitude, position.coords.longitude);
}

// Removes all the graphics, calls the API to get the data,
// and adds all the Graphics to the input graphicsLayer.
const updateLayer = async (map) => {
  const locations = await protobufUpdate();
  // console.log("locations:", locations);

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

  const source = map.getSource("locations");
  console.log(source);
  if (source) {
    // Source exists
    source.setData({
      type: "FeatureCollection",
      features: features,
    });
  } else {
    // Add GeoJSON source with features
    map.addSource("locations", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: features,
      },
    });

    map.loadImage("./bus.webp", (error, image) => {
      if (error) throw error;

      // Add the image to the map style.
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

  const popup = new mapboxgl.Popup();
  map.on("click", "locations", (e) => {
    const coordinates = e.features[0].geometry.coordinates.slice();
    console.log(e.features[0].properties);
    const name = e.features[0].properties.name;
    popup.setLngLat(coordinates).setHTML(name).addTo(map);
  });
};

const main = async (latitude, longitude) => {
  const viewOptions = {
    container: "viewDiv",
    style: "mapbox://styles/mapbox/streets-v11",
    center: [longitude, latitude],
    zoom: 14,
  };

  const map = new mapboxgl.Map(viewOptions);

  setInterval(() => {
    updateLayer(map);
    resetTimer();
  }, 10000);
};
getLocation();

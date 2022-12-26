
import { loadModules } from "https://unpkg.com/esri-loader/dist/esm/esri-loader.js";


const protobufUpdate = async () => {
  const url =
    "https://livemap.shivasurya.workers.dev?cacheBust=" +
    new Date().getTime();
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
  node.innerHTML = 15;
  timerInterval = setInterval(() => {
    const n = document.querySelector(".countdownTimer");
    n.innerHTML = n.innerHTML - 1;
  }, 1000);
}

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
const updateLayer = async (featureLayer, layerView) => {
  const [Graphic] = await loadModules(["esri/Graphic"]);

  // then get all the locations by calling the API (Protocol buffer service)
  const locations = await protobufUpdate();
  console.log("locations:", locations);

  // Add all the locations to the map:
  const graphics = locations.map(locationObject => {
    var point = {
      type: "point", // autocasts as new Polyline()
      latitude: locationObject.vehicle.position.latitude,
      longitude: locationObject.vehicle.position.longitude
    };

    var timeStampDate = new Date(0); // The 0 there is the key, which sets the date to the epoch
    timeStampDate.setUTCSeconds(locationObject.vehicle.timestamp);

    var attributes = {
      name: locationObject.vehicle.vehicle.label,
      timestamp: timeStampDate.toTimeString(),
      route: locationObject.vehicle.trip.route_id,
      route_start: locationObject.vehicle.trip.start_time
    };

    return new Graphic({
      geometry: point,
      attributes: attributes,
    });
  });

  // first clear out the graphicsLayer
  console.log('featureLayer:', featureLayer);
  layerView.queryFeatures().then((results) => {
    featureLayer.applyEdits({
      deleteFeatures: results.features,
      addFeatures: graphics
    });
  });
  
};

const main = async (latitude, longitude) => {

  const [Map, MapView, FeatureLayer] = await loadModules(
    ["esri/Map", "esri/views/MapView", "esri/layers/FeatureLayer"],
    { css: true }
  );

  const fl = new FeatureLayer({
    fields: [
      {
        name: "ObjectID",
        alias: "ObjectID",
        type: "oid"
      },
      {
        name: "name",
        alias: "Name",
        type: "string"
      },
      {
        name: "timestamp",
        alias: "timestamp",
        type: "string"
      },
      {
        name: "route",
        alias: "route",
        type: "string"
      },
      {
        name: "route_start",
        alias: "route_start",
        type: "string"
      }
    ],
    objectIdField: "ObjectID",
    geometryType: "point",
    renderer: {
      type: "simple", // autocasts as new SimpleRenderer()
      symbol: {
        type: "simple-marker", // autocasts as new SimpleMarkerSymbol()
        style: "circle",
        color: "blue",
        size: "15px", // pixels
        outline: {
          // autocasts as new SimpleLineSymbol()
          color: [255, 255, 255],
          width: 1, // points
        }
      }
    },
    popupTemplate: {
      title: "{name}",
      content:
        "Updated: {timestamp}<br />Route: {route} (Started {route_start})"
    },
    labelingInfo: [
      {  
        symbol: {
          type: "text",  
          color: "black",
         
          font: {  
             size: 10,
             weight: "bold"
           }
        },
        labelPlacement: "center-right",
        labelExpressionInfo: {
          expression: "$feature.name"
        },
        maxScale: 0,
        minScale: 100000
      }
    ],
    source: []
  });

  const map = new Map({
    basemap: "streets-navigation-vector",
    ground: "world-elevation",
    layers: [fl]
  });

  const viewOptions = {
    container: "viewDiv",
    map: map,
    center: [longitude, latitude],
    zoom: 14
  };

  // create 2D map:
  var view = new MapView(viewOptions);
  
  view.whenLayerView(fl).then(function(layerView) {
    console.log('layerView', layerView);
   
    updateLayer(fl, layerView);
    resetTimer();
   
    setInterval(() => {
      updateLayer(fl, layerView);
      resetTimer();
    }, 5000);
  });

  
};
getLocation();



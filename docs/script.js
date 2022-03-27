import { loadModules } from "https://unpkg.com/esri-loader/dist/esm/esri-loader.js";


const protobufUpdate = async () => {
  const url =
    "https://grffe.com/proxy/proxy.php?http://webapps.regionofwaterloo.ca/api/grt-routes/api/vehiclepositions?cacheBust=" +
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
  node.innerHTML = 10;
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

  // Add all the locations to the map:
  const graphics = locations.map(locationObject => {
    var point = {
      type: "point", // autocasts as new Polyline()
      latitude: locationObject.vehicle.position.latitude,
      longitude: locationObject.vehicle.position.longitude
    };

    var timeStampDate = new Date(); // The 0 there is the key, which sets the date to the epoch

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
 // console.log('featureLayer:', featureLayer);
  layerView.queryFeatures().then((results) => {
    featureLayer.applyEdits({
      deleteFeatures: results.features,
      addFeatures: graphics
    });
  });
  
};

const main = async (latitude, longitude) => {

  const [Map, MapView, FeatureLayer, Legend] = await loadModules(
    ["esri/Map", "esri/views/MapView", "esri/layers/FeatureLayer", "esri/widgets/Legend"],
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
    label: "bus",
    renderer: {
      type: "simple", // autocasts as new SimpleRenderer()
      visualVariables: [
        {
          type: "color",
          field: "route", // Carbon storage
          stops: [
            { value: "301", color: "red" }, 
            { value: "19", color: "green" },
            { value: "5", color: "orange" },
            { value: "202", color: "blue" },
            { value: "201", color: "black" },
            { value: "19", color: "yellow" },
            { value: "13", color: "Salmon" },
          ]
        }
      ],
      symbol: {
        type: "simple-marker", // autocasts as new SimpleMarkerSymbol()
      }
    },
    popupTemplate: {
      title: "{route}",
      content:
        "Updated: {timestamp}<br />Route: {route} (Started {route_start})"
    },
    labelingInfo: [
      {  
        symbol: {
          type: "text",  
          color: "black",
          font: {  
             size: 12,
             weight: "bold"
           }
        },
        labelPlacement: "center-right",
        labelExpressionInfo: {
          expression: "$feature.route"
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
    //console.log('layerView', layerView);
   
    updateLayer(fl, layerView);
    resetTimer();
   
    setInterval(() => {
      updateLayer(fl, layerView);
      resetTimer();
    }, 10000);
  });

};
getLocation();
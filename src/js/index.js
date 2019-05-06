/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

function IndoorSystemApp() {

  var map = L.map('map', {
    zoomControl: false
  }).fitWorld();

  if (MAPBOX_ACCESS_TOKEN) {
    L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}{r}.png?access_token=' + MAPBOX_ACCESS_TOKEN, {
      maxZoom: 23,
      attribution: 'Indoor Positioning System: Oscar Jiménez Jiménez, ' +
        'Imagery © Mapbox',
      id: 'mapbox.light',
      detectRetina: true
    }).addTo(map);
  }

  // fix Leaflet zooming bugs
  var zoomOngoing = false;
  map.on('zoomstart', function () {
    zoomOngoing = true;
  });
  map.on('zoomend', function () {
    zoomOngoing = false;
  });

  var accuracyCircle = null;
  var lastPosition = null;
  var wayfindingController = null;
  var blueDotMarker = null;
  var wayfindingController = new WayfindingController(map);

  this.onFloorChange = function () {
    console.log("floorChange");
    if (lastPosition) this.onLocationChanged(lastPosition);
    if (wayfindingController) {
      wayfindingController.setCurrentFloor(floorPlanSelector.getFloorNumber());
    }
  };

  this.onPositioningStarted = function () {
    map.on('mouseup', function (event) {
      // tap routes to pressed location
      var floor = floorPlanSelector.getFloorNumber();
      if (floor !== null) {
        cordovaAndIaController.requestWayfindingUpdates(
          event.latlng.lat,
          event.latlng.lng,
          floor);
      }
    });

    wayfindingController.setCurrentFloor(floorPlanSelector.getFloorNumber());
  }

  var floorPlanSelector = new FloorPlanSelector(map, this.onFloorChange.bind(this));

  this.onLocationChanged = function (position) {
    lastPosition = position;

    // updating graphics while zooming does not work in Leaflet
    if (zoomOngoing) return;

    var center = [position.coords.latitude, position.coords.longitude];

    function setBlueDotProperties() {
      accuracyCircle.setLatLng(center);
      accuracyCircle.setRadius(position.coords.accuracy);

      blueDotMarker.setLatLng(center);

      if (floorPlanSelector.getFloorNumber() !== position.coords.floor) {

        accuracyCircle.setStyle({ color: 'gray' });
        if (map.hasLayer(blueDotMarker)) {
          blueDotMarker.remove();
        }
      } else {
        accuracyCircle.setStyle({ color: 'blue' });
        if (!map.hasLayer(blueDotMarker)) {
          blueDotMarker.addTo(map);
        }
      }
    }

    if (!accuracyCircle) {
      // first location
      accuracyCircle = L.circle([0, 0], { radius: 1, opacity: 0 });
      blueDotMarker = L.marker([0, 0], {
        icon: L.icon({
          iconUrl: 'css/images/blue_dot.png',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      });

      setBlueDotProperties();

      accuracyCircle.addTo(map);
      blueDotMarker.addTo(map);

      var ZOOM_LEVEL = 19;
      map.setView(center, ZOOM_LEVEL);
    } else {
      setBlueDotProperties();
    }
  };

  this.onHeadingChanged = function (heading) {
    if (blueDotMarker) {
      blueDotMarker.setRotationAngle(heading);
    }
  };

  this.onEnterRegion = function (region) {
    if (region.regionType == Region.TYPE_FLOORPLAN) {
      floorPlanSelector.onEnterFloorPlan(region.floorPlan);
    } else if (region.regionType == Region.TYPE_VENUE && region.venue) {
      floorPlanSelector.onEnterVenue(region.venue);
    }
  };

  this.onExitRegion = function (region) {
    if (region.regionType == Region.TYPE_FLOORPLAN) {
      floorPlanSelector.onExitFloorPlan();
    } else if (region.regionType == Region.TYPE_VENUE) {
      floorPlanSelector.onExitVenue();
    }
  };

  this.onWayfindingUpdate = function (route) {
    wayfindingController.updateRoute(route);
    if (wayfindingController.routeFinished()) {
      console.log("wayfinding finished!");
      wayfindingController.hideRoute();
      cordovaAndIaController.removeWayfindingUpdates();
    }
  };
}

var cordovaAndIaController = {
  watchId: null,
  regionWatchId: null,

  // Application Constructor
  initialize: function () {
    this.bindEvents();
  },

  // Bind Cordova Event Listeners
  bindEvents: function () {
    document.addEventListener('deviceready', this.onDeviceReady.bind(this), false);
  },

  // deviceready Event Handler
  onDeviceReady: function () {
    this.configureIA();
  },

  // Configure IndoorAtlas SDK with API Key
  configureIA: function () {
    var _config = { key: IA_API_KEY, secret: IA_API_SECRET };
    IndoorAtlas.onStatusChanged(this.onStatusChanged.bind(this), alert);
    IndoorAtlas.initialize(
      this.IAServiceConfigured.bind(this),
      this.IAServiceFailed.bind(this), _config);
  },

  onStatusChanged: function (status) {
    console.log("status changed: " + status.message);
    if (status.code === CurrentStatus.STATUS_OUT_OF_SERVICE) {
      alert("Unrecoverable error: " + status.message);
    }
  },

  IAServiceFailed: function (result) {
    // Try again to initialize the service
    console.warn("IAServiceFailed, trying again: " + JSON.stringify(result));
    setTimeout(this.configureIA.bind(this), 2 * 1000);
  },

  IAServiceConfigured: function () {
    console.log("IA configured");
    this.startPositioning();
  },

  startPositioning: function () {
    console.log("starting positioning");

    var onError = this.IAServiceFailed.bind(this);

    // watch position
    if (this.watchId != null) {
      IndoorAtlas.clearWatch(this.watchId);
    }
    this.watchId = IndoorAtlas.watchPosition(
      app.onLocationChanged.bind(app), onError);

    // watch region
    if (this.regionWatchId != null) {
      IndoorAtlas.clearRegionWatch(this.regionWatchId);
    }
    this.regionWatchId = IndoorAtlas.watchRegion(
      app.onEnterRegion.bind(app),
      app.onExitRegion.bind(app), onError);

    IndoorAtlas.didUpdateHeading(function (heading) {
      app.onHeadingChanged(heading.trueHeading);
    });

    app.onPositioningStarted();
  },

  requestWayfindingUpdates: function (latitude, longitude, floor) {
    console.log("set/changed wayfinding destination");
    var onError = this.IAServiceFailed.bind(this);
    IndoorAtlas.requestWayfindingUpdates({
      latitude: latitude,
      longitude: longitude,
      floor: floor
    }, app.onWayfindingUpdate.bind(app), onError);
  },

  removeWayfindingUpdates: function () {
    console.log("stop wayfinding");
    IndoorAtlas.removeWayfindingUpdates();
  }
};

function BeaconConfig() {
  var nBeacons =
    [{ uuid: 'B9407F30-F5F8-466E-AFF9-25556B57FE6D', identifier: '887c51c6c8f5c8a37bc234e6c30c1a04', minor: '30708', major: '39902' },
    { uuid: 'B9407F30-F5F8-466E-AFF9-25556B57FE6D', identifier: 'bd2cbdacd2b6199c945411a4887e0119', minor: '20731', major: '60952' },
    { uuid: 'B9407F30-F5F8-466E-AFF9-25556B57FE6D', identifier: 'd38fcae31a6148d7ba210f301ca1b22b', minor: '64936', major: '41230' }];

  var delegate = new cordova.plugins.locationManager.Delegate();

  delegate.didDetermineStateForRegion = function (pluginResult) {

  };

  delegate.didStartMonitoringForRegion = function (pluginResult) {

  };

  delegate.didRangeBeaconsInRegion = function (pluginResult) {
    if (pluginResult.beacons.length > 0) {
      var b = pluginResult.beacons[0];
      switch (b.minor) {
        case '30708':
          if (b.proximity == 'ProximityImmediate') {
            //alert('Se encuentra muy cerca del Beacon Lemon');
          }
          break;
        case '20731':
          if (b.proximity == 'ProximityImmediate') {
            //alert('Se encuentra muy cerca del Beacon Candy');
          }
          break;
        case '64936':
          if (b.proximity == 'ProximityImmediate') {
            //alert('Se encuentra muy cerca del Beacon Beetroot');
          }
          break;
        default:
          console.log('No se encuentra en el rango de ningún Beacon');
      }
    }
  };

  cordova.plugins.locationManager.setDelegate(delegate);
  cordova.plugins.locationManager.requestAlwaysAuthorization();

  for (var i in nBeacons) {
    var b = nBeacons[i];
    var beaconRegion = new cordova.plugins.locationManager.BeaconRegion(b.identifier, b.uuid, b.major, b.minor);

    cordova.plugins.locationManager.startMonitoringForRegion(beaconRegion);
    cordova.plugins.locationManager.startRangingBeaconsInRegion(beaconRegion);
  }
}
 
cordovaAndIaController.initialize();
var app = new IndoorSystemApp();
document.addEventListener('deviceready', BeaconConfig);
/**
 * Distance Matrix API disabled — logbook uses haversine in the engine only.
 * Stub keeps global.distanceMatrixRoutingService for legacy script order.
 */
(function (global) {
  'use strict';
  function disabled() {
    return Promise.reject(new Error('Routing disabled'));
  }
  function noop() {}
  var distanceMatrixRoutingService = {
    getDistance: disabled,
    getDistances: disabled,
    setAddressCoordinates: noop
  };
  global.distanceMatrixRoutingService = distanceMatrixRoutingService;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = distanceMatrixRoutingService;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);

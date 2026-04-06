/**
 * Mock Routing Service (browser)
 * Returns fixed 10 km for all segments. No external API.
 */
(function (global) {
  'use strict';

  var mockRoutingService = {
    getDistance: function (from, to) {
      return Promise.resolve(10);
    },
    getDistances: function (home, addresses) {
      var map = new Map();
      addresses.forEach(function (addr) {
        map.set(addr, 10);
      });
      return Promise.resolve(map);
    }
  };

  global.mockRoutingService = mockRoutingService;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mockRoutingService;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);

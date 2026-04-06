(function () {
  'use strict';

  async function confirmPaymentAndAssignSlot(adId) {
    console.warn('Client-side slot assignment disabled. Use backend.');
    return Promise.resolve({
      success: false,
      error: 'Client-side assignment disabled'
    });
  }

  window.confirmPaymentAndAssignSlot = confirmPaymentAndAssignSlot;
})();

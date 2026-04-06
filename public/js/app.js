/**
 * Auto Logbook SA – App JS (modals, no frameworks)
 * Works with file:// (relative paths only).
 */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  function openModal(modalId) {
    window._lastModalOpener = document.activeElement;
    var modal = byId(modalId);
    if (modal) {
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeModal(modalId) {
    var modal = byId(modalId);
    if (modal) {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      if (window._lastModalOpener && typeof window._lastModalOpener.focus === 'function') {
        window._lastModalOpener.focus();
        window._lastModalOpener = null;
      }
    }
  }

  function initModals() {
    var disclaimerBtn = byId('openDisclaimer');
    var termsBtn = byId('openTerms');
    var privacyBtn = byId('openPrivacy');

    if (disclaimerBtn) {
      disclaimerBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openModal('disclaimerModal');
      });
    }
    if (termsBtn) {
      termsBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openModal('termsModal');
      });
    }
    if (privacyBtn) {
      privacyBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openModal('privacyModal');
      });
    }

    [ 'disclaimerModal', 'termsModal', 'privacyModal', 'refundPolicyModal' ].forEach(function (id) {
      var modal = byId(id);
      if (!modal) return;
      var closeBtn = modal.querySelector('.modal-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () { closeModal(id); });
      }
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal(id);
      });
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      var openModalEl = document.querySelector('.modal-overlay.is-open');
      if (openModalEl && openModalEl.id) {
        closeModal(openModalEl.id);
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModals);
  } else {
    initModals();
  }
})();

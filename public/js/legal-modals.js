/**
 * Load shared legal modals (Disclaimer, Terms, Privacy, Refund) from components/legal-modals.html
 * and bind footer links and close buttons. Used by index.html and logbook.html.
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

  function bindLegalModals() {
    var openPrivacy = byId('openPrivacyFooter');
    var openTerms = byId('openTermsFooter');
    var openDisclaimer = byId('openDisclaimerFooter');
    var openRefund = byId('openRefundPolicyFooter');

    if (openPrivacy) openPrivacy.addEventListener('click', function (e) { e.preventDefault(); openModal('privacyModal'); });
    if (openTerms) openTerms.addEventListener('click', function (e) { e.preventDefault(); openModal('termsModal'); });
    if (openDisclaimer) openDisclaimer.addEventListener('click', function (e) { e.preventDefault(); openModal('disclaimerModal'); });
    if (openRefund) openRefund.addEventListener('click', function (e) { e.preventDefault(); openModal('refundPolicyModal'); });

    [ 'disclaimerModal', 'termsModal', 'privacyModal', 'refundPolicyModal' ].forEach(function (id) {
      var modal = byId(id);
      if (!modal) return;
      var closeButtons = modal.querySelectorAll('.modal-close, .review-modal-close, #closeRefundPolicyModal');
      for (var i = 0; i < closeButtons.length; i++) {
        closeButtons[i].addEventListener('click', function () { closeModal(id); });
      }
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal(id);
      });
    });
  }

  function init() {
    var root = byId('legal-modals-root');
    if (!root) return;

    var path = 'components/legal-modals.html';
    if (typeof window.location !== 'undefined' && window.location.pathname.indexOf('/logbook') !== -1) {
      path = 'components/legal-modals.html';
    }

    fetch(path)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        root.innerHTML = html;
        bindLegalModals();
      })
      .catch(function () {
        root.innerHTML = '<!-- Legal modals failed to load -->';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

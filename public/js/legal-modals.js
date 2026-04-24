/**
 * Load shared legal modals (Disclaimer, Terms, Privacy, Refund) from components/legal-modals.html
 * and bind modal chrome. Footer legal links use document-level delegation so they work when the
 * footer is injected after load (e.g. /partials/footer.html). Used by index.html and logbook.html.
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

  var footerLegalDelegationInstalled = false;

  function installFooterLegalDelegation() {
    if (footerLegalDelegationInstalled) return;
    footerLegalDelegationInstalled = true;
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.nodeType !== 1) t = t.parentElement;
      if (!t || typeof t.id !== 'string' || !t.id) return;
      if (t.id === 'openPrivacyFooter') { e.preventDefault(); openModal('privacyModal'); return; }
      if (t.id === 'openTermsFooter') { e.preventDefault(); openModal('termsModal'); return; }
      if (t.id === 'openDisclaimerFooter') { e.preventDefault(); openModal('disclaimerModal'); return; }
      if (t.id === 'openRefundPolicyFooter') { e.preventDefault(); openModal('refundPolicyModal'); return; }
    });
  }

  function bindLegalModals() {
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

    installFooterLegalDelegation();

    var path = '/components/legal-modals.html';

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

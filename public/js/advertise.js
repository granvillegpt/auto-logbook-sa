/**
 * Advertise submission: pending ad + pricing from pricing/default.ads (featured, slot1–slot3).
 */
(function () {
  'use strict';
  const IS_ADMIN_PAGE =
    typeof window !== 'undefined' && window.location.pathname.includes('admin');
  if (IS_ADMIN_PAGE) return;
  if (!window.firebaseReady || !window.db) {
    console.error("🔥 FIREBASE NOT READY");
    return;
  }

  var ALLOWED_SLOTS = ['featured', 'slot1', 'slot2', 'slot3'];

  let selectedSlot = 'featured';
  let selectedMonths = [];

  var slotAdsPrices = { featured: 0, slot1: 0, slot2: 0, slot3: 0 };
  var adPricingConfigured = false;

  window.addEventListener('load', function () {
  var db = window.db;
  var storage = window.storage;

  var form = document.getElementById('advertiseForm');
  var successEl = document.getElementById('successMessage');
  var errorEl = document.getElementById('advertiseError');
  var submitBtn = document.getElementById('advertiseSubmitBtn');
  var fileInput = document.getElementById('adImageInput');
  var previewBox = document.getElementById('imagePreview');
  var previewImg = document.getElementById('imagePreviewImage');
  var previewThumb = document.getElementById('imagePreviewThumb');
  var previewWrap = document.getElementById('imagePreviewWrapper');
  var changeBtn = document.getElementById('imageChangeBtn');
  var slotPricingEl = document.getElementById('slotPricing');
  const focalImg = document.getElementById('focalPreviewImage');
  const focalWrapper = document.getElementById('focalPreviewWrapper');
  if (!focalImg || !focalWrapper) {
    console.error('Focal elements missing');
  }
  var focalPreviewUrl = null;
  var focalDragInitialized = false;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let posX = 50;
  let posY = 50;

  var selectedFile = null;
  var submitting = false;
  var homepageAdPreviewMount = document.getElementById('homepageAdPreviewMount');

  function escapeHtmlPreview(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getCurrentSlotKey() {
    var btn = document.querySelector('.slot-btn.selected');
    return getSlotKeyFromButton(btn) || selectedSlot || 'featured';
  }

  function getPreviewImageSrc() {
    if (focalPreviewUrl) return focalPreviewUrl;
    if (previewImg && previewImg.src && !previewImg.classList.contains('hidden')) {
      return previewImg.src;
    }
    return '';
  }

  function buildPreviewImageBlock(imgSrc, toolNameEsc, px, py) {
    var esc = escapeHtmlPreview(imgSrc);
    var x = Number(px);
    var y = Number(py);
    if (!isFinite(x)) x = 50;
    if (!isFinite(y)) y = 50;
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));
    return (
      '<div class="tool-image ad-image-wrapper">' +
      '<div class="ad-image-bg"></div><img class="ad-image-main" src="' +
      esc +
      '" alt="' +
      toolNameEsc +
      '" style="object-fit:cover;object-position:' + x + '% ' + y + '%;"></div>'
    );
  }

  function buildHomepagePreviewHtml(slotKey, ad) {
    var toolNameEsc = escapeHtmlPreview((ad.toolName || '').trim() || 'Your tool name');
    var descRaw = (ad.description || '').trim() || 'Your description will appear here';
    var descShort = descRaw.length > 140 ? descRaw.slice(0, 137) + '\u2026' : descRaw;
    var descEsc = descRaw ? escapeHtmlPreview(descShort) : '';
    var imgSrc = ad.imageSrc || '';
    var imageBlock = imgSrc
      ? buildPreviewImageBlock(imgSrc, toolNameEsc, ad.positionX, ad.positionY)
      : '<div class="tool-image ad-image-wrapper" style="min-height:120px;background:#e5e7eb;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:13px;border-radius:8px;">No image yet</div>';
    var card =
      '<div class="slot-card ad-slot-card ad-slot-filled">' +
      imageBlock +
      '<div class="ad-slot-filled-body">' +
      '<h3 class="ad-slot-title">' + toolNameEsc + '</h3>' +
      (descEsc ? '<p class="ad-slot-desc">' + descEsc + '</p>' : '') +
      '<button type="button" class="secondary-btn ad-slot-view-btn" tabindex="-1" disabled>View</button>' +
      '</div></div>';
    if (slotKey === 'featured') {
      return '<div class="ad-preview-featured-outer"><div class="ad-preview-featured-inner">' + card + '</div></div>';
    }
    return '<div class="ad-preview-slots-outer"><div class="slots-grid ad-slots-three-grid ad-preview-single-slot">' + card + '</div></div>';
  }

  function updateAdPreviewSlotLabel() {
    var el = document.getElementById('adPreviewSlotLabel');
    if (!el) return;
    var sk = getCurrentSlotKey();
    var map = {
      featured: 'Featured placement — full-width banner on the homepage',
      slot1: 'Slot 1 — same size as column 1 on the homepage',
      slot2: 'Slot 2 — same size as column 2 on the homepage',
      slot3: 'Slot 3 — same size as column 3 on the homepage'
    };
    el.textContent = map[sk] || map.featured;
  }

  function syncHomepagePreview() {
    if (!homepageAdPreviewMount || !form) return;
    var sk = getCurrentSlotKey();
    var toolName = (form.elements.toolName && form.elements.toolName.value) || '';
    var description = (form.elements.description && form.elements.description.value) || '';
    homepageAdPreviewMount.innerHTML = buildHomepagePreviewHtml(sk, {
      toolName: toolName,
      description: description,
      imageSrc: getPreviewImageSrc(),
      positionX: posX,
      positionY: posY
    });
  }

  function updateFocalPosition() {
    if (!focalImg) return;
    focalImg.style.objectPosition = `${posX}% ${posY}%`;
    var hx = document.getElementById('imagePosX');
    var hy = document.getElementById('imagePosY');
    if (hx) hx.value = String(posX);
    if (hy) hy.value = String(posY);
    syncHomepagePreview();
  }

  function initFocalDrag() {
    if (!focalImg) return;
    if (focalDragInitialized) return;
    focalDragInitialized = true;

    focalImg.draggable = false;

    focalImg.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      focalImg.style.cursor = 'grabbing';
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      if (focalImg) focalImg.style.cursor = 'grab';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      startX = e.clientX;
      startY = e.clientY;

      posX -= dx * 0.15;
      posY -= dy * 0.15;

      posX = Math.max(0, Math.min(100, posX));
      posY = Math.max(0, Math.min(100, posY));

      updateFocalPosition();
    });
  }

  function setError(msg) {
    if (errorEl) errorEl.textContent = msg || '';
    if (successEl) successEl.style.display = 'none';
  }

  function setSuccess(msg) {
    if (successEl) {
      var text = msg || 'Submitted successfully.';
      successEl.innerHTML =
        '<div class="success-message">' + escapeHtmlPreview(text) + '</div>';
      successEl.style.display = 'block';
    }
    if (errorEl) errorEl.textContent = '';
  }

  function setSubmitting(isLoading) {
    submitting = !!isLoading;
    if (!submitBtn) return;
    submitBtn.disabled = submitting;
    submitBtn.textContent = submitting ? 'Submitting…' : 'Submit Tool';
  }

  function safeUrl(url) {
    var s = (url || '').toString().trim();
    if (!s) return '';
    return s;
  }

  function clearPreview() {
    selectedFile = null;
    if (focalPreviewUrl) {
      URL.revokeObjectURL(focalPreviewUrl);
      focalPreviewUrl = null;
    }
    if (focalImg) {
      focalImg.src = '';
      focalImg.style.cursor = 'grab';
    }
    if (focalWrapper) focalWrapper.style.display = 'none';
    posX = 50;
    posY = 50;
    var hxClear = document.getElementById('imagePosX');
    var hyClear = document.getElementById('imagePosY');
    if (hxClear) hxClear.value = '50';
    if (hyClear) hyClear.value = '50';
    isDragging = false;
    if (fileInput) fileInput.value = '';
    if (previewImg) {
      previewImg.src = '';
      previewImg.classList.add('hidden');
    }
    if (previewThumb) previewThumb.src = '';
    if (previewWrap) previewWrap.classList.add('hidden');
    if (previewBox) previewBox.style.backgroundImage = '';
    syncHomepagePreview();
  }

  function wireImageInput() {
    if (!fileInput) return;
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        clearPreview();
        return;
      }
      if (!file.type || file.type.indexOf('image/') !== 0) {
        setError('Please upload an image file.');
        clearPreview();
        return;
      }
      selectedFile = file;
      if (focalPreviewUrl) {
        URL.revokeObjectURL(focalPreviewUrl);
        focalPreviewUrl = null;
      }
      focalPreviewUrl = URL.createObjectURL(file);
      if (focalImg) {
        focalImg.src = focalPreviewUrl;
        focalImg.style.objectPosition = '50% 50%';
      }
      if (focalWrapper) focalWrapper.style.display = 'block';
      posX = 50;
      posY = 50;
      updateFocalPosition();
      initFocalDrag();
      var reader = new FileReader();
      reader.onload = function (e) {
        var src = e && e.target ? e.target.result : '';
        if (previewImg) {
          previewImg.src = src;
          previewImg.classList.remove('hidden');
        }
        if (previewThumb) previewThumb.src = src;
        if (previewWrap) previewWrap.classList.remove('hidden');
        syncHomepagePreview();
      };
      reader.readAsDataURL(file);
    });
  }

  if (changeBtn) {
    changeBtn.addEventListener('click', function () {
      if (fileInput) fileInput.click();
    });
  }

  function applyAdsPricingFromDoc(data) {
    adPricingConfigured = false;
    slotAdsPrices.featured = 0;
    slotAdsPrices.slot1 = 0;
    slotAdsPrices.slot2 = 0;
    slotAdsPrices.slot3 = 0;
    var ads = data && data.ads;
    if (!ads || typeof ads !== 'object') return;
    var f = Number(ads.featured);
    var s1 = Number(ads.slot1);
    var s2 = Number(ads.slot2);
    var s3 = Number(ads.slot3);
    if (!Number.isFinite(f) || f <= 0) return;
    if (!Number.isFinite(s1) || s1 <= 0) return;
    if (!Number.isFinite(s2) || s2 <= 0) return;
    if (!Number.isFinite(s3) || s3 <= 0) return;
    slotAdsPrices.featured = f;
    slotAdsPrices.slot1 = s1;
    slotAdsPrices.slot2 = s2;
    slotAdsPrices.slot3 = s3;
    adPricingConfigured = true;
  }

  function renderPricingUiMessage() {
    if (!slotPricingEl) return;
    if (!adPricingConfigured) {
      slotPricingEl.innerHTML =
        '<div style="color:#b91c1c;font-weight:600;">Ad pricing is not configured right now.</div>';
    } else {
      slotPricingEl.innerHTML =
        '<div>Featured: R' + slotAdsPrices.featured + ' / month</div>' +
        '<div>Slot 1: R' + slotAdsPrices.slot1 + ' / month</div>' +
        '<div>Slot 2: R' + slotAdsPrices.slot2 + ' / month</div>' +
        '<div>Slot 3: R' + slotAdsPrices.slot3 + ' / month</div>';
    }
  }

  function loadPricingReadOnly() {
    if (!slotPricingEl) return;
    db.collection('pricing').doc('default').get()
      .then(function (doc) {
        if (doc && doc.exists) {
          applyAdsPricingFromDoc(doc.data());
        } else {
          applyAdsPricingFromDoc(null);
        }
        renderPricingUiMessage();
        updateSelectionSummary();
      })
      .catch(function () {
        applyAdsPricingFromDoc(null);
        renderPricingUiMessage();
        updateSelectionSummary();
      });
  }

  function getSlotPrice(slotKey) {
    if (!adPricingConfigured) return 0;
    var k = String(slotKey || '').toLowerCase();
    var n = Number(slotAdsPrices[k]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function totalPriceForMonths(slotKey, months) {
    var per = getSlotPrice(slotKey);
    var n = (months && months.length) ? months.length : 0;
    return per * n;
  }

  function updateSelectionSummary() {
    var summary = document.getElementById('selectionSummary');
    if (!summary) return;

    var monthText = selectedMonths.length
      ? selectedMonths.join(', ')
      : 'None';

    var slotKey = selectedSlot;
    var selectedBtn = document.querySelector('.slot-btn.selected');
    if (selectedBtn) {
      slotKey = getSlotKeyFromButton(selectedBtn) || selectedSlot;
    }
    var totalPrice = totalPriceForMonths(slotKey, selectedMonths);
    var totalPart = !adPricingConfigured ? '—' : ('R' + totalPrice);

    if (!selectedSlot && selectedMonths.length === 0) {
      summary.textContent = 'Select a slot to begin';
      return;
    }

    summary.textContent =
      'Selected: ' + (selectedSlot || '—') +
      ' | Months: ' + monthText +
      ' | Total: ' + totalPart;
  }

  function initMonthSelector() {
    var monthGrid = document.getElementById('monthGrid');

    if (!monthGrid) return;

    var months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    monthGrid.innerHTML = '';

    months.forEach(function (m, i) {
      var el = document.createElement('div');
      el.className = 'month-cell';
      el.textContent = m;
      el.dataset.month = m;

      el.addEventListener('click', function () {
        if (el.classList.contains('unavailable')) return;
        var month = el.textContent;
        var idx = selectedMonths.indexOf(month);
        if (idx !== -1) {
          selectedMonths = selectedMonths.filter(function (x) {
            return x !== month;
          });
          el.classList.remove('selected');
        } else {
          selectedMonths.push(month);
          el.classList.add('selected');
        }
        console.log('🔥 MONTHS:', selectedMonths);
        updateSelectionSummary();
      });

      monthGrid.appendChild(el);
    });

    updateMonthAvailability([]);
  }

  function monthAbbrevIndex(monthKey) {
    var abbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    var k = String(monthKey || '').toLowerCase().slice(0, 3);
    var i = abbr.indexOf(k);
    return i >= 0 ? i : -1;
  }

  function getSlotKeyFromButton(btn) {
    if (!btn) return '';
    return (btn.getAttribute('data-slot') || '').trim().toLowerCase();
  }

  async function getBookedMonths(slot) {
    if (!slot || !window.AdBooking) return [];

    var locked = window.AdBooking.slotLockedStatuses();
    const snapshot = await window.db
      .collection('sponsoredTools')
      .where('status', 'in', locked)
      .get();

    var booked = [];
    var uiCanon = window.AdBooking.canonicalSlotKey(slot);

    snapshot.docs.forEach(function (doc) {
      const data = doc.data();
      if (window.AdBooking.canonicalSlotKey(data.slot) !== uiCanon) return;
      const months = (data.months || []).map(function (m) {
        return window.AdBooking.monthKey(m);
      });
      booked = booked.concat(months);
    });

    return [...new Set(booked)];
  }

  function updateMonthAvailability(bookedMonths) {
    if (!window.AdBooking) return;
    const cells = document.querySelectorAll('.month-cell');
    const now = new Date();
    const curIdx = now.getMonth();

    cells.forEach(cell => {
      const month = (cell.dataset.month || '').toLowerCase().slice(0, 3);
      const mi = monthAbbrevIndex(month);
      const isPast = mi >= 0 && mi < curIdx;
      const isBooked = bookedMonths.indexOf(window.AdBooking.monthKey(month)) >= 0;

      if (isBooked || isPast) {
        cell.classList.add('unavailable');
        cell.style.pointerEvents = 'none';

        // 🔥 FORCE UNSELECT IF ALREADY SELECTED
        if (cell.classList.contains('selected')) {
          cell.classList.remove('selected');
        }

      } else {
        cell.classList.remove('unavailable');
        cell.style.pointerEvents = '';
      }
    });

    selectedMonths = selectedMonths.filter(function (m) {
      var k = window.AdBooking.monthKey(m);
      var mi = monthAbbrevIndex(k);
      if (mi >= 0 && mi < curIdx) return false;
      return bookedMonths.indexOf(k) < 0;
    });
    updateSelectionSummary();
  }

  async function handleSlotChange(slot) {
    try {
      const bookedMonths = await getBookedMonths(slot);
      updateMonthAvailability(bookedMonths);
    } catch (err) {
      console.error('Could not load booked months', err);
      updateMonthAvailability([]);
    }
  }

  function initSlotSelector() {
    var buttons = document.querySelectorAll('.slot-btn');

    if (!buttons.length) return;

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) {
          b.classList.remove('selected');
        });
        btn.classList.add('selected');
        selectedSlot = getSlotKeyFromButton(btn);
        console.log('🔥 SLOT SELECTED:', selectedSlot);
        updateSelectionSummary();
        updateAdPreviewSlotLabel();
        syncHomepagePreview();
        if (selectedSlot) handleSlotChange(selectedSlot);
      });
    });
  }

  function initPreviewBinding() {
    var toolNameInput = document.querySelector('[name="toolName"]');
    var descriptionInput = document.querySelector('[name="description"]');

    function syncText() {
      syncHomepagePreview();
    }

    if (toolNameInput) {
      toolNameInput.addEventListener('input', syncText);
    }
    if (descriptionInput) {
      descriptionInput.addEventListener('input', syncText);
    }
    syncHomepagePreview();
  }

  async function uploadImageIfAny() {
    if (!selectedFile) return '';
    var name = (selectedFile.name || 'image').replace(/\s+/g, '_');
    var path = 'ads/' + Date.now() + '_' + name;
    var ref = storage.ref().child(path);
    var snapshot = await ref.put(selectedFile);
    var url = await snapshot.ref.getDownloadURL();
    console.log('🔥 IMAGE UPLOAD SUCCESS');
    return url || '';
  }

  if (!form) return;
  wireImageInput();
  loadPricingReadOnly();
  initMonthSelector();
  initSlotSelector();
  updateSelectionSummary();
  initPreviewBinding();
  updateAdPreviewSlotLabel();

  (function runSlotAvailabilityOnce() {
    var selectedBtn = document.querySelector('.slot-btn.selected');
    if (!selectedBtn) return;
    var slotKey = getSlotKeyFromButton(selectedBtn);
    if (slotKey) handleSlotChange(slotKey);
  })();

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (submitting) return;
    setError('');

    var toolName = (form.elements.toolName && form.elements.toolName.value || '').toString().trim();
    var description = (form.elements.description && form.elements.description.value || '').toString().trim();
    var companyName = (form.elements.companyName && form.elements.companyName.value || '').toString();
    var contactEmail = (form.elements.contactEmail && form.elements.contactEmail.value || '').toString();
    var website = safeUrl(form.elements.url && form.elements.url.value);
    var whatsapp = (document.getElementById('whatsapp') && document.getElementById('whatsapp').value || '').toString();
    var instagram = (document.getElementById('instagram') && document.getElementById('instagram').value || '').toString();
    var facebook = (document.getElementById('facebook') && document.getElementById('facebook').value || '').toString();

    if (!toolName || !description) {
      setError('Please enter both tool name and description.');
      return;
    }

    if (!adPricingConfigured) {
      setError('Ad pricing is not configured right now.');
      return;
    }

    var selectedBtnSub = document.querySelector('.slot-btn.selected');
    var slotKeySubmit = getSlotKeyFromButton(selectedBtnSub) || selectedSlot;
    if (!slotKeySubmit || ALLOWED_SLOTS.indexOf(slotKeySubmit) < 0) {
      setError('Please select a placement (featured or slot 1–3).');
      return;
    }
    if (!selectedMonths.length) {
      setError('Select at least one month.');
      return;
    }
    if (getSlotPrice(slotKeySubmit) <= 0) {
      setError('Ad pricing is not configured right now.');
      return;
    }

    var curIdxSubmit = new Date().getMonth();
    var hasPastMonth = selectedMonths.some(function (m) {
      var mi = monthAbbrevIndex(m);
      return mi >= 0 && mi < curIdxSubmit;
    });
    if (hasPastMonth) {
      setError('Past months cannot be selected.');
      return;
    }

    setSubmitting(true);
    try {
      var imageUrl = await uploadImageIfAny();
      syncHomepagePreview();

      const slotKey = slotKeySubmit;
      var amount = totalPriceForMonths(slotKey, selectedMonths);
      var pricePerMonth =
        selectedMonths.length > 0
          ? Math.round(amount / selectedMonths.length)
          : 0;

      var ipxEl = document.getElementById('imagePosX');
      var ipyEl = document.getElementById('imagePosY');
      var ipx = ipxEl ? Number(ipxEl.value) : 50;
      var ipy = ipyEl ? Number(ipyEl.value) : 50;
      if (!Number.isFinite(ipx)) ipx = 50;
      if (!Number.isFinite(ipy)) ipy = 50;
      ipx = Math.max(0, Math.min(100, ipx));
      ipy = Math.max(0, Math.min(100, ipy));

      var payload = {
        toolName: String(toolName || '').trim(),
        description: String(description || '').trim(),
        companyName: String(companyName || ''),
        contactEmail: String(contactEmail || ''),
        image: imageUrl || '',
        website: website || '',
        whatsapp: whatsapp || '',
        instagram: instagram || '',
        facebook: facebook || '',
        slot: slotKey,
        months: selectedMonths,
        amount: amount,
        pricePerMonth: pricePerMonth,
        emailSent: false,
        endDate: null,
        imagePosition: { x: ipx, y: ipy },
        positionX: ipx,
        positionY: ipy
      };

      var submitRes = await fetch('/api/submit-ad', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      var submitData = {};
      try {
        submitData = await submitRes.json();
      } catch (_e) {
        throw new Error('Submission failed. Please try again.');
      }
      if (!submitRes.ok || !submitData.success) {
        throw new Error((submitData && submitData.error) ? submitData.error : 'Submission failed. Please try again.');
      }
      console.log('🔥 AD SUBMIT SUCCESS');
      setSuccess('Submitted successfully. We will review your ad.');
      form.reset();
      clearPreview();
    } catch (err) {
      console.error('🔥 AD SUBMIT ERROR', err);
      setError((err && err.message) ? err.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  });
  });
})();

/**
 * ClearTrack Logbook UI – local mode
 * Wired to engine-core: parseRouteListExcel, runLogbookEngine. No Firebase.
 */

import { parseRouteListExcel } from '../engine-core/parseRouteListExcel.js';
import { runLogbookEngine } from '../engine-core/logbookEngine.js';
import { mockRoutingService } from '../engine-core/mockRouting.js';
import { exportXlsx } from './lib/exportXlsx.js';

console.log("[logbook] module loaded (local)");

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = typeof result === 'string' && result.startsWith('data:') ? result.split(',')[1] : result;
      resolve(base64 || '');
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function initializeRoutelistHandler() {
  const parseBtn = document.getElementById('parseRouteBtn');
  if (!parseBtn) return;
  const newBtn = parseBtn.cloneNode(true);
  parseBtn.parentNode.replaceChild(newBtn, parseBtn);

  newBtn.addEventListener('click', async () => {
    const fileInput = document.getElementById('routeFileInput');
    const status = document.getElementById('routeStatus');
    const file = ctDroppedRoutelistFile || (fileInput && fileInput.files && fileInput.files[0]) || null;

    if (!file) {
      if (status) { status.textContent = 'Please select a file.'; status.style.color = 'red'; }
      return;
    }
    newBtn.disabled = true;
    newBtn.textContent = 'Generating...';
    if (status) { status.textContent = 'Processing routelist...'; status.style.color = '#1f6f78'; }

    readFileAsArrayBuffer(file).then(async (arrayBuffer) => {
      try {
        const routes = parseRouteListExcel(arrayBuffer);
        if (status) { status.textContent = 'Routelist parsed successfully. ' + routes.length + ' route(s) found. Proceed to Logbook below.'; status.style.color = 'green'; }
        newBtn.disabled = false;
        newBtn.textContent = 'Generate Routelist (Free)';
      } catch (err) {
        if (status) { status.textContent = 'Invalid routelist format. Please ensure you are using the ClearTrack routelist template and that all required columns are present before uploading.'; status.style.color = 'red'; }
        newBtn.disabled = false;
        newBtn.textContent = 'Generate Routelist (Free)';
        console.error(err);
      }
    }).catch(() => {
      if (status) { status.textContent = 'Failed to read file.'; status.style.color = 'red'; }
      newBtn.disabled = false;
      newBtn.textContent = 'Generate Routelist (Free)';
    });
  });
}

function initRoutelistDropzone() {
  var dropzone = document.getElementById('routelist-dropzone');
  var fileInput = document.getElementById('routeFileInput');
  var filenameEl = document.getElementById('routelist-dropzone-filename');
  if (!dropzone || !fileInput) return;
  function setFilename(f) {
    if (filenameEl) filenameEl.textContent = f && f.name ? f.name : '';
  }
  dropzone.addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    ctDroppedRoutelistFile = f;
    setFilename(f);
  });
  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', function () {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    var files = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : null;
    var f = files && files[0] ? files[0] : null;
    if (f && (/\.(xlsx|xls)$/i).test(f.name || '')) {
      ctDroppedRoutelistFile = f;
      setFilename(f);
    }
  });
}

let logbookLoaded = false;
var ctDroppedExcelFile = null;
var ctDroppedRoutelistFile = null;

async function loadLogbookTabHTML() {
  if (logbookLoaded) {
    console.log("[logbook] already loaded");
    return;
  }
  const section = document.getElementById("logbook");
  if (!section) {
    console.warn("[logbook] #logbook section missing");
    return;
  }

  console.log("[logbook] Loading HTML file...");
  const res = await fetch("tabs/practitioner/logbook/logbook.html", { cache: "no-store" });
  console.log("[logbook] fetch", res.status, res.ok);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const html = await res.text();
  console.log("[logbook] HTML loaded length", html.length);
  console.log("[logbook] Injecting into section", section ? section.id : undefined);

  section.innerHTML = html;
  logbookLoaded = true;

  requestAnimationFrame(() => {
    console.log("[logbook] Calling initLogbookHandlers");
    initLogbookHandlers();
  });
}

function populateTaxYearSelect() {
  const sel = document.getElementById('taxYear');
  if (!sel) return;
  sel.innerHTML = '';
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const sarsStart = month >= 2 ? year : year - 1;
  for (let i = 0; i < 10; i++) {
    const s = sarsStart - i;
    const e = s + 1;
    const opt = document.createElement('option');
    opt.value = s + '/' + e;
    opt.textContent = s + ' / ' + e + ' (1 Mar ' + s + ' – 28 Feb ' + e + ')';
    if (i === 0) opt.selected = true;
    sel.appendChild(opt);
  }
  updateDatesFromTaxYear();
}

function updateDatesFromTaxYear() {
  const sel = document.getElementById('taxYear');
  const startIn = document.getElementById('startDate');
  const endIn = document.getElementById('endDate');
  if (!sel || !startIn || !endIn) return;
  const v = sel.value;
  const m = v.match(/^(\d{4})\/(\d{4})$/);
  if (m) {
    const s = parseInt(m[1], 10);
    const e = parseInt(m[2], 10);
    if (e === s + 1) {
      startIn.value = s + '-03-01';
      endIn.value = e + '-02-28';
    }
  }
}

let leaveDaysArray = [];
let manualEntriesArray = [];

var currentMonth = new Date().getMonth();
var currentYear = new Date().getFullYear();
var selectedDates = new Set();
var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var renderCT = function () {};

var isDragging = false;
var dragStartDate = null;
var dragEndDate = null;
var dragMouseupHandler = null;
var dragJustEnded = false;

var adjCurrentMonth = new Date().getMonth();
var adjCurrentYear = new Date().getFullYear();
var adjustmentSelectedDates = new Set();
var adjIsDragging = false;
var adjDragStartDate = null;
var adjDragEndDate = null;
var adjDragMouseupHandler = null;
var adjDragJustEnded = false;
var renderAdjCT = function () {};
var pendingManualTripStartDate = '';
var pendingManualTripEndDate = '';

function renderTempRange(gridEl, dragStart, dragEnd, selectedSet) {
  if (!gridEl) return;
  var cells = gridEl.querySelectorAll('[data-iso]');
  if (!dragStart || !dragEnd) {
    cells.forEach(function (el) { el.classList.remove('ct-day-drag-range'); });
    return;
  }
  var start = dragStart < dragEnd ? dragStart : dragEnd;
  var end = dragStart < dragEnd ? dragEnd : dragStart;
  cells.forEach(function (el) {
    var iso = el.dataset.iso;
    if (iso && iso >= start && iso <= end) {
      el.classList.add('ct-day-drag-range');
    } else {
      el.classList.remove('ct-day-drag-range');
    }
  });
}

function addRangeToSet(startIso, endIso, set) {
  var start = startIso < endIso ? startIso : endIso;
  var end = startIso < endIso ? endIso : startIso;
  var d = new Date(start + 'T12:00:00');
  var e = new Date(end + 'T12:00:00');
  while (d.getTime() <= e.getTime()) {
    set.add(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
}

function initCTCalendar(listEl, mode) {
  mode = mode || 'leave';
  var m = document.getElementById('ct-month-select');
  var y = document.getElementById('ct-year-select');
  var g = document.getElementById('ct-calendar-grid');
  if (!m || !y || !g) return;

  monthNames.forEach(function (n, i) {
    var o = document.createElement('option');
    o.value = i;
    o.textContent = n;
    m.appendChild(o);
  });
  for (var yr = currentYear - 5; yr <= currentYear + 5; yr++) {
    var o = document.createElement('option');
    o.value = yr;
    o.textContent = yr;
    y.appendChild(o);
  }
  m.value = currentMonth;
  y.value = currentYear;

  function render() {
    g.innerHTML = '';
    var first = new Date(currentYear, currentMonth, 1).getDay();
    var days = new Date(currentYear, currentMonth + 1, 0).getDate();
    var i, d, iso, c;
    for (i = 0; i < first; i++) g.appendChild(document.createElement('div'));
    for (d = 1; d <= days; d++) {
      iso = currentYear + '-' + String(currentMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      c = document.createElement('div');
      c.textContent = d;
      if (selectedDates.has(iso)) c.classList.add('ct-day-selected');
      c.setAttribute('data-iso', iso);
      c.addEventListener('mousedown', function (ev) {
        var dayIso = this.dataset.iso;
        if (!dayIso) return;
        isDragging = true;
        dragStartDate = dayIso;
        dragEndDate = dayIso;
        renderTempRange(g, dragStartDate, dragEndDate, selectedDates);
        if (dragMouseupHandler) {
          document.removeEventListener('mouseup', dragMouseupHandler);
          dragMouseupHandler = null;
        }
        dragMouseupHandler = function () {
          document.removeEventListener('mouseup', dragMouseupHandler);
          dragMouseupHandler = null;
          isDragging = false;
          var s = dragStartDate;
          var e = dragEndDate;
          dragStartDate = null;
          dragEndDate = null;
          renderTempRange(g, null, null);
          if (s && e && mode === 'leave') {
            dragJustEnded = true;
            addRangeToSet(s, e, selectedDates);
          }
          render();
        };
        document.addEventListener('mouseup', dragMouseupHandler);
      });
      c.addEventListener('mouseenter', function () {
        if (!isDragging) return;
        var dayIso = this.dataset.iso;
        if (dayIso) {
          dragEndDate = dayIso;
          renderTempRange(g, dragStartDate, dragEndDate, selectedDates);
        }
      });
      c.onclick = function () {
        if (dragJustEnded) {
          dragJustEnded = false;
          return;
        }
        var dayIso = this.getAttribute('data-iso');
        if (selectedDates.has(dayIso)) selectedDates.delete(dayIso); else selectedDates.add(dayIso);
        render();
      };
      g.appendChild(c);
    }
    if (listEl) {
      listEl.innerHTML = '';
      Array.from(selectedDates).sort().forEach(function (iso) {
        var chip = document.createElement('span');
        chip.className = 'leave-day-chip';
        chip.innerHTML = iso + ' <button type="button" aria-label="Remove">×</button>';
        var btn = chip.querySelector('button');
        btn.addEventListener('click', function () {
          selectedDates.delete(iso);
          render();
        });
        listEl.appendChild(chip);
      });
    }
  }
  renderCT = render;

  document.getElementById('ct-prev-month').onclick = function () {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    m.value = currentMonth;
    y.value = currentYear;
    render();
  };
  document.getElementById('ct-next-month').onclick = function () {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    m.value = currentMonth;
    y.value = currentYear;
    render();
  };
  m.onchange = function (e) { currentMonth = parseInt(e.target.value, 10); render(); };
  y.onchange = function (e) { currentYear = parseInt(e.target.value, 10); render(); };
  render();
}

function initLeaveModal() {
  const openBtn = document.getElementById('openLeaveModalBtn');
  const modal = document.getElementById('leaveModal');
  const closeBtn = document.getElementById('closeLeaveModal');
  const addBtn = document.getElementById('leaveAddBtn');
  const listEl = document.getElementById('leaveDateList');
  const hidden = document.getElementById('leaveDaysInput');
  const listDisplay = document.getElementById('leaveDaysList');
  var ctCalendarInited = false;

  function sync() {
    if (hidden) hidden.value = JSON.stringify(leaveDaysArray);
    if (listDisplay) listDisplay.textContent = leaveDaysArray.length ? leaveDaysArray.length + ' leave days selected' : '';
  }

  if (openBtn && modal) {
    openBtn.addEventListener('click', function () {
      document.getElementById('manualAdjustmentModal').classList.add('hidden');
      document.getElementById('manualTripDetailsModal').classList.add('hidden');
      selectedDates = new Set(leaveDaysArray || []);
      if (!ctCalendarInited) {
        initCTCalendar(listEl, 'leave');
        ctCalendarInited = true;
      } else {
        renderCT();
      }
      modal.classList.remove('hidden');
    });
  }
  if (closeBtn && modal) closeBtn.addEventListener('click', function () { modal.classList.add('hidden'); });
  if (addBtn && modal) {
    addBtn.addEventListener('click', function () {
      leaveDaysArray = Array.from(selectedDates).sort();
      sync();
      modal.classList.add('hidden');
    });
  }
  if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.add('hidden'); });
  sync();
}

var editingManualEntryId = null;
var manualAdjustmentCalendarInited = false;

function initManualAdjustmentCalendar() {
  var m = document.getElementById('ct-adj-month-select');
  var y = document.getElementById('ct-adj-year-select');
  var g = document.getElementById('ct-adj-calendar-grid');
  var listEl = document.getElementById('manualAdjustmentDateList');
  if (!m || !y || !g) return;

  m.innerHTML = '';
  y.innerHTML = '';
  monthNames.forEach(function (n, i) {
    var o = document.createElement('option');
    o.value = i;
    o.textContent = n;
    m.appendChild(o);
  });
  for (var yr = adjCurrentYear - 5; yr <= adjCurrentYear + 5; yr++) {
    var o = document.createElement('option');
    o.value = yr;
    o.textContent = yr;
    y.appendChild(o);
  }
  m.value = adjCurrentMonth;
  y.value = adjCurrentYear;

  function render() {
    g.innerHTML = '';
    var first = new Date(adjCurrentYear, adjCurrentMonth, 1).getDay();
    var days = new Date(adjCurrentYear, adjCurrentMonth + 1, 0).getDate();
    var i, d, iso, c;
    for (i = 0; i < first; i++) g.appendChild(document.createElement('div'));
    for (d = 1; d <= days; d++) {
      iso = adjCurrentYear + '-' + String(adjCurrentMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      c = document.createElement('div');
      c.textContent = d;
      if (adjustmentSelectedDates.has(iso)) c.classList.add('ct-day-selected');
      c.setAttribute('data-iso', iso);
      c.addEventListener('mousedown', function (ev) {
        var dayIso = this.dataset.iso;
        if (!dayIso) return;
        adjIsDragging = true;
        adjDragStartDate = dayIso;
        adjDragEndDate = dayIso;
        renderTempRange(g, adjDragStartDate, adjDragEndDate);
        if (adjDragMouseupHandler) return;
        adjDragMouseupHandler = function () {
          document.removeEventListener('mouseup', adjDragMouseupHandler);
          adjDragMouseupHandler = null;
          adjIsDragging = false;
          var s = adjDragStartDate;
          var e = adjDragEndDate;
          adjDragStartDate = null;
          adjDragEndDate = null;
          renderTempRange(g, null, null);
          if (s && e) {
            adjDragJustEnded = true;
            addRangeToSet(s, e, adjustmentSelectedDates);
          }
          render();
        };
        document.addEventListener('mouseup', adjDragMouseupHandler);
      });
      c.addEventListener('mouseenter', function () {
        if (!adjIsDragging) return;
        var dayIso = this.dataset.iso;
        if (dayIso) {
          adjDragEndDate = dayIso;
          renderTempRange(g, adjDragStartDate, adjDragEndDate);
        }
      });
      c.onclick = function () {
        if (adjDragJustEnded) {
          adjDragJustEnded = false;
          return;
        }
        var dayIso = this.getAttribute('data-iso');
        if (adjustmentSelectedDates.has(dayIso)) adjustmentSelectedDates.delete(dayIso); else adjustmentSelectedDates.add(dayIso);
        render();
      };
      g.appendChild(c);
    }
    if (listEl) {
      listEl.innerHTML = '';
      Array.from(adjustmentSelectedDates).sort().forEach(function (iso) {
        var chip = document.createElement('span');
        chip.className = 'leave-day-chip';
        chip.innerHTML = iso + ' <button type="button" aria-label="Remove">×</button>';
        var btn = chip.querySelector('button');
        btn.addEventListener('click', function () {
          adjustmentSelectedDates.delete(iso);
          render();
        });
        listEl.appendChild(chip);
      });
    }
  }
  renderAdjCT = render;

  document.getElementById('ct-adj-prev-month').onclick = function () {
    adjCurrentMonth--;
    if (adjCurrentMonth < 0) { adjCurrentMonth = 11; adjCurrentYear--; }
    m.value = adjCurrentMonth;
    y.value = adjCurrentYear;
    render();
  };
  document.getElementById('ct-adj-next-month').onclick = function () {
    adjCurrentMonth++;
    if (adjCurrentMonth > 11) { adjCurrentMonth = 0; adjCurrentYear++; }
    m.value = adjCurrentMonth;
    y.value = adjCurrentYear;
    render();
  };
  m.onchange = function (e) { adjCurrentMonth = parseInt(e.target.value, 10); render(); };
  y.onchange = function (e) { adjCurrentYear = parseInt(e.target.value, 10); render(); };
  render();
}

function renderManualEntriesList() {
  var container = document.getElementById('manualEntriesList');
  var hidden = document.getElementById('manualEntriesInput');
  if (!container) return;
  if (hidden) hidden.value = JSON.stringify(manualEntriesArray);
  container.innerHTML = '';
  manualEntriesArray.forEach(function (entry) {
    var row = document.createElement('div');
    var rangeText = (entry.startDate && entry.endDate) ? entry.startDate + ' – ' + entry.endDate : '';
    var typeLabel = entry.type === 'office' ? 'Office Day' : entry.type === 'colleague' ? 'Driving With Colleague' : entry.type === 'manual' ? 'Manual Trip' : (entry.type || '');
    row.textContent = rangeText + ' ' + typeLabel + ' ';
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.setAttribute('aria-label', 'Delete');
    var img = document.createElement('img');
    img.src = 'ui/assets/icons/trash.svg';
    img.alt = '';
    img.width = 16;
    img.height = 16;
    delBtn.appendChild(img);
    delBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      window.dispatchEvent(new CustomEvent('manual-entry-delete', { detail: { entryId: entry.id } }));
    });
    row.appendChild(delBtn);
    row.addEventListener('click', function (ev) {
      if (ev.target === delBtn || delBtn.contains(ev.target)) return;
      editingManualEntryId = entry.id;
      if (entry.type === 'manual') {
        document.getElementById('leaveModal').classList.add('hidden');
        document.getElementById('manualAdjustmentModal').classList.add('hidden');
        var fromIn = document.getElementById('manualTripFrom');
        var toIn = document.getElementById('manualTripTo');
        var purposeIn = document.getElementById('manualTripPurpose');
        var kmIn = document.getElementById('manualTripKm');
        if (fromIn) fromIn.value = entry.from || '';
        if (toIn) toIn.value = entry.to || '';
        if (purposeIn) purposeIn.value = entry.purpose || '';
        if (kmIn) kmIn.value = entry.km != null ? entry.km : '';
        pendingManualTripStartDate = entry.startDate || '';
        pendingManualTripEndDate = entry.endDate || '';
        document.getElementById('manualTripDetailsModal').classList.remove('hidden');
      } else {
        document.getElementById('manualTripDetailsModal').classList.add('hidden');
        adjustmentSelectedDates = new Set();
        if (entry.startDate && entry.endDate) {
          addRangeToSet(entry.startDate, entry.endDate, adjustmentSelectedDates);
          var d = new Date(entry.startDate + 'T12:00:00');
          adjCurrentMonth = d.getMonth();
          adjCurrentYear = d.getFullYear();
        }
        var typeSelect = document.getElementById('manualAdjustmentType');
        if (typeSelect) typeSelect.value = entry.type || 'office';
        if (!manualAdjustmentCalendarInited) {
          initManualAdjustmentCalendar();
          manualAdjustmentCalendarInited = true;
        } else {
          var adjM = document.getElementById('ct-adj-month-select');
          var adjY = document.getElementById('ct-adj-year-select');
          if (adjM) adjM.value = adjCurrentMonth;
          if (adjY) adjY.value = adjCurrentYear;
          renderAdjCT();
        }
        document.getElementById('manualAdjustmentModal').classList.remove('hidden');
      }
    });
    container.appendChild(row);
  });
}

function initManualAdjustmentModal() {
  const openBtn = document.getElementById('addManualTripBtn');
  const modal = document.getElementById('manualAdjustmentModal');
  const closeBtn = document.getElementById('closeManualAdjustmentModal');
  const saveBtn = document.getElementById('manualAdjustmentSaveBtn');
  const typeSelect = document.getElementById('manualAdjustmentType');

  if (openBtn && modal) {
    openBtn.addEventListener('click', function () {
      document.getElementById('leaveModal').classList.add('hidden');
      document.getElementById('manualTripDetailsModal').classList.add('hidden');
      editingManualEntryId = null;
      adjustmentSelectedDates = new Set();
      var now = new Date();
      adjCurrentMonth = now.getMonth();
      adjCurrentYear = now.getFullYear();
      if (typeSelect) typeSelect.value = 'office';
      if (!manualAdjustmentCalendarInited) {
        initManualAdjustmentCalendar();
        manualAdjustmentCalendarInited = true;
      } else {
        var adjM = document.getElementById('ct-adj-month-select');
        var adjY = document.getElementById('ct-adj-year-select');
        if (adjM) adjM.value = adjCurrentMonth;
        if (adjY) adjY.value = adjCurrentYear;
        renderAdjCT();
      }
      modal.classList.remove('hidden');
    });
  }
  if (closeBtn && modal) closeBtn.addEventListener('click', function () {
    editingManualEntryId = null;
    modal.classList.add('hidden');
  });
  if (saveBtn && modal) {
    saveBtn.addEventListener('click', function () {
      var dates = Array.from(adjustmentSelectedDates).sort();
      if (dates.length === 0) return;
      var startDate = dates[0];
      var endDate = dates[dates.length - 1];
      var type = (typeSelect && typeSelect.value) ? typeSelect.value : 'office';
      if (type === 'office' || type === 'colleague') {
        window.dispatchEvent(new CustomEvent('manual-entry-submit', {
          detail: editingManualEntryId ? { id: editingManualEntryId, type: type, startDate: startDate, endDate: endDate } : { type: type, startDate: startDate, endDate: endDate }
        }));
        editingManualEntryId = null;
        modal.classList.add('hidden');
        renderManualEntriesList();
      } else if (type === 'manual') {
        pendingManualTripStartDate = startDate;
        pendingManualTripEndDate = endDate;
        modal.classList.add('hidden');
        document.getElementById('manualTripFrom').value = '';
        document.getElementById('manualTripTo').value = '';
        document.getElementById('manualTripPurpose').value = '';
        document.getElementById('manualTripKm').value = '';
        document.getElementById('manualTripDetailsModal').classList.remove('hidden');
      }
    });
  }
  if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.add('hidden'); });
  renderManualEntriesList();
}

function initManualTripDetailsModal() {
  const modal = document.getElementById('manualTripDetailsModal');
  const closeBtn = document.getElementById('closeManualTripDetailsModal');
  const cancelBtn = document.getElementById('cancelManualTripDetails');
  const saveBtn = document.getElementById('saveManualTripDetails');

  if (closeBtn && modal) closeBtn.addEventListener('click', function () { modal.classList.add('hidden'); });
  if (cancelBtn && modal) cancelBtn.addEventListener('click', function () { modal.classList.add('hidden'); });
  if (saveBtn && modal) {
    saveBtn.addEventListener('click', function () {
      var from = (document.getElementById('manualTripFrom') && document.getElementById('manualTripFrom').value) ? document.getElementById('manualTripFrom').value.trim() : '';
      var to = (document.getElementById('manualTripTo') && document.getElementById('manualTripTo').value) ? document.getElementById('manualTripTo').value.trim() : '';
      var purpose = (document.getElementById('manualTripPurpose') && document.getElementById('manualTripPurpose').value) ? document.getElementById('manualTripPurpose').value.trim() : '';
      var kmVal = document.getElementById('manualTripKm');
      var km = kmVal && kmVal.value !== '' ? parseFloat(kmVal.value, 10) : undefined;
      var startDate = pendingManualTripStartDate || '';
      var endDate = pendingManualTripEndDate || '';
      if (!startDate || !endDate) return;
      if (editingManualEntryId) {
        var idx = manualEntriesArray.findIndex(function (e) { return e.id === editingManualEntryId; });
        if (idx !== -1) {
          manualEntriesArray[idx] = { id: editingManualEntryId, type: 'manual', startDate: startDate, endDate: endDate, from: from, to: to, purpose: purpose, km: km };
        }
      } else {
        manualEntriesArray.push({ id: crypto.randomUUID(), type: 'manual', startDate: startDate, endDate: endDate, from: from, to: to, purpose: purpose, km: km });
      }
      editingManualEntryId = null;
      modal.classList.add('hidden');
      renderManualEntriesList();
    });
  }
  if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.add('hidden'); });
}

function initLogbookExcelDropzone() {
  var dropzone = document.getElementById('route-dropzone');
  var fileInput = document.getElementById('logbookExcelInput');
  var filenameEl = document.getElementById('route-dropzone-filename');
  if (!dropzone || !fileInput) return;
  function setFilename(f) {
    if (filenameEl) filenameEl.textContent = f && f.name ? f.name : '';
  }
  dropzone.addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    ctDroppedExcelFile = f;
    setFilename(f);
  });
  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', function () {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    var files = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : null;
    var f = files && files[0] ? files[0] : null;
    ctDroppedExcelFile = f;
    setFilename(f);
  });
}

function initHomeAddressAutocomplete() {
  const homeInput = document.getElementById('homeAddress');
  if (!homeInput) return;
  // Set window.CLEARTRACK_GOOGLE_MAPS_API_KEY (e.g. in app config) to enable address autocomplete.
  var key = (typeof window.CLEARTRACK_GOOGLE_MAPS_API_KEY === 'string' && window.CLEARTRACK_GOOGLE_MAPS_API_KEY.trim()) ? window.CLEARTRACK_GOOGLE_MAPS_API_KEY.trim() : '';
  function attachAutocomplete() {
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) return;
    var autocomplete = new google.maps.places.Autocomplete(homeInput, {
      types: ['address'],
      componentRestrictions: { country: 'za' }
    });
    autocomplete.addListener('place_changed', function () {
      var place = autocomplete.getPlace();
      if (place && place.formatted_address) homeInput.value = place.formatted_address;
    });
  }
  if (typeof google !== 'undefined' && google.maps && google.maps.places) {
    attachAutocomplete();
    return;
  }
  if (!key) return;
  var script = document.createElement('script');
  script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&libraries=places';
  script.async = true;
  script.defer = true;
  script.onload = attachAutocomplete;
  document.head.appendChild(script);
}

function initLogbookHandlers() {
  var templateBtn = document.getElementById('downloadRoutelistTemplateBtn');
  if (templateBtn && templateBtn.getAttribute('href') === '#') {
    templateBtn.addEventListener('click', function (e) {
      e.preventDefault();
      alert('Template not available in local mode. Use an Excel file with columns: Street Address, Suburb, City, Province, Mon–Sat, Weeks.');
    });
  }
  initializeRoutelistHandler();
  initRoutelistDropzone();
  populateTaxYearSelect();
  const taxSel = document.getElementById('taxYear');
  if (taxSel) taxSel.addEventListener('change', updateDatesFromTaxYear);

  initLogbookExcelDropzone();
  initHomeAddressAutocomplete();

  initLeaveModal();
  initManualAdjustmentModal();
  initManualTripDetailsModal();

  window.addEventListener('manual-entry-submit', function (ev) {
    var d = ev.detail || {};
    var type = d.type || 'office';
    var startDate = d.startDate || '';
    var endDate = d.endDate || '';
    if (!startDate || !endDate) return;
    if (d.id) {
      var idx = manualEntriesArray.findIndex(function (e) { return e.id === d.id; });
      if (idx !== -1) {
        manualEntriesArray[idx] = { id: d.id, type: type, startDate: startDate, endDate: endDate };
      }
    } else {
      manualEntriesArray.push({ id: crypto.randomUUID(), type: type, startDate: startDate, endDate: endDate });
    }
    renderManualEntriesList();
  });
  window.addEventListener('manual-entry-delete', function (ev) {
    var id = (ev.detail || {}).entryId;
    if (!id) return;
    manualEntriesArray = manualEntriesArray.filter(function (e) { return e.id !== id; });
    renderManualEntriesList();
  });

  if (!document.body.dataset.logbookCloseBound) {
    document.body.dataset.logbookCloseBound = '1';
    document.body.addEventListener('click', function logbookModalClose(e) {
      var closeEl = e.target && e.target.closest && e.target.closest('.vehicle-modal-close');
      if (!closeEl) return;
      var modal = closeEl.closest('#leaveModal, #manualAdjustmentModal, #manualTripDetailsModal');
      if (modal) modal.classList.add('hidden');
    }, true);
  }

  const form = document.getElementById('logbookForm');
  const statusEl = document.getElementById('logbookStatus');
  const btn = document.getElementById('generateLogbookBtn');

  if (!form || !btn) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    var fileInput = document.getElementById('logbookExcelInput');
    var file = ctDroppedExcelFile || (fileInput && fileInput.files && fileInput.files[0]) || null;
    if (!file) {
      if (statusEl) { statusEl.textContent = 'Please select an Excel route list file.'; statusEl.style.color = 'red'; }
      return;
    }

    btn.disabled = true;
    if (statusEl) { statusEl.textContent = 'Loading…'; statusEl.style.color = '#666'; }

    const make = document.getElementById('vehicleMake').value.trim();
    const model = document.getElementById('vehicleModel').value.trim();
    const registration = document.getElementById('registrationNumber').value.trim();
    const taxpayer = {
      firstName: document.getElementById('firstName').value.trim(),
      surname: document.getElementById('surname').value.trim(),
      idNumber: document.getElementById('idNumber').value.trim() || undefined
    };
    const taxYearSel = document.getElementById('taxYear');
    const taxYear = taxYearSel ? taxYearSel.value : '';

    try {
      const arrayBuffer = await readFileAsArrayBuffer(file);
      const routes = parseRouteListExcel(arrayBuffer);

      const startDate = document.getElementById('startDate').value;
      const endDate = document.getElementById('endDate').value;
      const homeAddress = document.getElementById('homeAddress').value.trim();
      const openingKm = parseFloat(document.getElementById('openingKm').value, 10);
      const closingKmEl = document.getElementById('closingKm');
      const closingKm = closingKmEl && closingKmEl.value !== '' ? parseFloat(closingKmEl.value, 10) : undefined;
      const currentWeek = parseInt(document.getElementById('currentWeek').value, 10);
      const workSaturdays = document.getElementById('workSaturdays').checked;
      const employerName = document.getElementById('employerName').value.trim() || null;
      const leaveDays = leaveDaysArray || [];

      const engineInput = {
        routes,
        startDate,
        endDate,
        homeAddress,
        openingKm,
        currentWeek,
        leaveDays,
        workSaturdays,
        routingService: mockRoutingService,
        employerName: employerName || null
      };
      if (closingKm != null && !isNaN(closingKm)) engineInput.closingKm = closingKm;
      // manualEntries: engine expects { date, openingKm, closingKm, ... } per day; UI uses ranges – omitted in local mode

      const engineResult = await runLogbookEngine(engineInput);

      const exportPayload = {
        entries: engineResult.entries,
        meta: {
          ...engineResult.meta,
          taxpayer,
          employerName: employerName || null,
          periodStart: startDate,
          periodEnd: endDate,
          vehicle: { make, model, registration }
        },
        period: { startDate, endDate },
        odometer: {
          openingKm,
          closingKm: engineResult.meta && engineResult.meta.closingKm != null ? engineResult.meta.closingKm : (closingKm != null ? closingKm : null),
          totalPrivateKm: engineResult.totals && engineResult.totals.totalPrivateKm,
          totalKm: engineResult.totals && engineResult.totals.totalKm
        },
        taxYear: taxYear || (startDate && startDate.slice(0, 4) + '/' + endDate.slice(0, 4))
      };

      const xlsxBytes = exportXlsx(exportPayload);
      const blob = new Blob([xlsxBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cleartrack-logbook.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
      if (statusEl) { statusEl.textContent = 'Logbook generated successfully. Please review the file before submission.'; statusEl.style.color = 'green'; }
    } catch (err) {
      if (statusEl) { statusEl.textContent = err && err.message !== undefined && err.message !== null ? String(err.message) : 'Something went wrong.'; statusEl.style.color = 'red'; }
    } finally {
      btn.disabled = false;
    }
  });
}

// Standalone entry: bootstrap injects UI then calls init()
export function init() {
  initLogbookHandlers();
}

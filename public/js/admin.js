/**
 * Admin Dashboard: backend-driven review moderation + performance + pricing.
 */

const db = window.db;
console.log("🔥 ADMIN USING SHARED DB INSTANCE");
let dashboardCache = null;
const STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected"
};
let currentTab = STATUS.PENDING;
let reviewsChartInstance = null;
let revenueChartInstance = null;
let payfastPaymentsRows = [];

function normalizeStatus(status) {
  return (status || "")
    .toString()
    .toLowerCase()
    .trim();
}

function getReviewsByStatus(data, targetStatus) {
  return (data.reviews || []).filter(r =>
    normalizeStatus(r.status) === targetStatus
  );
}

function getPendingReviews(data) {
  // Source of truth: reviews_pending collection (API). Docs often omit `status` field.
  if (data.reviews_pending && Array.isArray(data.reviews_pending)) {
    return data.reviews_pending.map((r) => ({
      ...r,
      status: r.status || STATUS.PENDING
    }));
  }
  return getReviewsByStatus(data, STATUS.PENDING);
}

function getApprovedReviews(data) {
  if (data.reviews_approved && Array.isArray(data.reviews_approved)) {
    return data.reviews_approved.map((r) => ({
      ...r,
      status: r.status || STATUS.APPROVED
    }));
  }
  return getReviewsByStatus(data, STATUS.APPROVED);
}

function getRejectedReviews(data) {
  if (data.reviews_rejected && Array.isArray(data.reviews_rejected)) {
    return data.reviews_rejected.map((r) => ({
      ...r,
      status: r.status || STATUS.REJECTED
    }));
  }
  return getReviewsByStatus(data, STATUS.REJECTED);
}

/** Pending advertise submissions (tools_pending), for admin ads tab helpers. */
function getPendingTools(data) {
  if (!data || !data.tools_pending) return [];
  return data.tools_pending.map((t) => ({
    ...t,
    status: t.status || STATUS.PENDING
  }));
}

if (typeof window !== "undefined") {
  window.getPendingTools = getPendingTools;
}

document.getElementById('reviewsFilter')?.addEventListener('change', applyReviewsFilter);

function getAdminToken() {
  if (typeof firebase === 'undefined' || !firebase.auth) {
    return Promise.reject(new Error('Auth not available'));
  }
  const user = firebase.auth().currentUser;
  if (!user) return Promise.reject(new Error('Not logged in'));
  return user.getIdToken();
}

if (typeof window !== 'undefined') {
  window.getAdminToken = getAdminToken;
  window.adminGet = adminGet;
  window.adminPost = adminPost;
}

function adminGet(params) {
  const qs = params ? ('?' + new URLSearchParams(params).toString()) : '';
  return getAdminToken()
    .then((token) => fetch('/api/admin-dashboard' + qs, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }))
    .then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Request failed');
        }
        return data;
      });
    });
}

function adminPost(payload) {
  return getAdminToken()
    .then((token) => fetch('/api/admin-dashboard', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload || {})
    }))
    .then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Request failed');
        }
        return data;
      });
    });
}

function escapePractitionerField(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadPractitionerApplications() {
  const listEl = document.getElementById("practitionerApplicationsList");
  if (!listEl) return;
  try {
    const token = await getAdminToken();
    const res = await fetch("/api/getPractitionerApplications", {
      headers: {
        Authorization: "Bearer " + token,
      },
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_e) {
      data = {};
    }
    if (!res.ok) {
      listEl.innerHTML =
        '<p class="admin-empty">' +
        escapePractitionerField(data.error || "Failed to load applications") +
        "</p>";
      return;
    }
    renderPractitionerApplications(data.applications || []);
  } catch (err) {
    listEl.innerHTML =
      '<p class="admin-empty">' +
      escapePractitionerField(err && err.message ? err.message : "Failed to load applications") +
      "</p>";
  }
}

function renderPractitionerApplications(applications) {
  const container = document.getElementById("practitionerApplicationsList");
  if (!container) return;
  container.innerHTML = "";

  if (!applications.length) {
    container.innerHTML = '<p class="admin-empty">No pending practitioner applications.</p>';
    return;
  }

  applications.forEach(function (app) {
    const el = document.createElement("div");
    el.className = "admin-card application-card";

    const name = escapePractitionerField(app.name);
    const email = escapePractitionerField(app.email);
    const business = escapePractitionerField(app.business || "");
    const vol = escapePractitionerField(app.estimatedVolume);

    el.innerHTML =
      "<div><strong>" +
      name +
      "</strong></div>" +
      "<div>" +
      email +
      "</div>" +
      "<div>" +
      business +
      "</div>" +
      "<div>Volume: " +
      vol +
      "</div>" +
      '<select class="tier-select form-input" style="max-width:200px; margin-top:10px;">' +
      '<option value="">Select tier</option>' +
      '<option value="50">50</option>' +
      '<option value="200">200</option>' +
      '<option value="1000">1000</option>' +
      "</select>" +
      '<input class="price-input form-input" type="number" placeholder="Price (e.g. 499)" style="max-width:200px; margin-top:8px; display:block;" />' +
      '<button type="button" class="approve-btn btn-approve" style="margin-top:10px;">Approve</button>' +
      '<button type="button" class="btn-secondary resend-access-btn" style="margin-top:8px;display:block;" data-resend-access-email="' +
      encodeURIComponent(String(app.email || "").trim()) +
      '">Resend Access Link</button>';

    const approveBtn = el.querySelector(".approve-btn");
    approveBtn.onclick = async function () {
      const tier = el.querySelector(".tier-select").value;
      const price = el.querySelector(".price-input").value;

      if (!tier || !price) {
        alert("Select tier and price");
        return;
      }

      await approveApplication(app.id, tier, price);
    };

    container.appendChild(el);
  });
}

async function loadPractitionerCodes() {
  const listEl = document.getElementById("practitionerCodesList");
  if (!listEl) return;
  try {
    const token = await getAdminToken();
    const res = await fetch("/api/getPractitionerCodes", {
      headers: {
        Authorization: "Bearer " + token,
      },
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_e) {
      data = {};
    }
    if (!res.ok) {
      listEl.innerHTML =
        '<div class="admin-empty">' +
        escapePractitionerField(data.error || "Failed to load practitioner codes") +
        "</div>";
      return;
    }
    renderPractitionerCodes(data.codes || []);
  } catch (err) {
    listEl.innerHTML =
      '<div class="admin-empty">' +
      escapePractitionerField(err && err.message ? err.message : "Failed to load practitioner codes") +
      "</div>";
  }
}

function renderPractitionerCodes(codes) {
  const container = document.getElementById("practitionerCodesList");
  if (!container) return;

  if (!codes.length) {
    container.innerHTML = '<div class="admin-empty">No practitioner codes</div>';
    return;
  }

  const thStyle =
    "padding:10px 12px;border:1px solid #e5e7eb;text-align:left;vertical-align:middle;background:#f8fafc;font-weight:600;color:#334155;font-size:14px;";
  const tdStyle =
    "padding:10px 12px;border:1px solid #e5e7eb;text-align:left;vertical-align:middle;font-size:14px;";

  let html =
    '<table class="admin-table" style="width:100%;border-collapse:collapse;font-size:14px;">' +
    "<thead><tr>" +
    '<th style="' +
    thStyle +
    '">Code</th>' +
    '<th style="' +
    thStyle +
    '">Email</th>' +
    '<th style="' +
    thStyle +
    '">Price</th>' +
    '<th style="' +
    thStyle +
    '">Usage</th>' +
    '<th style="' +
    thStyle +
    '">Status</th>' +
    '<th style="' +
    thStyle +
    '">Actions</th>' +
    "</tr></thead><tbody>";

  codes.forEach(function (code) {
    const id = code.id;
    const codeCell = escapePractitionerField(code.code || id);
    const emailCell = escapePractitionerField(code.email || "");
    const priceRaw = code.price;
    const priceCell =
      priceRaw != null && priceRaw !== "" && Number.isFinite(Number(priceRaw))
        ? String(priceRaw)
        : "-";
    const usageCount = Number(code.usageCount) || 0;
    const limitRaw = code.usageLimit;
    const usageLimitStr =
      limitRaw != null && limitRaw !== "" && Number.isFinite(Number(limitRaw))
        ? String(limitRaw)
        : "-";
    const active = code.active !== false;
    const statusLabel = active ? "Active" : "Inactive";
    const btnLabel = active ? "Deactivate" : "Activate";

    html +=
      "<tr>" +
      '<td style="' +
      tdStyle +
      '">' +
      codeCell +
      "</td>" +
      '<td style="' +
      tdStyle +
      '">' +
      emailCell +
      "</td>" +
      '<td style="' +
      tdStyle +
      '">R' +
      escapePractitionerField(priceCell) +
      "</td>" +
      '<td style="' +
      tdStyle +
      '">' +
      usageCount +
      " / " +
      escapePractitionerField(usageLimitStr) +
      "</td>" +
      '<td style="' +
      tdStyle +
      '">' +
      statusLabel +
      "</td>" +
      '<td style="' +
      tdStyle +
      '">' +
      "<button type=\"button\" class=\"toggleCouponBtn btn-approve\" onclick='togglePractitionerCode(" +
      JSON.stringify(id) +
      ", " +
      JSON.stringify(active) +
      ")'>" +
      btnLabel +
      "</button>" +
      (String(code.email || "").trim()
        ? "<button type=\"button\" class=\"btn-secondary resend-access-btn\" style=\"margin-left:8px;\" data-resend-access-email=\"" +
          encodeURIComponent(String(code.email || "").trim()) +
          "\">Resend Access Link</button>"
        : "") +
      "</td>" +
      "</tr>";
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

async function togglePractitionerCode(id, isActive) {
  try {
    const token = await getAdminToken();
    const res = await fetch("/api/togglePractitionerCode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        id: id,
        active: !isActive,
      }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      alert(data.error || "Update failed");
      return;
    }
    loadPractitionerCodes();
  } catch (e) {
    alert(e && e.message ? e.message : "Update failed");
  }
}

if (typeof window !== "undefined") {
  window.togglePractitionerCode = togglePractitionerCode;
}

async function approveApplication(applicationId, tier, price) {
  const token = await getAdminToken();

  const res = await fetch("/api/approvePractitionerApplication", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      applicationId: applicationId,
      tier: tier,
      price: Number(price),
    }),
  });

  const data = await res.json().catch(function () {
    return {};
  });

  if (!res.ok) {
    alert(data.error || "Approval failed");
    return;
  }

  alert("Approved! Code: " + (data.code || ""));

  loadPractitionerApplications();
}

function starsHtml(rating) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= rating ? '★' : '☆';
  return s;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getStatus(review) {
  return normalizeStatus(review.status);
}

function statusLabel(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(timestamp) {
  if (!timestamp) return '—';

  try {
    if (timestamp.seconds) {
      return new Date(timestamp.seconds * 1000).toLocaleDateString();
    }

    const date = new Date(timestamp);
    if (isNaN(date)) return '—';

    return date.toLocaleDateString();
  } catch (_err) {
    return '—';
  }
}

function renderCard(r, sourceCollection) {
  const by = [];
  if (r.name) by.push(r.name);
  if (r.company) by.push(r.company);
  const byline = by.length ? escapeHtml(by.join(', ')) : '—';
  const formattedDate = formatDate(r.date || r.createdAt);
  const id = escapeHtml(String(r.id));
  const status = getStatus(r);
  const statusClass = escapeHtml(status);
  const statusLabelText = escapeHtml(statusLabel(status));
  const message = r.comment || r.message || '';
  let actions = '';
  if (status === STATUS.PENDING) {
    actions =
      '<button type="button" class="btn-approve" data-action="approve">Approve</button>' +
      '<button type="button" class="btn-reject" data-action="reject">Reject</button>' +
      '<button type="button" class="btn-delete" data-action="delete">Delete</button>';
  } else if (status === STATUS.APPROVED) {
    actions =
      '<button type="button" class="btn-reject" data-action="reject">Reject</button>' +
      '<button type="button" class="btn-delete" data-action="delete">Delete</button>';
  } else {
    actions =
      '<button type="button" class="btn-approve" data-action="approve">Approve</button>' +
      '<button type="button" class="btn-delete" data-action="delete">Delete</button>';
  }
  return (
    '<div class="admin-card" data-id="' +
    id +
    '">' +
    '<label style="display:block; margin-bottom:8px;">' +
    '<input type="checkbox" class="review-checkbox" value="' + id + '" data-source="' + escapeHtml(sourceCollection || '') + '" /> Select' +
    '</label>' +
    '<div class="review-stars">' +
    starsHtml(r.rating) +
    '</div>' +
    '<p class="review-comment">' +
    escapeHtml(message) +
    '</p>' +
    '<p class="review-meta">' +
    byline +
    '</p>' +
    (formattedDate ? '<p class="review-meta">Submitted: ' + formattedDate + '</p>' : '') +
    '<div class="review-status ' +
    statusClass +
    '">Status: ' +
    statusLabelText +
    '</div>' +
    '<div class="admin-actions">' +
    actions +
    '</div></div>'
  );
}

function renderList(containerId, reviews, emptyMessage, sourceCollection) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const msg = emptyMessage || 'No reviews.';
  if (!reviews || reviews.length === 0) {
    el.innerHTML = '<p class="admin-empty">' + escapeHtml(msg) + '</p>';
    return;
  }
  el.innerHTML = reviews.map((r) => renderCard(r, sourceCollection)).join('');
  el.querySelectorAll('.admin-card').forEach((card) => {
    const id = card.getAttribute('data-id');
    const approveBtn = card.querySelector('[data-action="approve"]');
    const rejectBtn = card.querySelector('[data-action="reject"]');
    const deleteBtn = card.querySelector('[data-action="delete"]');
    if (approveBtn) approveBtn.addEventListener('click', () => { approveReview(id); });
    if (rejectBtn) rejectBtn.addEventListener('click', () => { rejectReview(id, sourceCollection); });
    if (deleteBtn) deleteBtn.addEventListener('click', () => { deleteReview(id, sourceCollection); });
  });
}

function approveReview(reviewId) {
  adminPost({ action: 'approveReview', reviewId })
    .then(() => render())
    .catch((err) => console.error(err));
}

function rejectReview(reviewId, sourceCollection) {
  if (sourceCollection === 'reviews_pending') {
    adminPost({ action: 'rejectReview', reviewId })
      .then(() => render())
      .catch((err) => console.error(err));
    return;
  }
  adminPost({ action: 'deleteReview', reviewId, sourceCollection })
    .then(() => render())
    .catch((err) => console.error(err));
}

function deleteReview(reviewId, sourceCollection) {
  adminPost({ action: 'deleteReview', reviewId, sourceCollection })
    .then(() => render())
    .catch((err) => console.error(err));
}

function renderCounts(stats) {
  const pendingEl = document.getElementById('pendingCount');
  const approvedEl = document.getElementById('approvedCount');
  const rejectedEl = document.getElementById('rejectedCount');
  if (pendingEl) pendingEl.textContent = stats.pending != null ? stats.pending : 0;
  if (approvedEl) approvedEl.textContent = stats.approved != null ? stats.approved : 0;
  if (rejectedEl) rejectedEl.textContent = stats.rejected != null ? stats.rejected : 0;
}

function setStatsLoading(loading) {
  document.querySelectorAll('.stat-card').forEach((card) => {
    card.classList.toggle('loading', loading);
  });
}

function renderCharts(data) {
  const reviewLabels = Object.keys(data.reviewsByDay || {});
  const reviewValues = Object.values(data.reviewsByDay || {});

  const revenueLabels = Object.keys(data.revenueByDay || {});
  const revenueValues = Object.values(data.revenueByDay || {});

  if (reviewsChartInstance) reviewsChartInstance.destroy();
  if (revenueChartInstance) revenueChartInstance.destroy();

  const reviewsCanvas = document.getElementById("reviewsChart");
  const revenueCanvas = document.getElementById("revenueChart");
  if (!reviewsCanvas || !revenueCanvas || typeof Chart === 'undefined') return;

  reviewsChartInstance = new Chart(reviewsCanvas, {
    type: "line",
    data: {
      labels: reviewLabels,
      datasets: [{
        label: "Reviews",
        data: reviewValues,
        borderColor: "#0f6c74",
        fill: false
      }]
    }
  });

  revenueChartInstance = new Chart(revenueCanvas, {
    type: "line",
    data: {
      labels: revenueLabels,
      datasets: [{
        label: "Revenue",
        data: revenueValues,
        borderColor: "#2e7d32",
        fill: false
      }]
    }
  });
}

function renderInsights(data) {
  const activeList = document.getElementById("mostActiveList");
  const ratedList = document.getElementById("topRatedList");
  const alertsList = document.getElementById("alertsList");

  if (!activeList || !ratedList || !alertsList) return;

  activeList.innerHTML = (data.mostActive || [])
    .map(item => `<li>${escapeHtml(String(item.name || 'Unknown'))} (${Number(item.count || 0)})</li>`)
    .join("");

  ratedList.innerHTML = (data.topRated || [])
    .map(item => `<li>${escapeHtml(String(item.name || 'Unknown'))} ⭐ ${Number(item.avgRating || 0).toFixed(1)}</li>`)
    .join("");

  alertsList.innerHTML = (data.alerts || [])
    .map(alert => `<li>${escapeHtml(String(alert || ''))}</li>`)
    .join("");
}

function debugStatus(data) {
  console.log("STATUS AUDIT RAW REVIEWS:", data.reviews);
  console.log("STATUS AUDIT PENDING:", getPendingReviews(data));
  console.log("STATUS AUDIT APPROVED:", getApprovedReviews(data));
  console.log("STATUS AUDIT REJECTED:", getRejectedReviews(data));
}

function loadStats(data) {
  setStatsLoading(true);
  const approvedEl = document.getElementById('statApproved');
  const pendingEl = document.getElementById('statPending');
  const rejectedEl = document.getElementById('statRejected');
  const revenueEl = document.getElementById('statRevenue');
  const pending = getPendingReviews(data);
  const approved = getApprovedReviews(data);
  const rejected = getRejectedReviews(data);

  debugStatus(data);

  if (approvedEl) approvedEl.textContent = String(approved.length);
  if (pendingEl) pendingEl.textContent = String(pending.length);
  if (rejectedEl) rejectedEl.textContent = String(rejected.length);
  if (revenueEl) revenueEl.textContent = 'R' + Number(data.revenue || 0).toLocaleString();

  renderCharts(data);
  renderInsights(data);
  setStatsLoading(false);
}

function setVisibleReviewTab() {
  const pendingHeading = document.getElementById('pendingHeading');
  const approvedHeading = document.getElementById('approvedHeading');
  const rejectedHeading = document.getElementById('rejectedHeading');
  const pendingList = document.getElementById('pendingReviews');
  const approvedList = document.getElementById('approvedReviews');
  const rejectedList = document.getElementById('rejectedReviews');

  const showPending = currentTab === STATUS.PENDING;
  const showApproved = currentTab === STATUS.APPROVED;
  const showRejected = currentTab === STATUS.REJECTED;

  if (pendingHeading) pendingHeading.classList.toggle('hidden', !showPending);
  if (approvedHeading) approvedHeading.classList.toggle('hidden', !showApproved);
  if (rejectedHeading) rejectedHeading.classList.toggle('hidden', !showRejected);
  if (pendingList) pendingList.classList.toggle('hidden', !showPending);
  if (approvedList) approvedList.classList.toggle('hidden', !showApproved);
  if (rejectedList) rejectedList.classList.toggle('hidden', !showRejected);
}

function applyReviewsFilter() {
  var filter = document.getElementById('reviewsFilter');
  if (!filter) return;

  var selected = filter.value;

  var sections = {
    pending: document.getElementById('pendingReviews'),
    approved: document.getElementById('approvedReviews'),
    rejected: document.getElementById('rejectedReviews')
  };

  Object.keys(sections).forEach(function (key) {
    var el = sections[key];
    if (!el) return;

    var sectionEl = el.closest('section');
    if (!sectionEl) return;

    if (key === selected) {
      sectionEl.style.removeProperty('display');
    } else {
      sectionEl.style.display = 'none';
    }
  });
}

function initReviewTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = normalizeStatus(btn.dataset.tab) || STATUS.PENDING;
      setVisibleReviewTab();
      render();
    });
  });

  const reviewsFilter = document.getElementById('reviewsFilter');
  if (reviewsFilter) {
    reviewsFilter.addEventListener('change', () => {
      currentTab = normalizeStatus(reviewsFilter.value) || STATUS.PENDING;
      setVisibleReviewTab();
      render();
    });
  }
}

function getSelectedIds() {
  const map = {
    [STATUS.PENDING]: '#pendingReviews',
    [STATUS.APPROVED]: '#approvedReviews',
    [STATUS.REJECTED]: '#rejectedReviews'
  };
  const root = document.querySelector(map[currentTab] || '#pendingReviews');
  if (!root) return [];
  return Array.from(root.querySelectorAll('.review-checkbox:checked')).map((cb) => cb.value);
}

function getCurrentTabRoot() {
  const map = {
    [STATUS.PENDING]: '#pendingReviews',
    [STATUS.APPROVED]: '#approvedReviews',
    [STATUS.REJECTED]: '#rejectedReviews'
  };
  return document.querySelector(map[currentTab] || '#pendingReviews');
}

function updateSelectionCount() {
  const root = getCurrentTabRoot();
  const count = root ? root.querySelectorAll('.review-checkbox:checked').length : 0;
  const el = document.getElementById('selectionCount');
  if (el) el.textContent = count + ' selected';
}

function syncSelectAllState() {
  const root = getCurrentTabRoot();
  const selectAll = document.getElementById('selectAll');
  if (!root || !selectAll) return;
  const all = root.querySelectorAll('.review-checkbox');
  const checked = root.querySelectorAll('.review-checkbox:checked');
  selectAll.checked = all.length > 0 && checked.length === all.length;
}

function confirmAction(message) {
  return Promise.resolve(window.confirm(message));
}

function initSelectionUx() {
  const selectAll = document.getElementById('selectAll');
  if (!selectAll) return;

  selectAll.addEventListener('change', () => {
    const root = getCurrentTabRoot();
    if (!root) return;
    root.querySelectorAll('.review-checkbox').forEach((cb) => {
      cb.checked = selectAll.checked;
    });
    updateSelectionCount();
    syncSelectAllState();
  });

  document.addEventListener('change', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('review-checkbox')) {
      updateSelectionCount();
      syncSelectAllState();
    }
  });
}

function initBulkActions() {
  const bulkApproveBtn = document.getElementById('bulkApprove');
  const bulkRejectBtn = document.getElementById('bulkReject');
  if (!bulkApproveBtn || !bulkRejectBtn) return;

  bulkApproveBtn.addEventListener('click', async () => {
    const ids = getSelectedIds();
    if (!ids.length) return alert('No items selected');
    if (currentTab === STATUS.APPROVED) return;
    const ok = await confirmAction('Approve selected reviews?');
    if (!ok) return;
    await Promise.all(ids.map((id) => adminPost({ action: 'approveReview', reviewId: id })));
    render();
  });

  bulkRejectBtn.addEventListener('click', async () => {
    const ids = getSelectedIds();
    if (!ids.length) return alert('No items selected');
    const ok = await confirmAction('Reject selected reviews?');
    if (!ok) return;
    if (currentTab === STATUS.PENDING) {
      await Promise.all(ids.map((id) => adminPost({ action: 'rejectReview', reviewId: id })));
    } else if (currentTab === STATUS.APPROVED) {
      await Promise.all(ids.map((id) => adminPost({ action: 'deleteReview', reviewId: id, sourceCollection: 'reviews_approved' })));
    } else {
      await Promise.all(ids.map((id) => adminPost({ action: 'deleteReview', reviewId: id, sourceCollection: 'reviews_rejected' })));
    }
    render();
  });
}

function renderReviews(data) {
  const listEl = document.getElementById('pendingReviews');
  const pendingTitleEl = document.getElementById('pendingHeading');
  const pendingCountEl = document.getElementById('pendingCount');
  if (!listEl) return;

  const pending = getPendingReviews(data);
  if (pendingCountEl) pendingCountEl.textContent = String(pending.length);
  if (pendingTitleEl) pendingTitleEl.textContent = `Pending Reviews (${pending.length})`;

  if (!pending.length) {
    listEl.innerHTML = "No reviews awaiting approval.";
    return;
  }

  listEl.innerHTML = pending.map(r => `
  <div class="review-card" data-id="${escapeHtml(String(r.id || ""))}">
    <div class="review-header">
      <input type="checkbox" class="review-checkbox" data-id="${escapeHtml(String(r.id || ""))}" value="${escapeHtml(String(r.id || ""))}">
    </div>

    <div class="review-content">
      <div>${escapeHtml(r.comment || "")}</div>
      <small>${escapeHtml(r.company || "")}</small>
      <small>Status: ${escapeHtml(r.status || "")}</small>
    </div>

    <div class="review-actions admin-actions">
      <button data-action="approve" data-id="${escapeHtml(String(r.id || ""))}">Approve</button>
      <button data-action="reject" data-id="${escapeHtml(String(r.id || ""))}">Reject</button>
      <button data-action="delete" data-id="${escapeHtml(String(r.id || ""))}">Delete</button>
    </div>
  </div>
`).join("");

  listEl.querySelectorAll('[data-action="approve"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      approveReview(id);
    });
  });
  listEl.querySelectorAll('[data-action="reject"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      rejectReview(id, 'reviews_pending');
    });
  });
  listEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      deleteReview(id, 'reviews_pending');
    });
  });
}

function render() {
  adminGet({ status: currentTab })
    .then((data) => {
      dashboardCache = data || {};
      // Pending = reviews_pending collection; approved/rejected = their collections (not public `reviews`).
      const normalizedData = {
        ...data,
        reviews: [
          ...(data.reviews_pending || []).map((r) => ({ ...r, status: r.status || STATUS.PENDING })),
          ...(data.reviews_approved || []).map((r) => ({ ...r, status: r.status || STATUS.APPROVED })),
          ...(data.reviews_rejected || []).map((r) => ({ ...r, status: r.status || STATUS.REJECTED }))
        ]
      };
      loadStats(normalizedData);
      const pending = getPendingReviews(normalizedData);
      const approved = getApprovedReviews(normalizedData);
      const rejected = getRejectedReviews(normalizedData);
      renderCounts({ pending: pending.length, approved: approved.length, rejected: rejected.length });
      renderReviews(normalizedData);
      renderList('approvedReviews', approved, 'No reviews.', 'reviews_approved');
      renderList('rejectedReviews', rejected, 'No reviews.', 'reviews_rejected');
      setVisibleReviewTab();
      updateSelectionCount();
      syncSelectAllState();
      renderPerformance();
      applyReviewsFilter();
    })
    .catch((err) => {
      const normalizedData = { reviews: [], reviews_approved: [], reviews_rejected: [], revenue: 0, reviewsByDay: {}, revenueByDay: {}, mostActive: [], topRated: [], alerts: [] };
      loadStats(normalizedData);
      renderCounts({ pending: 0, approved: 0, rejected: 0 });
      renderReviews(normalizedData);
      renderList('approvedReviews', [], 'No reviews.', 'reviews_approved');
      renderList('rejectedReviews', [], 'No reviews.', 'reviews_rejected');
      setVisibleReviewTab();
      updateSelectionCount();
      syncSelectAllState();
      renderPerformance();
      applyReviewsFilter();
      if (console && console.error) console.error(err);
    });
}

function renderPerformance() {
  const container = document.getElementById('performanceContent');
  if (!container) return;
  const toolsSrc = (dashboardCache && dashboardCache.sponsoredTools) || [];
  const tools = toolsSrc
    .filter((t) => normalizeStatus(t.status) === 'live')
    .map((data) => ({
      toolName: (data.toolName && data.toolName.trim()) || 'Unnamed Tool',
      views: data.views != null ? data.views : 0,
      clicks: data.clicks != null ? data.clicks : 0
    }));
  if (!tools.length) {
    container.innerHTML = '<p class="admin-empty">No live ads yet.</p>';
    return;
  }
  tools.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
  container.innerHTML = tools.map((t) =>
    '<div class="dashboard-card">' +
    '<h3>' + escapeHtml(t.toolName) + '</h3>' +
    '<div class="metric">Views <strong>' + t.views + '</strong></div>' +
    '<div class="metric">Clicks <strong>' + t.clicks + '</strong></div>' +
    '<div class="metric">CTR <strong>' + (t.views > 0 ? ((t.clicks / t.views) * 100).toFixed(1) : 0) + '%</strong></div></div>'
  ).join('');
}

async function approveRoute(submissionId, routeIndex) {
  const status = "approved";
  console.log("SENDING STATUS:", status);
  const res = await fetch("/api/updateRouteStatus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      submissionId,
      routeIndex,
      status
    })
  });
  const data = await res.json();
  if (!res.ok || (data.success !== undefined && !data.success)) {
    console.error("updateRouteStatus failed:", res.status, data);
    return;
  }

  const res2 = await fetch("/api/approveLogbookSubmission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId })
  });
  const data2 = await res2.json();
  if (!res2.ok || (data2.success !== undefined && !data2.success)) {
    console.error("approveLogbookSubmission failed:", res2.status, data2);
    return;
  }

  console.log("Route approved:", submissionId, routeIndex);
  await loadLogbookSubmissions();
}

async function rejectRoute(submissionId, routeIndex) {
  const status = "rejected";
  console.log("SENDING STATUS:", status);
  const res = await fetch("/api/updateRouteStatus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      submissionId,
      routeIndex,
      status
    })
  });
  const data = await res.json();
  if (!res.ok || (data.success !== undefined && !data.success)) {
    console.error("updateRouteStatus failed:", res.status, data);
    return;
  }

  const res2 = await fetch("/api/approveLogbookSubmission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId })
  });
  const data2 = await res2.json();
  if (!res2.ok || (data2.success !== undefined && !data2.success)) {
    console.error("approveLogbookSubmission failed:", res2.status, data2);
    return;
  }

  console.log("Route rejected:", submissionId, routeIndex);
  await loadLogbookSubmissions();
}

function renderLogbookSubmissionCardHtml(sub, pendingRoutes) {
  const id = sub.id;
  const routes = Array.isArray(sub.routes) ? sub.routes : [];

  return pendingRoutes
    .map(function (route) {
      const idx = routes.indexOf(route);
      if (idx < 0) return '';

      const customer =
        route && route.customer != null ? String(route.customer).trim() : '';
      const title = customer || 'Store';

      const orig =
        route && route.original && typeof route.original === 'object'
          ? route.original
          : null;
      var originalAddr = '';
      if (
        route &&
        route.originalAddress != null &&
        String(route.originalAddress).trim() !== ''
      ) {
        originalAddr = String(route.originalAddress);
      } else if (orig && orig.address != null) {
        originalAddr = String(orig.address);
      }
      var currentAddr = '';
      if (
        route &&
        route.currentAddress != null &&
        String(route.currentAddress).trim() !== ''
      ) {
        currentAddr = String(route.currentAddress);
      } else if (route && route.address != null) {
        currentAddr = String(route.address);
      }

      const oldAddrDisplay = originalAddr.trim() || '—';
      const newAddrDisplay = currentAddr.trim() || '—';

      var actionRow = '';
      if (!route.status || route.status === 'pending') {
        actionRow =
          '<div class="admin-actions">' +
          '<button type="button" class="btn-approve approve-route" data-id="' +
          escapeHtml(id) +
          '" data-index="' +
          idx +
          '">Approve</button>' +
          '<button type="button" class="btn-reject reject-route" data-id="' +
          escapeHtml(id) +
          '" data-index="' +
          idx +
          '">Reject</button>' +
          '</div>';
      }

      return (
        '<div class="admin-card admin-logbook-queue-card" data-submission-id="' +
        escapeHtml(id) +
        '">' +
        '<h3 class="admin-logbook-queue-title">' +
        escapeHtml(title) +
        '</h3>' +
        '<div class="admin-logbook-queue-rows">' +
        '<div class="admin-logbook-queue-field">' +
        '<span class="admin-logbook-queue-label">Old Address</span>' +
        '<p class="admin-logbook-queue-value">' +
        escapeHtml(oldAddrDisplay) +
        '</p>' +
        '</div>' +
        '<div class="admin-logbook-queue-field">' +
        '<span class="admin-logbook-queue-label">New Address</span>' +
        '<p class="admin-logbook-queue-value">' +
        escapeHtml(newAddrDisplay) +
        '</p>' +
        '</div>' +
        '</div>' +
        actionRow +
        '</div>'
      );
    })
    .join('');
}

async function loadLogbookSubmissions() {
  const container = document.getElementById('submissions');
  if (!container) return;
  let submissions;
  try {
    const data = await adminGet({ action: 'logbookSubmissions' });
    submissions = Array.isArray(data.submissions) ? data.submissions : [];
  } catch (err) {
    console.error('loadLogbookSubmissions failed:', err);
    container.innerHTML = '<p style="padding:20px;">Failed to load submissions.</p>';
    return;
  }
  console.log('Loaded submissions:', submissions);

  const visibleSubmissions = submissions.filter((sub) => {
    const pendingRoutes = (sub.routes || []).filter(
      (r) => r && (!r.status || r.status === 'pending')
    );
    return pendingRoutes.length > 0;
  });

  if (visibleSubmissions.length === 0) {
    container.innerHTML = '<p style="padding:20px;">No pending submissions</p>';
    return;
  }

  container.innerHTML = visibleSubmissions
    .map((sub) => {
      const pendingRoutes = (sub.routes || []).filter(
        (r) => r && (!r.status || r.status === 'pending')
      );
      return renderLogbookSubmissionCardHtml(sub, pendingRoutes);
    })
    .join('');

  container.querySelectorAll('.approve-route').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const index = Number(btn.dataset.index);
      await approveRoute(id, index);
    });
  });
  container.querySelectorAll('.reject-route').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const index = Number(btn.dataset.index);
      await rejectRoute(id, index);
    });
  });
}

async function invokeResendAccessLink(email) {
  if (typeof firebase === "undefined" || typeof firebase.app !== "function") {
    throw new Error("Cloud Functions not available.");
  }
  const fns = firebase.app().functions("us-central1");
  const fn = fns.httpsCallable("resendAccessLink");
  const res = await fn({ email });
  if (!res.data || !res.data.success) {
    throw new Error("Unexpected response from server.");
  }
}

let resendAccessDelegatedBound = false;

function initResendAccessLinkDelegated() {
  if (resendAccessDelegatedBound) return;
  resendAccessDelegatedBound = true;
  document.addEventListener("click", async function (ev) {
    const btn = ev.target.closest(".resend-access-btn");
    if (!btn || !btn.getAttribute("data-resend-access-email")) return;
    let email;
    try {
      email = decodeURIComponent(btn.getAttribute("data-resend-access-email") || "");
    } catch (_e) {
      return;
    }
    if (!email || !email.includes("@")) return;
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await invokeResendAccessLink(email);
      alert("Access link sent successfully");
    } catch (err) {
      console.error("resendAccessLink:", err);
      const msg =
        err && err.code === "functions/permission-denied"
          ? "Admin only."
          : err && err.message
            ? String(err.message)
            : "Failed to send.";
      alert(msg);
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  });
}

function initManualAccessLink() {
  const btn = document.getElementById("btnGenerateAccessLink");
  const resendBtn = document.getElementById("btnResendAccessLink");
  const copyBtn = document.getElementById("btnCopyManualAccessLink");
  const emailInput = document.getElementById("manualAccessEmail");
  const out = document.getElementById("manualAccessLinkOutput");
  const status = document.getElementById("manualAccessLinkStatus");
  if (!btn || !emailInput || !out) return;

  function getUsCentralFunctions() {
    if (typeof firebase === "undefined" || typeof firebase.app !== "function") return null;
    try {
      return firebase.app().functions("us-central1");
    } catch (_e) {
      return null;
    }
  }

  if (resendBtn) {
    resendBtn.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      if (!email) {
        if (status) status.textContent = "Enter an email.";
        return;
      }
      const fns = getUsCentralFunctions();
      if (!fns) {
        if (status) status.textContent = "Cloud Functions not available.";
        return;
      }
      resendBtn.disabled = true;
      if (status) status.textContent = "Sending…";
      try {
        await invokeResendAccessLink(email);
        if (status) status.textContent = "Access link sent successfully";
      } catch (err) {
        console.error("resendAccessLink:", err);
        const msg =
          err && err.code === "functions/permission-denied"
            ? "Admin only."
            : err && err.message
              ? String(err.message)
              : "Failed to send.";
        if (status) status.textContent = msg;
      } finally {
        resendBtn.disabled = false;
      }
    });
  }

  btn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!email) {
      if (status) status.textContent = "Enter an email.";
      return;
    }
    const fns = getUsCentralFunctions();
    if (!fns) {
      if (status) status.textContent = "Cloud Functions not available.";
      return;
    }
    btn.disabled = true;
    if (status) status.textContent = "Generating…";
    try {
      const fn = fns.httpsCallable("createManualAccessLink");
      const res = await fn({ email });
      const link = res.data && res.data.link;
      if (link) {
        out.value = link;
        if (copyBtn) copyBtn.disabled = false;
        if (status) status.textContent = "";
      } else {
        if (status) status.textContent = "Unexpected response from server.";
      }
    } catch (err) {
      console.error("createManualAccessLink:", err);
      const msg =
        err && err.code === "functions/permission-denied"
          ? "Admin only."
          : err && err.message
            ? String(err.message)
            : "Failed to generate link.";
      if (status) status.textContent = msg;
    } finally {
      btn.disabled = false;
    }
  });

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const link = out.value.trim();
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
        if (status) status.textContent = "Copied to clipboard.";
      } catch (_e) {
        try {
          out.select();
          document.execCommand("copy");
          if (status) status.textContent = "Copied.";
        } catch (_e2) {
          if (status) status.textContent = "Could not copy; select the link and copy manually.";
        }
      }
    });
  }
}

function formatPaymentDate(createdAt) {
  if (createdAt == null) return "—";
  if (typeof createdAt === "object" && typeof createdAt.toDate === "function") {
    try {
      return createdAt.toDate().toLocaleString();
    } catch (_e) {
      return "—";
    }
  }
  const n = Number(createdAt);
  if (Number.isFinite(n)) {
    return new Date(n).toLocaleString();
  }
  return String(createdAt);
}

function renderPayfastPaymentsTable() {
  const wrap = document.getElementById("paymentsTableWrap");
  const statusEl = document.getElementById("paymentsStatus");
  if (!wrap) return;
  const searchEl = document.getElementById("paymentsEmailSearch");
  const q = (searchEl && searchEl.value ? searchEl.value : "").trim().toLowerCase();
  let rows = payfastPaymentsRows;
  if (q) {
    rows = rows.filter(function (r) {
      return String(r.email || "").toLowerCase().indexOf(q) !== -1;
    });
  }
  const thStyle =
    "padding:10px 12px;border:1px solid #e5e7eb;text-align:left;vertical-align:middle;background:#f8fafc;font-weight:600;color:#334155;font-size:14px;";
  const tdStyle =
    "padding:10px 12px;border:1px solid #e5e7eb;text-align:left;vertical-align:middle;font-size:14px;";
  let html =
    '<table class="admin-table" style="width:100%;border-collapse:collapse;font-size:14px;">' +
    "<thead><tr>" +
    '<th style="' +
    thStyle +
    '">Email</th>' +
    '<th style="' +
    thStyle +
    '">Payment ID</th>' +
    '<th style="' +
    thStyle +
    '">Type</th>' +
    '<th style="' +
    thStyle +
    '">Amount</th>' +
    '<th style="' +
    thStyle +
    '">Created</th>' +
    '<th style="' +
    thStyle +
    '">Actions</th>' +
    "</tr></thead><tbody>";
  if (!rows.length) {
    const emptyMsg = payfastPaymentsRows.length
      ? "No rows match this filter."
      : "No payments recorded yet.";
    html +=
      '<tr><td colspan="6" style="' +
      tdStyle +
      '">' +
      escapeHtml(emptyMsg) +
      "</td></tr>";
  } else {
    rows.forEach(function (r) {
      const emailRaw = String(r.email || "").trim();
      const emailEnc = encodeURIComponent(emailRaw);
      const emailCell = escapeHtml(emailRaw || "—");
      const pidCell = escapeHtml(String(r.id || ""));
      const typeCell = escapeHtml(String(r.type || "—"));
      const amountCell = escapeHtml(
        r.amount != null && r.amount !== "" ? String(r.amount) : "—"
      );
      const createdCell = escapeHtml(formatPaymentDate(r.createdAt));
      const resendBtn =
        emailRaw && emailRaw.indexOf("@") !== -1
          ? '<button type="button" class="btn-secondary resend-access-btn" data-resend-access-email="' +
            emailEnc +
            '">Resend Email</button>'
          : "—";
      html +=
        "<tr>" +
        '<td style="' +
        tdStyle +
        '">' +
        emailCell +
        "</td>" +
        '<td style="' +
        tdStyle +
        '">' +
        pidCell +
        "</td>" +
        '<td style="' +
        tdStyle +
        '">' +
        typeCell +
        "</td>" +
        '<td style="' +
        tdStyle +
        '">' +
        amountCell +
        "</td>" +
        '<td style="' +
        tdStyle +
        '">' +
        createdCell +
        "</td>" +
        '<td style="' +
        tdStyle +
        '">' +
        resendBtn +
        "</td>" +
        "</tr>";
    });
  }
  html += "</tbody></table>";
  wrap.innerHTML = html;
  if (statusEl && payfastPaymentsRows.length) {
    statusEl.textContent =
      rows.length === payfastPaymentsRows.length
        ? "Showing " + rows.length + " payment(s)."
        : "Showing " + rows.length + " of " + payfastPaymentsRows.length + " loaded.";
  }
}

async function loadPayfastPayments() {
  const wrap = document.getElementById("paymentsTableWrap");
  const statusEl = document.getElementById("paymentsStatus");
  if (!wrap || !db) {
    if (statusEl) statusEl.textContent = "Database not available.";
    return;
  }
  if (statusEl) statusEl.textContent = "Loading…";
  wrap.innerHTML = "";
  try {
    const snap = await db
      .collection("payfast_payments")
      .orderBy("createdAt", "desc")
      .limit(300)
      .get();
    payfastPaymentsRows = snap.docs.map(function (doc) {
      const d = doc.data() || {};
      return { id: doc.id, email: d.email, type: d.type, amount: d.amount, createdAt: d.createdAt };
    });
    renderPayfastPaymentsTable();
    if (statusEl) {
      statusEl.textContent = payfastPaymentsRows.length
        ? ""
        : "No payments recorded yet.";
    }
  } catch (err) {
    console.error("loadPayfastPayments:", err);
    if (statusEl) {
      statusEl.textContent =
        err && err.message ? String(err.message) : "Failed to load payments.";
    }
  }
}

function initPaymentsPanel() {
  const searchEl = document.getElementById("paymentsEmailSearch");
  if (searchEl) {
    searchEl.addEventListener("input", function () {
      renderPayfastPaymentsTable();
    });
  }
}

function initTabs() {
  const dashboardTab = document.getElementById('dashboardTab');
  const reviewsPanel = document.getElementById('reviewsPanel');
  const adsPanel = document.getElementById('adsPanel');
  const pricingPanel = document.getElementById('pricingPanel');
  const couponsPanel = document.getElementById('couponsTab');
  const adminLogbookPanel = document.getElementById('adminLogbookPanel');
  const logbookSubmissionsPanel = document.getElementById('logbookSubmissionsPanel');
  const uploadPanel = document.getElementById('upload');
  const articlesPanel = document.getElementById('articlesPanel');
  const paymentsPanel = document.getElementById('paymentsPanel');
  const tabs = document.querySelectorAll('.admin-tabs button[data-tab]');
  if (!dashboardTab || !reviewsPanel || !adsPanel || !tabs.length) return;
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      dashboardTab.classList.add('hidden');
      reviewsPanel.classList.add('hidden');
      adsPanel.classList.add('hidden');
      if (pricingPanel) pricingPanel.classList.add('hidden');
      if (couponsPanel) couponsPanel.classList.add('hidden');
      if (adminLogbookPanel) adminLogbookPanel.classList.add('hidden');
      if (logbookSubmissionsPanel) logbookSubmissionsPanel.classList.add('hidden');
      if (uploadPanel) uploadPanel.classList.add('hidden');
      if (articlesPanel) articlesPanel.classList.add('hidden');
      if (paymentsPanel) paymentsPanel.classList.add('hidden');
      if (tab === 'dashboard') {
        dashboardTab.classList.remove('hidden');
      } else if (tab === 'payments') {
        if (paymentsPanel) {
          paymentsPanel.classList.remove('hidden');
        }
      } else if (tab === 'reviews') {
        reviewsPanel.classList.remove('hidden');
      } else if (tab === 'logbook-submissions') {
        if (logbookSubmissionsPanel) logbookSubmissionsPanel.classList.remove('hidden');
        loadLogbookSubmissions();
      } else if (tab === 'ads') {
        adsPanel.classList.remove('hidden');
      } else if (tab === 'pricing') {
        if (pricingPanel) pricingPanel.classList.remove('hidden');
        loadPricing();
      } else if (tab === 'coupons') {
        if (couponsPanel) couponsPanel.classList.remove('hidden');
        loadCoupons();
        loadPractitionerCodes();
      } else if (tab === 'admin-logbook') {
        if (adminLogbookPanel) adminLogbookPanel.classList.remove('hidden');
      } else if (tab === 'upload') {
        if (uploadPanel) uploadPanel.classList.remove('hidden');
      } else if (tab === 'articles') {
        if (articlesPanel) {
          articlesPanel.classList.remove('hidden');
          if (typeof window.loadArticlesAdmin === 'function') {
            window.loadArticlesAdmin();
          }
        }
      }
    });
  });
}

function loadPricing() {
  const featuredInput = document.getElementById('pricingFeatured');
  const slot1Input = document.getElementById('pricingSlot1');
  const slot2Input = document.getElementById('pricingSlot2');
  const slot3Input = document.getElementById('pricingSlot3');
  const logbookPriceInput = document.getElementById('logbookPrice');
  const logbookTokensInput = document.getElementById('logbookTokens');
  const logbookLabelInput = document.getElementById('logbookLabel');
  const statusEl = document.getElementById('pricingStatus');
  if (!featuredInput || !slot1Input || !slot2Input || !slot3Input || !logbookPriceInput || !logbookTokensInput || !logbookLabelInput) return;

  (async function () {
    try {
      const doc = await db.collection("pricing").doc("default").get();

      if (!doc.exists) {
        console.warn("⚠️ No pricing document found");
        if (statusEl) statusEl.textContent = 'No pricing document found.';
        return;
      }

      const data = doc.data();
      console.log("📥 Loaded pricing:", data);

      const ads = data?.ads || {};
      featuredInput.value = ads.featured ?? "";
      slot1Input.value = ads.slot1 ?? "";
      slot2Input.value = ads.slot2 ?? "";
      slot3Input.value = ads.slot3 ?? "";
      logbookPriceInput.value = data?.tools?.logbook?.price ?? "";
      logbookTokensInput.value = data?.tools?.logbook?.tokensIncluded ?? "";
      logbookLabelInput.value = data?.tools?.logbook?.label ?? "";
      if (statusEl) statusEl.textContent = 'Pricing loaded.';
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Load failed.';
      console.error("❌ Load pricing failed:", err);
    }
  })();
}

function initPricingSave() {
  const saveBtn = document.getElementById('pricingSaveBtn');
  const featuredInput = document.getElementById('pricingFeatured');
  const slot1Input = document.getElementById('pricingSlot1');
  const slot2Input = document.getElementById('pricingSlot2');
  const slot3Input = document.getElementById('pricingSlot3');
  const logbookPriceInput = document.getElementById('logbookPrice');
  const logbookTokensInput = document.getElementById('logbookTokens');
  const logbookLabelInput = document.getElementById('logbookLabel');
  const statusEl = document.getElementById('pricingStatus');
  if (!saveBtn || !featuredInput || !slot1Input || !slot2Input || !slot3Input || !logbookPriceInput || !logbookTokensInput || !logbookLabelInput) return;

  async function savePricing() {
    try {
      console.log("🔥 Saving pricing...");
      if (statusEl) statusEl.textContent = 'Saving...';

      const featured = Number(featuredInput.value);
      const slot1 = Number(slot1Input.value);
      const slot2 = Number(slot2Input.value);
      const slot3 = Number(slot3Input.value);
      const logbookPrice = Number(logbookPriceInput.value);
      const tokens = Number(logbookTokensInput.value);
      const label = logbookLabelInput.value.trim();

      if (!Number.isFinite(featured) || featured <= 0) throw new Error("Invalid featured placement price");
      if (!Number.isFinite(slot1) || slot1 <= 0) throw new Error("Invalid slot 1 price");
      if (!Number.isFinite(slot2) || slot2 <= 0) throw new Error("Invalid slot 2 price");
      if (!Number.isFinite(slot3) || slot3 <= 0) throw new Error("Invalid slot 3 price");
      if (!Number.isFinite(logbookPrice) || logbookPrice <= 0) throw new Error("Invalid logbook price");
      if (!Number.isFinite(tokens) || tokens <= 0) throw new Error("Invalid token count");
      if (!label) throw new Error("Label required");

      const payload = {
        ads: {
          featured,
          slot1,
          slot2,
          slot3
        },
        tools: {
          logbook: {
            price: logbookPrice,
            tokensIncluded: tokens,
            label
          }
        },
        updatedAt: new Date().toISOString()
      };

      console.log("📦 Payload:", payload);

      const saveRes = await fetch("/api/update-pricing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      let saveData = {};
      try {
        saveData = await saveRes.json();
      } catch (_e) {
        throw new Error("Save failed");
      }
      if (!saveRes.ok || !saveData.success) {
        throw new Error(saveData.error || "Request failed");
      }

      console.log("✅ Pricing saved successfully");
      if (statusEl) statusEl.textContent = 'Saved successfully.';
      alert("Pricing saved successfully");
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Save failed.';
      console.error("❌ Save failed:", err);
      alert("Save failed: " + err.message);
    }
  }

  saveBtn.addEventListener("click", savePricing);
}

function bindCouponActions() {
  document.querySelectorAll(".toggleCouponBtn").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const ref = db.collection("coupons").doc(id);
      const doc = await ref.get();
      if (!doc.exists) return;
      await ref.update({
        active: !doc.data().active
      });
      loadCoupons();
    };
  });

  document.querySelectorAll(".deleteCouponBtn").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      if (!confirm("Delete this coupon?")) return;
      await db.collection("coupons").doc(id).delete();
      loadCoupons();
    };
  });
}

function renderCoupons(docs) {
  const container = document.getElementById("couponAnalytics");
  if (!container) return;

  let html = `
    <table style="width:100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="text-align:left;">Code</th>
          <th>Company</th>
          <th>Type</th>
          <th>Value</th>
          <th>Used</th>
          <th>Revenue</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  docs.forEach((doc) => {
    const data = doc.data() || {};
    const code = escapeHtml(String(data.code || doc.id || ""));
    const company = escapeHtml(String(data.company || "-"));
    const type = escapeHtml(String(data.type || ""));
    const value = Number(data.value || 0);
    const used = Number(data.usedCount || 0);
    const revenue = Number(data.revenue || 0);
    const status = data.active ? "Active" : "Disabled";
    const id = escapeHtml(String(doc.id));

    html += `
      <tr>
        <td>${code}</td>
        <td>${company}</td>
        <td>${type}</td>
        <td>${value}</td>
        <td>${used}</td>
        <td>R${revenue}</td>
        <td>${status}</td>
        <td>
          <button data-id="${id}" class="toggleCouponBtn">Toggle</button>
          <button data-id="${id}" class="deleteCouponBtn">Delete</button>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;

  bindCouponActions();
}

async function loadCoupons() {
  const container = document.getElementById("couponAnalytics");
  if (!container || !db) return;
  const snapshot = await db.collection("coupons").get();
  renderCoupons(snapshot.docs);
}

function initCouponAdmin() {
  const createBtn = document.getElementById("createCouponBtn");
  if (!createBtn || !db) return;

  createBtn.addEventListener("click", async () => {
    const code = document.getElementById("couponCode").value.trim().toUpperCase();
    const company = document.getElementById("couponCompany").value.trim();
    const value = Number(document.getElementById("couponValue").value);
    const type = document.getElementById("couponType").value;

    if (!code || !value) {
      alert("Enter valid coupon details");
      return;
    }

    const ref = db.collection("coupons").doc(code);
    const existing = await ref.get();
    const prev = existing.exists ? (existing.data() || {}) : {};
    await ref.set({
      code,
      company,
      value,
      type,
      active: typeof prev.active === "boolean" ? prev.active : true,
      createdAt: prev.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
      usedCount: Number.isFinite(Number(prev.usedCount)) ? Number(prev.usedCount) : 0,
      revenue: Number.isFinite(Number(prev.revenue)) ? Number(prev.revenue) : 0
    }, { merge: true });

    loadCoupons();
  });

  loadCoupons();
}

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await firebase.auth().signOut();
  window.location.href = "/admin-login.html";
});

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    alert('Please log in as admin');
    return;
  }

  const idTokenResult = await user.getIdTokenResult();
  if (!idTokenResult.claims.admin) {
    alert('Please log in as admin');
    return;
  }

  if (idTokenResult.claims.admin === true) {
    loadPayfastPayments();
  }

  initTabs();
  initPaymentsPanel();
  initManualAccessLink();
  initResendAccessLinkDelegated();
  initReviewTabs();
  initSelectionUx();
  initBulkActions();
  initPricingSave();
  initCouponAdmin();
  render();
  loadPractitionerApplications();
});

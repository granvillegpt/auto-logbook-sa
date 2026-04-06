/**
 * Admin Ads: pending → approved (locked) → live → expired | rejected
 */
(function () {
  'use strict';

  if (!window.AdBooking) {
    console.error('admin-ads: AdBooking not loaded');
    return;
  }

  const STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    LIVE: 'live',
    EXPIRED: 'expired'
  };

  function normalizeStatus(status) {
    return (status || '').toString().toLowerCase().trim();
  }

  function isStatus(item, target) {
    return normalizeStatus(item && item.status) === target;
  }

  var pendingEl = document.getElementById('pendingAds');
  var waitingPaymentEl = document.getElementById('waitingPaymentAds');
  var liveAdsEl = document.getElementById('liveAds');
  var expiredAdsEl = document.getElementById('expiredAds');
  var rejectedEl = document.getElementById('rejectedAds');

  if (!pendingEl || !waitingPaymentEl || !liveAdsEl || !expiredAdsEl || !rejectedEl) return;

  /** Same target as admin.js — Hosting SPA rewrites break relative /adminDashboardApi in local dev. */
  var ADMIN_API_URL =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://127.0.0.1:5007/autologbook-sa/us-central1/adminDashboardApi'
      : '/adminDashboardApi';

  var IS_DEV =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  function postApproveAd(adId) {
    return new Promise(function (resolve, reject) {
      if (typeof firebase === 'undefined' || !firebase.auth) {
        reject(new Error('Auth not available'));
        return;
      }
      var user = firebase.auth().currentUser;
      if (!user) {
        reject(new Error('Not logged in'));
        return;
      }
      user
        .getIdToken()
        .then(function (token) {
          return fetch(ADMIN_API_URL, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action: 'approveAd', adId: adId })
          });
        })
        .then(function (res) {
          return res.text().then(function (text) {
            console.log('RAW RESPONSE:', text);
            var body;
            try {
              body = JSON.parse(text);
            } catch (_parseErr) {
              throw new Error(
                'Server did not return JSON (got HTML or empty). Check ADMIN_API_URL / Functions emulator.'
              );
            }
            if (!res.ok || (body && body.success === false)) {
              var msg = (body && body.error) ? String(body.error) : res.statusText || 'Request failed';
              throw new Error(msg);
            }
            return body;
          });
        })
        .then(resolve)
        .catch(reject);
    });
  }

  var DEFAULT_AD_IMAGE = '/assets/default-ad.png';

  function escapeHtml(text) {
    if (text == null) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function safeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    var t = url.trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    return 'https://' + t;
  }

  function sortAdItemsByClicksDesc(items) {
    return items.slice().sort(function (a, b) {
      var ca = Number(a.data && a.data.clicks) || 0;
      var cb = Number(b.data && b.data.clicks) || 0;
      return cb - ca;
    });
  }

  async function fetchAdsByStatus(status) {
    const snapshot = await window.db
      .collection('sponsoredTools')
      .where('status', '==', status)
      .get();

    return snapshot.docs.map(function (doc) {
      return { id: doc.id, ...doc.data() };
    });
  }

  async function isSlotTakenExcludingDoc(slot, months, excludeDocId) {
    if (!slot || !months || !months.length) return false;
    const st = window.AdBooking.slotLockedStatuses();
    const snapshot = await window.db
      .collection('sponsoredTools')
      .where('status', 'in', st)
      .get();

    var self = { slot: slot, months: months };
    for (const doc of snapshot.docs) {
      if (excludeDocId && String(doc.id) === String(excludeDocId)) continue;
      const data = doc.data() || {};
      if (window.AdBooking.monthsOverlapSameSlot(self, { slot: data.slot, months: data.months || [] })) {
        return true;
      }
    }
    return false;
  }

  function renderAdRow(tool, docId, actionType) {
    var fromImage = tool.image && String(tool.image).trim();
    var imageSrc = fromImage ? fromImage : DEFAULT_AD_IMAGE;
    if (imageSrc === DEFAULT_AD_IMAGE) {
      var fromLogo = tool.logo && String(tool.logo).trim();
      if (fromLogo) imageSrc = fromLogo;
    }
    var logo = '<img src="' + escapeHtml(imageSrc) + '" class="sponsored-tool-logo" alt="Tool Logo">';
    var toolName = escapeHtml((tool.toolName && tool.toolName.trim()) || 'Unnamed Tool');
    var companyName = escapeHtml((tool.companyName && tool.companyName.trim()) || '');
    var description = escapeHtml((tool.description && tool.description.trim()) || '');
    var urlRaw = (tool.url && String(tool.url).trim()) || (tool.website && String(tool.website).trim());
    var hasUrl = !!urlRaw;
    var website = hasUrl ? safeUrl(urlRaw) : '';
    var websiteDisplay =
      hasUrl && website
        ? '<a href="' +
          escapeHtml(website) +
          '" target="_blank" rel="noopener" class="btn-outline" style="display:inline-block; margin-top:8px;">Visit</a>'
        : '';
    var clicks = Number(tool.clicks) || 0;
    var views = Number(tool.views) || 0;
    var ctrStr = views > 0 ? ((clicks / views) * 100).toFixed(1) : '0.0';
    var rawStatus = normalizeStatus(tool.status);
    var status = rawStatus || (actionType === 'waiting_payment' ? 'approved' : actionType);
    var statusBadge = '<span class="status-badge ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>';

    var actionsHtml = '';
    if (actionType === 'pending') {
      actionsHtml =
        '<div class="admin-ads-actions">' +
        '<button type="button" class="btn btn-primary admin-btn-approve" data-tool-id="' +
        escapeHtml(docId) +
        '">Approve</button> ' +
        '<button type="button" class="btn btn-secondary admin-btn-reject" data-tool-id="' +
        escapeHtml(docId) +
        '">Reject</button> ' +
        '<button type="button" class="btn btn-secondary admin-btn-delete" data-id="' +
        escapeHtml(docId) +
        '">Delete</button>' +
        '</div>';
    } else if (actionType === 'waiting_payment') {
      actionsHtml =
        '<div class="admin-ads-actions">' +
        '<button type="button" class="btn btn-secondary admin-btn-delete" data-id="' +
        escapeHtml(docId) +
        '">Delete</button>' +
        '</div>';
    } else if (actionType === 'live') {
      var visitBtn =
        hasUrl && website
          ? '<a href="' +
            escapeHtml(website) +
            '" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration:none;">Visit</a> '
          : '';
      actionsHtml =
        '<div class="admin-ads-actions">' +
        visitBtn +
        '<button type="button" class="btn btn-secondary admin-btn-delete" data-id="' +
        escapeHtml(docId) +
        '">Delete</button>' +
        '</div>';
    } else {
      actionsHtml =
        '<div class="admin-ads-actions">' +
        '<button type="button" class="btn btn-secondary admin-btn-delete" data-id="' +
        escapeHtml(docId) +
        '">Delete</button>' +
        '</div>';
    }

    var hideWebsite = actionType === 'live' || actionType === 'expired' || actionType === 'rejected';
    var adCell =
      '<div>' +
      logo +
      '<h3 style="margin:8px 0 4px;">' +
      toolName +
      '</h3>' +
      statusBadge +
      (companyName ? '<p style="margin:0; font-size:14px; color: var(--text-muted);">' + companyName + '</p>' : '') +
      (description ? '<p style="margin-top:8px;">' + description + '</p>' : '') +
      (hideWebsite ? '' : websiteDisplay) +
      '</div>';

    return (
      '<tr class="admin-ad-row" data-tool-id="' +
      escapeHtml(docId) +
      '">' +
      '<td class="admin-ad-cell">' +
      adCell +
      '</td>' +
      '<td class="admin-ad-cell-numeric">' +
      clicks +
      '</td>' +
      '<td class="admin-ad-cell-numeric">' +
      views +
      '</td>' +
      '<td class="admin-ad-cell-numeric">' +
      ctrStr +
      '%</td>' +
      '<td class="admin-ad-cell-actions">' +
      actionsHtml +
      '</td>' +
      '</tr>'
    );
  }

  function wrapAdTable(bodyRowsHtml) {
    return (
      '<table class="admin-sponsored-table">' +
      '<thead><tr><th>Ad</th><th>Clicks</th><th>Views</th><th>CTR</th><th></th></tr></thead>' +
      '<tbody>' +
      bodyRowsHtml +
      '</tbody>' +
      '</table>'
    );
  }

  function emptyMsg() {
    return '<p style="color: var(--text-muted);">No ads yet.</p>';
  }

  function setAll(msg) {
    var p = '<p style="color: var(--text-muted);">' + escapeHtml(msg) + '</p>';
    pendingEl.innerHTML = p;
    waitingPaymentEl.innerHTML = p;
    liveAdsEl.innerHTML = p;
    expiredAdsEl.innerHTML = p;
    rejectedEl.innerHTML = p;
  }

  function render() {
    Promise.all([
      fetchAdsByStatus('pending'),
      fetchAdsByStatus('approved'),
      fetchAdsByStatus('live'),
      fetchAdsByStatus('expired'),
      fetchAdsByStatus('rejected')
    ])
      .then(function (responses) {
        var snapshot = []
          .concat(responses[0] || [])
          .concat(responses[1] || [])
          .concat(responses[2] || [])
          .concat(responses[3] || [])
          .concat(responses[4] || []);
        var validStatuses = ['pending', 'approved', 'live', 'expired', 'rejected'];
        var pending = [];
        var waitingPayment = [];
        var live = [];
        var expired = [];
        var rejected = [];

        if (!snapshot.length) {
          pendingEl.innerHTML = emptyMsg();
          waitingPaymentEl.innerHTML = emptyMsg();
          liveAdsEl.innerHTML = emptyMsg();
          expiredAdsEl.innerHTML = emptyMsg();
          rejectedEl.innerHTML = emptyMsg();
          return;
        }

        snapshot.forEach(function (doc) {
          var data = doc || {};
          var status = normalizeStatus(data.status);
          if (!validStatuses.includes(status)) {
            console.warn('Invalid ad status:', data);
          }
          var item = { id: doc.id, data: data };
          if (isStatus(data, STATUS.PENDING)) pending.push(item);
          else if (isStatus(data, STATUS.APPROVED)) waitingPayment.push(item);
          else if (isStatus(data, STATUS.LIVE)) live.push(item);
          else if (isStatus(data, STATUS.EXPIRED)) expired.push(item);
          else rejected.push(item);
        });

        pendingEl.innerHTML = pending.length
          ? wrapAdTable(
              sortAdItemsByClicksDesc(pending)
                .map(function (t) { return renderAdRow(t.data, t.id, 'pending'); })
                .join('')
            )
          : emptyMsg();

        waitingPaymentEl.innerHTML = waitingPayment.length
          ? wrapAdTable(
              sortAdItemsByClicksDesc(waitingPayment)
                .map(function (t) { return renderAdRow(t.data, t.id, 'waiting_payment'); })
                .join('')
            )
          : emptyMsg();

        liveAdsEl.innerHTML = live.length
          ? wrapAdTable(
              sortAdItemsByClicksDesc(live)
                .map(function (t) { return renderAdRow(t.data, t.id, 'live'); })
                .join('')
            )
          : emptyMsg();

        expiredAdsEl.innerHTML = expired.length
          ? wrapAdTable(
              sortAdItemsByClicksDesc(expired)
                .map(function (t) { return renderAdRow(t.data, t.id, 'expired'); })
                .join('')
            )
          : emptyMsg();

        rejectedEl.innerHTML = rejected.length
          ? wrapAdTable(
              sortAdItemsByClicksDesc(rejected)
                .map(function (t) { return renderAdRow(t.data, t.id, 'rejected'); })
                .join('')
            )
          : emptyMsg();

        pendingEl.querySelectorAll('.admin-btn-approve').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var id = btn.getAttribute('data-tool-id');
            if (!id) return;
            btn.disabled = true;
            try {
              const docRef = window.db.collection('sponsoredTools').doc(String(id));
              const docSnap = await docRef.get();
              const data = docSnap.data() || {};

              const taken = await isSlotTakenExcludingDoc(data.slot, data.months, id);

              if (taken) {
                alert('This slot is already booked for one of the selected months.');
                btn.disabled = false;
                return;
              }

              await postApproveAd(id);
              if (IS_DEV && window.db) {
                try {
                  var snapAfter = await window.db.collection('sponsoredTools').doc(String(id)).get();
                  var d = snapAfter.data() || {};
                  var monthsArr = Array.isArray(d.months) ? d.months : [];
                  var monthsCount = monthsArr.length > 0 ? monthsArr.length : 1;
                  var expiry = Date.now() + monthsCount * 30 * 24 * 60 * 60 * 1000;
                  await window.db.collection('sponsoredTools').doc(String(id)).update({
                    status: 'live',
                    paidAt: Date.now(),
                    expiresAt: expiry,
                    monthsPurchased: monthsCount
                  });
                  console.log('DEV MODE: Auto-marking ad as paid / live (no PayFast)');
                } catch (devErr) {
                  console.error('DEV promote ad after approve failed:', devErr);
                }
              }
              btn.disabled = false;
              render();
            } catch (err) {
              btn.disabled = false;
              var msg = err && err.message ? err.message : 'Approval failed';
              alert(msg);
              if (console && console.error) console.error(err);
            }
          });
        });

        pendingEl.querySelectorAll('.admin-btn-reject').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-tool-id');
            if (!id) return;
            btn.disabled = true;
            window.db.collection('sponsoredTools').doc(String(id)).update({ status: 'rejected' })
              .then(render)
              .catch(function (err) {
                btn.disabled = false;
                console.error(err);
              });
          });
        });

        applyAdsFilter();
      })
      .catch(function (err) {
        setAll('Could not load ads. Please try again later.');
        if (console && console.error) console.error(err);
      });
  }

  firebase.auth().onAuthStateChanged(async function (user) {
    if (!user) {
      alert('Please log in as admin');
      return;
    }

    var tokenResult = await user.getIdTokenResult();
    if (!tokenResult.claims.admin) {
      alert('Please log in as admin');
      return;
    }

    render();
  });

  document.addEventListener('click', async function (e) {
    if (e.target.classList.contains('admin-btn-delete')) {
      var id = e.target.dataset.id;
      if (!id) return;
      await window.db.collection('sponsoredTools').doc(id).delete();
      location.reload();
    }
  });

  function applyAdsFilter() {
    var filter = document.getElementById('adsFilter');
    if (!filter) return;

    var selected = filter.value;

    var sections = {
      pending: document.getElementById('pendingAds'),
      approved: document.getElementById('waitingPaymentAds'),
      live: document.getElementById('liveAds'),
      expired: document.getElementById('expiredAds'),
      rejected: document.getElementById('rejectedAds')
    };

    Object.keys(sections).forEach(function (key) {
      var el = sections[key];
      if (!el) return;
      var sectionEl = el.closest('section');
      if (!sectionEl) return;

      if (selected === 'all') {
        sectionEl.style.removeProperty('display');
      } else {
        if (key === selected) {
          sectionEl.style.removeProperty('display');
        } else {
          sectionEl.style.display = 'none';
        }
      }
    });
  }

  document.getElementById('adsFilter')?.addEventListener('change', applyAdsFilter);
})();

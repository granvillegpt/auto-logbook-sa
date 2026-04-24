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

  var activeAdsTab = 'pending';

  var IS_DEV =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  var sponsoredToolsListenerUnsub = null;

  function postApproveAd(adId) {
    return new Promise(function (resolve, reject) {
      if (typeof firebase === 'undefined' || !firebase.auth) {
        reject(new Error('Auth not available'));
        return;
      }
      var user = firebase.auth().currentUser;
      if (!user) {
        alert('User not authenticated');
        reject(new Error('Not logged in'));
        return;
      }
      user
        .getIdToken()
        .then(function (idToken) {
          // DEBUG START
          console.log('ID TOKEN:', idToken);
          // DEBUG END
          return fetch('/api/admin-dashboard', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + idToken
            },
            body: JSON.stringify({ action: 'approveAd', adId: adId })
          });
        })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok || !data.success) {
              throw new Error((data && data.error) || 'Action failed');
            }
            return data;
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

  function formatSlotType(slot) {
    var key =
      window.AdBooking && typeof window.AdBooking.canonicalSlotKey === 'function'
        ? window.AdBooking.canonicalSlotKey(slot)
        : '';
    var map = {
      featured: 'Featured',
      slot1: 'Slot 1',
      slot2: 'Slot 2',
      slot3: 'Slot 3'
    };
    if (key && map[key]) return map[key];
    var s = slot != null ? String(slot).trim() : '';
    return s || '—';
  }

  function paidAtMs(data) {
    if (!data || data.paidAt == null) return null;
    var p = data.paidAt;
    if (typeof p.toMillis === 'function') return p.toMillis();
    if (typeof p.toDate === 'function') {
      var d = p.toDate();
      return d && !isNaN(d.getTime()) ? d.getTime() : null;
    }
    if (typeof p.seconds === 'number') return p.seconds * 1000;
    if (typeof p === 'number') return p;
    return null;
  }

  function updateAdsMetrics(flatDocs) {
    var liveCount = 0;
    var pendingCount = 0;
    var totalLiveClicks = 0;
    var totalLiveViews = 0;
    var now = new Date();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    var monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    var monthRevenue = 0;

    flatDocs.forEach(function (doc) {
      var data = doc || {};
      var st = normalizeStatus(data.status);
      if (st === STATUS.LIVE) {
        liveCount++;
        totalLiveClicks += Number(data.clicks) || 0;
        totalLiveViews += Number(data.views) || 0;
      }
      if (st === STATUS.PENDING) pendingCount++;

      var paidMs = paidAtMs(data);
      if (paidMs != null && paidMs >= monthStart && paidMs <= monthEnd) {
        var amt = Number(data.amount);
        if (Number.isFinite(amt)) monthRevenue += amt;
      }
    });

    var avgCtr = totalLiveViews > 0 ? (totalLiveClicks / totalLiveViews) * 100 : 0;

    var elLive = document.getElementById('adsMetricLive');
    var elPending = document.getElementById('adsMetricPending');
    var elRev = document.getElementById('adsMetricMonthlyRevenue');
    var elCtr = document.getElementById('adsMetricAvgCtr');
    if (elLive) elLive.textContent = String(liveCount);
    if (elPending) elPending.textContent = String(pendingCount);
    if (elRev) elRev.textContent = 'R' + monthRevenue.toLocaleString();
    if (elCtr) elCtr.textContent = avgCtr.toFixed(1) + '%';
  }

  var DESC_PREVIEW = 120;

  function renderDescriptionBlock(descriptionRaw) {
    var d = descriptionRaw != null ? String(descriptionRaw).trim() : '';
    if (!d) return '';
    if (d.length <= DESC_PREVIEW) {
      return '<p class="admin-ad-desc">' + escapeHtml(d) + '</p>';
    }
    return (
      '<div class="admin-ad-desc-wrap">' +
      '<p class="admin-ad-desc">' +
      '<span class="admin-ad-desc-preview">' +
      escapeHtml(d.slice(0, DESC_PREVIEW)) +
      '…</span>' +
      '<span class="admin-ad-desc-full" hidden>' +
      escapeHtml(d) +
      '</span>' +
      '</p>' +
      '<button type="button" class="btn btn-secondary admin-ad-desc-toggle" style="margin-top:6px;padding:4px 12px;font-size:12px;">Show more</button>' +
      '</div>'
    );
  }

  function renderAdCard(tool, docId, actionType) {
    var fromImage = tool.image && String(tool.image).trim();
    var imageSrc = fromImage ? fromImage : DEFAULT_AD_IMAGE;
    if (imageSrc === DEFAULT_AD_IMAGE) {
      var fromLogo = tool.logo && String(tool.logo).trim();
      if (fromLogo) imageSrc = fromLogo;
    }
    var clicks = Number(tool.clicks) || 0;
    var views = Number(tool.views) || 0;
    var ctrStr = views > 0 ? ((clicks / views) * 100).toFixed(1) : '0.0';
    var rawStatus = normalizeStatus(tool.status);
    var status = rawStatus || (actionType === 'waiting_payment' ? 'approved' : actionType);
    var statusBadge = '<span class="status-badge ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>';

    var businessName = escapeHtml(
      (tool.companyName && tool.companyName.trim()) ||
        (tool.toolName && tool.toolName.trim()) ||
        'Unnamed'
    );
    var slotLabel = escapeHtml(formatSlotType(tool.slot));

    var urlRaw =
      (tool.url && String(tool.url).trim()) || (tool.website && String(tool.website).trim());
    var hasUrl = !!urlRaw;
    var website = hasUrl ? safeUrl(urlRaw) : '';

    var viewAdControl =
      hasUrl && website
        ? '<a href="' +
          escapeHtml(website) +
          '" target="_blank" rel="noopener" class="btn btn-primary">View Ad</a>'
        : '<button type="button" class="btn btn-primary" disabled title="No URL">View Ad</button>';

    var pauseBtn =
      '<button type="button" class="btn btn-secondary admin-ad-pause-btn" disabled title="Coming soon">Pause</button>';

    var deleteBtn =
      '<button type="button" class="btn btn-secondary admin-btn-delete" data-id="' +
      escapeHtml(docId) +
      '">Delete</button>';

    var descBlock = renderDescriptionBlock(tool.description);

    var actionsInner = '';
    if (actionType === 'pending') {
      actionsInner =
        '<button type="button" class="btn btn-primary admin-btn-approve" data-tool-id="' +
        escapeHtml(docId) +
        '">Approve</button>' +
        '<button type="button" class="btn btn-secondary admin-btn-reject" data-tool-id="' +
        escapeHtml(docId) +
        '">Reject</button>' +
        deleteBtn;
    } else {
      actionsInner = viewAdControl + pauseBtn + deleteBtn;
    }

    return (
      '<article class="admin-sponsored-ad-card" data-tool-id="' +
      escapeHtml(docId) +
      '">' +
      '<img class="admin-sponsored-ad-card__img" src="' +
      escapeHtml(imageSrc) +
      '" alt="">' +
      '<div class="admin-sponsored-ad-card__body">' +
      '<h3 class="admin-sponsored-ad-card__title">' +
      businessName +
      '</h3>' +
      '<div class="admin-sponsored-ad-card__meta">' +
      '<span>Slot: ' +
      slotLabel +
      '</span> ' +
      statusBadge +
      '</div>' +
      '<dl class="admin-sponsored-ad-card__stats">' +
      '<div><dt>Views</dt><dd>' +
      views +
      '</dd></div>' +
      '<div><dt>Clicks</dt><dd>' +
      clicks +
      '</dd></div>' +
      '<div><dt>CTR</dt><dd>' +
      ctrStr +
      '%</dd></div>' +
      '</dl>' +
      descBlock +
      '</div>' +
      '<div class="admin-sponsored-ad-card__actions">' +
      actionsInner +
      '</div>' +
      '</article>'
    );
  }

  function emptyGridMsg() {
    return '<p class="admin-sponsored-empty">No ads in this category.</p>';
  }

  function setAll(msg) {
    var p = '<p class="admin-sponsored-empty">' + escapeHtml(msg) + '</p>';
    pendingEl.innerHTML = p;
    waitingPaymentEl.innerHTML = p;
    liveAdsEl.innerHTML = p;
    expiredAdsEl.innerHTML = p;
    rejectedEl.innerHTML = p;
    updateAdsMetrics([]);
    syncAdsTab();
  }

  function render() {
    if (!window.db) {
      setAll('Could not load ads. Please try again later.');
      return;
    }
    if (sponsoredToolsListenerUnsub) {
      return;
    }
    sponsoredToolsListenerUnsub = window.db.collection('sponsoredTools').onSnapshot(
      function (snap) {
        console.log('🔥 ADMIN REALTIME UPDATE:', snap.size);
        var rawReviews = [];
        var pending = [];
        var approved = [];
        var rejected = [];
        var waitingPayment = [];
        var live = [];
        var expired = [];
        pendingEl.innerHTML = '';
        waitingPaymentEl.innerHTML = '';
        liveAdsEl.innerHTML = '';
        expiredAdsEl.innerHTML = '';
        rejectedEl.innerHTML = '';
        var snapshot = snap.docs.map(function (d) {
          return { id: d.id, ...d.data() };
        });
        var validStatuses = ['pending', 'approved', 'live', 'expired', 'rejected'];

        if (!snapshot.length) {
          updateAdsMetrics([]);
          pendingEl.innerHTML = emptyGridMsg();
          waitingPaymentEl.innerHTML = emptyGridMsg();
          liveAdsEl.innerHTML = emptyGridMsg();
          expiredAdsEl.innerHTML = emptyGridMsg();
          rejectedEl.innerHTML = emptyGridMsg();
          syncAdsTab();
          return;
        }

        updateAdsMetrics(snapshot);

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
          ? sortAdItemsByClicksDesc(pending)
              .map(function (t) { return renderAdCard(t.data, t.id, 'pending'); })
              .join('')
          : emptyGridMsg();

        waitingPaymentEl.innerHTML = waitingPayment.length
          ? sortAdItemsByClicksDesc(waitingPayment)
              .map(function (t) { return renderAdCard(t.data, t.id, 'waiting_payment'); })
              .join('')
          : emptyGridMsg();

        liveAdsEl.innerHTML = live.length
          ? sortAdItemsByClicksDesc(live)
              .map(function (t) { return renderAdCard(t.data, t.id, 'live'); })
              .join('')
          : emptyGridMsg();

        expiredAdsEl.innerHTML = expired.length
          ? sortAdItemsByClicksDesc(expired)
              .map(function (t) { return renderAdCard(t.data, t.id, 'expired'); })
              .join('')
          : emptyGridMsg();

        rejectedEl.innerHTML = rejected.length
          ? sortAdItemsByClicksDesc(rejected)
              .map(function (t) { return renderAdCard(t.data, t.id, 'rejected'); })
              .join('')
          : emptyGridMsg();

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
          btn.addEventListener('click', async function () {
            var id = btn.getAttribute('data-tool-id');
            if (!id) return;
            btn.disabled = true;
            try {
              var authUser = firebase.auth().currentUser;
              if (!authUser) {
                alert('User not authenticated');
                btn.disabled = false;
                return;
              }
              const idToken = await authUser.getIdToken();
              // DEBUG START
              console.log('ID TOKEN:', idToken);
              // DEBUG END
              const res = await fetch('/api/admin-dashboard', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + idToken
                },
                body: JSON.stringify({ action: 'rejectAd', adId: id })
              });
              const data = await res.json();
              if (!res.ok || !data.success) {
                throw new Error(data.error || 'Action failed');
              }
              render();
            } catch (err) {
              btn.disabled = false;
              console.error(err);
              alert(err && err.message ? err.message : 'Reject failed');
            }
          });
        });

        syncAdsTab();
      },
      function (err) {
        setAll('Could not load ads. Please try again later.');
        if (console && console.error) console.error(err);
      }
    );
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
    var delBtn = e.target.closest && e.target.closest('.admin-btn-delete');
    if (delBtn && delBtn.classList.contains('admin-btn-delete')) {
      var id = delBtn.dataset.id;
      if (!id) return;
      try {
        var authUser = firebase.auth().currentUser;
        if (!authUser) {
          alert('User not authenticated');
          return;
        }
        var idToken = await authUser.getIdToken();
        // DEBUG START
        console.log('ID TOKEN:', idToken);
        // DEBUG END
        var res = await fetch('/api/admin-dashboard', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + idToken
          },
          body: JSON.stringify({
            action: 'deleteAd',
            adId: id
          })
        });
        var data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Action failed');
        }
        location.reload();
      } catch (err) {
        alert(err && err.message ? err.message : 'Delete failed');
        if (console && console.error) console.error(err);
      }
    }
  });

  function setAdsTab(tabKey) {
    activeAdsTab = tabKey;
    var tabs = document.querySelectorAll('#adsPanel .admin-ads-tab');
    tabs.forEach(function (btn) {
      var k = btn.getAttribute('data-ads-tab');
      var on = k === tabKey;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#adsPanel .admin-ads-panel-section').forEach(function (sec) {
      var k = sec.getAttribute('data-ads-section');
      sec.hidden = k !== tabKey;
    });
  }

  function syncAdsTab() {
    setAdsTab(activeAdsTab);
  }

  var adsPanelEl = document.getElementById('adsPanel');
  if (adsPanelEl) {
    adsPanelEl.addEventListener('click', function (e) {
      var tabBtn = e.target.closest && e.target.closest('.admin-ads-tab');
      if (!tabBtn || !adsPanelEl.contains(tabBtn)) return;
      var k = tabBtn.getAttribute('data-ads-tab');
      if (k) setAdsTab(k);
    });
  }

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest && e.target.closest('.admin-ad-desc-toggle');
    if (!toggle || !adsPanelEl || !adsPanelEl.contains(toggle)) return;
    var wrap = toggle.closest('.admin-ad-desc-wrap');
    if (!wrap) return;
    var preview = wrap.querySelector('.admin-ad-desc-preview');
    var full = wrap.querySelector('.admin-ad-desc-full');
    if (!preview || !full) return;
    var expanded = !full.hasAttribute('hidden');
    if (!expanded) {
      preview.setAttribute('hidden', '');
      full.removeAttribute('hidden');
      toggle.textContent = 'Show less';
    } else {
      full.setAttribute('hidden', '');
      preview.removeAttribute('hidden');
      toggle.textContent = 'Show more';
    }
  });
})();

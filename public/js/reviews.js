/**
 * Reviews UI: load approved reviews, render cards, star rating, form submit.
 * All review data goes through reviewService (no direct storage access).
 */
import { getApprovedReviews } from './services/reviewService.js';

const IS_ADMIN_PAGE =
  typeof window !== 'undefined' && window.location.pathname.includes('admin');

function starsHtml(rating) {
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += i <= rating ? '★' : '☆';
  }
  return s;
}

function toDateString(val) {
  if (!val) return '';
  if (val.toDate && typeof val.toDate === 'function') return val.toDate().toISOString();
  return typeof val === 'string' ? val : (val.seconds ? new Date(val.seconds * 1000).toISOString() : '');
}

/** e.g. "March 2026" for review footer */
function formatMonthYear(isoOrTimestamp) {
  const raw = toDateString(isoOrTimestamp);
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
}

function avatarInitial(review) {
  const name = (review.name || '').trim();
  if (name.length) return name.charAt(0).toUpperCase();
  const company = (review.company || '').trim();
  if (company.length) return company.charAt(0).toUpperCase();
  return '?';
}

function renderReviewCard(review) {
  const by = [];
  if (review.name) by.push(review.name);
  if (review.company) by.push(review.company);
  const monthYear = formatMonthYear(review.date || review.createdAt);
  const authorLine = by.length ? escapeHtml(by.join(', ')) : '';
  const initial = avatarInitial(review);
  const authorHtml = by.length
    ? '<div class="review-author">' +
      '<div class="review-avatar" aria-hidden="true">' + escapeHtml(initial) + '</div>' +
      '<div>' +
      '<div class="review-name">' + authorLine + '</div>' +
      (monthYear ? '<div class="review-date">' + escapeHtml(monthYear) + '</div>' : '') +
      '</div>' +
      '</div>'
    : '';
  return (
    '<div class="review-card">' +
    '<div class="review-stars" aria-label="' + review.rating + ' out of 5 stars">' + starsHtml(review.rating) + '</div>' +
    '<p class="review-comment">"' + escapeHtml(review.comment) + '"</p>' +
    authorHtml +
    '</div>'
  );
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function loadApprovedReviews() {
  if (IS_ADMIN_PAGE) return;
  const el = document.getElementById('reviewsList');
  if (!el) return;
  const app = typeof firebase !== 'undefined' && firebase.apps && firebase.apps[0];
  if (app && window.db) {
    window.db.collection('reviews_approved').orderBy('createdAt', 'desc').limit(20).get()
      .then((snap) => {
        const reviews = [];
        snap.forEach((doc) => reviews.push({ id: doc.id, ...doc.data() }));
        el.innerHTML = reviews.length
          ? reviews.map(renderReviewCard).join('')
          : '<p class="reviews-empty">No reviews yet. Be the first to leave one below.</p>';
      })
      .catch(() => {
        const reviews = getApprovedReviews();
        el.innerHTML = reviews.length
          ? reviews.map(renderReviewCard).join('')
          : '<p class="reviews-empty">No reviews yet. Be the first to leave one below.</p>';
      });
  } else {
    const reviews = getApprovedReviews();
    el.innerHTML = reviews.length
      ? reviews.map(renderReviewCard).join('')
      : '<p class="reviews-empty">No reviews yet. Be the first to leave one below.</p>';
  }
}

function initStarRating() {
  const container = document.getElementById('starRating');
  const input = document.getElementById('reviewRating');
  if (!container || !input) return;
  const stars = container.querySelectorAll('.star');
  function setValue(val) {
    input.value = val;
    stars.forEach((star, i) => {
      star.classList.toggle('star-filled', (i + 1) <= val);
    });
  }
  stars.forEach((star, i) => {
    const val = i + 1;
    star.addEventListener('click', () => setValue(val));
    star.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setValue(val);
      }
    });
  });
}

function initReviewForm() {
  const form = document.getElementById('reviewForm');
  const messageEl = document.getElementById('reviewFormMessage');
  if (!form || !messageEl) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = (document.getElementById('reviewName') && document.getElementById('reviewName').value) || '';
    const company = (document.getElementById('reviewCompany') && document.getElementById('reviewCompany').value) || '';
    const rating = parseInt(document.getElementById('reviewRating') && document.getElementById('reviewRating').value, 10) || 0;
    const comment = (document.getElementById('reviewComment') && document.getElementById('reviewComment').value) || '';

    if (rating < 1 || rating > 5) {
      messageEl.textContent = 'Please select a star rating.';
      messageEl.className = 'review-form-message error';
      return;
    }
    if (!comment.trim()) {
      messageEl.textContent = 'Please enter a comment.';
      messageEl.className = 'review-form-message error';
      return;
    }

    try {
      console.log('Submitting review');

      const res = await fetch('/api/submit-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          company,
          rating,
          comment: comment.trim()
        })
      });
      let data = {};
      try {
        data = await res.json();
      } catch (_e) {
        throw new Error('Failed to submit review');
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit review');
      }

      const successEl = document.getElementById('reviewSuccess');
      if (successEl) {
        form.style.display = 'none';
        messageEl.style.display = 'none';
        successEl.classList.remove('hidden');
      }
      form.reset();
      if (document.getElementById('reviewRating')) document.getElementById('reviewRating').value = '0';
      document.querySelectorAll('#starRating .star').forEach((s) => s.classList.remove('star-filled'));

    } catch (error) {
      console.error('Review submission failed:', error);
      messageEl.textContent = error && error.message ? error.message : 'Could not submit review. Try again.';
      messageEl.className = 'review-form-message error';
    }
  });
}

function initReviewModal() {
  const openBtn = document.getElementById('openReviewModalBtn');
  const modal = document.getElementById('reviewModal');
  const closeBtn = document.getElementById('closeReviewModal');
  let lastFocusedElement = null;
  if (!openBtn || !modal) return;

  openBtn.addEventListener('click', () => {
    lastFocusedElement = document.activeElement;
    window._lastModalOpener = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    const msg = document.getElementById('reviewFormMessage');
    msg.textContent = '';
    msg.className = 'review-form-message';
    msg.style.display = '';
    const form = document.getElementById('reviewForm');
    if (form) form.style.display = '';
    const successEl = document.getElementById('reviewSuccess');
    if (successEl) successEl.classList.add('hidden');
  });

  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

function init() {
  if (IS_ADMIN_PAGE) return;
  loadApprovedReviews();
  initStarRating();
  initReviewForm();
  initReviewModal();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

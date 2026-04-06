/**
 * Review service – all review storage/retrieval goes through this module.
 * UI must only call these functions; no direct fetch/localStorage/firebase in pages.
 */
import { STORAGE_MODE } from './storageAdapter.js';

/**
 * @param {string} dateString - ISO date string
 * @returns {string} e.g. "14 March 2026"
 */
export function formatReviewDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const STORAGE_KEY = 'autoLogbookReviews';

function localLoadReviews() {
  return JSON.parse(typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) || '[]');
}

function localSaveReviews(reviews) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
  }
}

function firebaseGetApproved() {
  // Placeholder: replace with Firestore query when STORAGE_MODE === 'firebase'
  return [];
}

function firebaseGetPending() {
  // Placeholder: replace with Firestore query when STORAGE_MODE === 'firebase'
  return [];
}

function firebaseSubmitReview(/* review */) {
  // Placeholder: replace with Firestore add when STORAGE_MODE === 'firebase'
}

function firebaseApproveReview(/* id */) {
  // Placeholder: replace with Firestore update when STORAGE_MODE === 'firebase'
}

function firebaseRejectReview(/* id */) {
  // Placeholder: replace with Firestore delete when STORAGE_MODE === 'firebase'
}

function getStatus(r) {
  if (r.status) return r.status;
  return r.approved === true ? 'approved' : 'pending';
}

/**
 * @returns {Array} Reviews where status === 'pending'
 */
export function getPendingReviews() {
  if (STORAGE_MODE === 'firebase') {
    return firebaseGetPending();
  }
  return localLoadReviews().filter((r) => getStatus(r) === 'pending');
}

/**
 * @returns {Array} Reviews where status === 'approved'
 */
export function getApprovedReviews() {
  if (STORAGE_MODE === 'firebase') {
    return firebaseGetApproved();
  }
  return localLoadReviews().filter((r) => getStatus(r) === 'approved');
}

/**
 * @returns {Array} Reviews where status === 'rejected'
 */
export function getRejectedReviews() {
  if (STORAGE_MODE === 'firebase') {
    return []; // placeholder: add firebaseGetRejected when needed
  }
  return localLoadReviews().filter((r) => getStatus(r) === 'rejected');
}

/**
 * @param {{ name?: string, company?: string, rating: number, comment: string }} review
 */
export function submitReview(review) {
  if (STORAGE_MODE === 'firebase') {
    firebaseSubmitReview(review);
    return;
  }
  const reviews = localLoadReviews();
  const now = new Date().toISOString();
  const entry = {
    id: String(Date.now()),
    name: (review.name || '').trim(),
    company: (review.company || '').trim(),
    rating: Math.min(5, Math.max(1, Math.floor(review.rating))),
    comment: (review.comment || '').trim(),
    date: now,
    status: 'pending',
    approved: false,
    createdAt: now,
  };
  reviews.push(entry);
  localSaveReviews(reviews);
}

/**
 * @param {string|number} id
 */
export function approveReview(id) {
  if (STORAGE_MODE === 'firebase') {
    firebaseApproveReview(id);
    return;
  }
  const reviews = localLoadReviews();
  const index = reviews.findIndex((r) => String(r.id) === String(id));
  if (index === -1) return;
  reviews[index].status = 'approved';
  reviews[index].approved = true;
  if (!reviews[index].date) reviews[index].date = new Date().toISOString();
  localSaveReviews(reviews);
}

/**
 * @param {string|number} id - set status to rejected (review stays in storage)
 */
export function rejectReview(id) {
  if (STORAGE_MODE === 'firebase') {
    firebaseRejectReview(id);
    return;
  }
  const reviews = localLoadReviews();
  const index = reviews.findIndex((r) => String(r.id) === String(id));
  if (index === -1) return;
  reviews[index].status = 'rejected';
  reviews[index].approved = false;
  if (!reviews[index].date) reviews[index].date = new Date().toISOString();
  localSaveReviews(reviews);
}

/**
 * @param {string|number} id - permanently remove review from storage
 */
export function deleteReview(id) {
  if (STORAGE_MODE === 'firebase') {
    // placeholder: add firebaseDeleteReview when needed
    return;
  }
  const reviews = localLoadReviews().filter((r) => String(r.id) !== String(id));
  localSaveReviews(reviews);
}

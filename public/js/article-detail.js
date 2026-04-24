/**
 * Single article — slug from /articles/{slug}
 */
(function () {
  'use strict';

  var articleEl = document.getElementById('articleDetail');
  var notFoundEl = document.getElementById('articleNotFound');
  var loadingEl = document.getElementById('articleLoading');

  function escapeHtml(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function parseSlug() {
    var path = location.pathname.replace(/\/$/, '');
    var parts = path.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'articles') {
      return decodeURIComponent(parts.slice(1).join('/'));
    }
    return '';
  }

  function setMeta(title, description, imageUrl) {
    if (title) document.title = title + ' – Auto Logbook SA';
    var md = document.querySelector('meta[name="description"]');
    if (md && description) md.setAttribute('content', description);
    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && title) ogTitle.setAttribute('content', title);
    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc && description) ogDesc.setAttribute('content', description);
    var ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg && imageUrl) ogImg.setAttribute('content', imageUrl);
  }

  function hideLoading() {
    if (loadingEl) loadingEl.style.display = 'none';
  }

  function run() {
    var slug = parseSlug();
    if (!slug || !window.db) {
      hideLoading();
      if (articleEl) articleEl.classList.add('hidden');
      if (notFoundEl) notFoundEl.classList.remove('hidden');
      return;
    }

    window.db
      .collection('articles')
      .doc(slug)
      .get()
      .then(function (docSnap) {
        hideLoading();
        if (!docSnap.exists) {
          if (articleEl) articleEl.classList.add('hidden');
          if (notFoundEl) notFoundEl.classList.remove('hidden');
          return;
        }
        var a = docSnap.data() || {};
        if (!a.published) {
          if (articleEl) articleEl.classList.add('hidden');
          if (notFoundEl) notFoundEl.classList.remove('hidden');
          return;
        }

        var title = a.title || slug;
        var metaTitle = (a.metaTitle && String(a.metaTitle).trim()) || title;
        var metaDesc =
          (a.metaDescription && String(a.metaDescription).trim()) ||
          (a.excerpt && String(a.excerpt).trim()) ||
          '';
        var img = a.featuredImageUrl ? String(a.featuredImageUrl).trim() : '';
        setMeta(metaTitle, metaDesc, img);

        var author = a.authorName ? escapeHtml(a.authorName) : '';
        var bodyHtml = typeof a.body === 'string' ? a.body : '';

        var inner =
          (img
            ? '<figure class="article-featured-wrap"><img src="' +
              escapeHtml(img) +
              '" alt="" class="article-featured-img" /></figure>'
            : '') +
          '<header class="article-header">' +
          '<h1 class="article-title">' +
          escapeHtml(title) +
          '</h1>' +
          (author ? '<p class="article-byline">' + author + '</p>' : '') +
          '</header>' +
          '<div class="article-body cms-body">' +
          bodyHtml +
          '</div>';

        if (articleEl) {
          articleEl.innerHTML = inner;
          articleEl.classList.remove('hidden');
        }
        if (notFoundEl) notFoundEl.classList.add('hidden');
      })
      .catch(function (err) {
        console.error('article-detail.js', err);
        hideLoading();
        if (articleEl) articleEl.classList.add('hidden');
        if (notFoundEl) notFoundEl.classList.remove('hidden');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

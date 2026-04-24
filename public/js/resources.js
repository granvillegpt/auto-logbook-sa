/**
 * Resources listing — published articles from Firestore.
 */
(function () {
  'use strict';

  var listEl = document.getElementById('resourcesArticleList');
  var emptyEl = document.getElementById('resourcesEmpty');

  function escapeHtml(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function formatDate(ts) {
    if (!ts) return '';
    var d = null;
    if (typeof ts.toDate === 'function') d = ts.toDate();
    else if (typeof ts.seconds === 'number') d = new Date(ts.seconds * 1000);
    else return '';
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function run() {
    if (!window.db || !listEl) return;
    listEl.innerHTML = '<p class="resources-loading">Loading…</p>';
    if (emptyEl) emptyEl.style.display = 'none';

    window.db
      .collection('articles')
      .where('published', '==', true)
      .orderBy('publishedAt', 'desc')
      .get()
      .then(function (snap) {
        if (snap.empty) {
          listEl.innerHTML = '';
          if (emptyEl) emptyEl.style.display = 'block';
          return;
        }
        if (emptyEl) emptyEl.style.display = 'none';
        var html = '<ul class="resources-article-list">';
        snap.forEach(function (doc) {
          var a = doc.data() || {};
          var slug = doc.id;
          var title = a.title || slug;
          var excerpt = a.excerpt || '';
          var img = a.featuredImageUrl ? String(a.featuredImageUrl).trim() : '';
          var dateStr = formatDate(a.publishedAt);
          html +=
            '<li class="resources-article-card">' +
            (img
              ? '<a href="/articles/' +
                encodeURIComponent(slug) +
                '" class="resources-article-thumb-wrap"><img src="' +
                escapeHtml(img) +
                '" alt="" class="resources-article-thumb" loading="lazy" /></a>'
              : '') +
            '<div class="resources-article-body">' +
            '<h2 class="resources-article-title"><a href="/articles/' +
            encodeURIComponent(slug) +
            '">' +
            escapeHtml(title) +
            '</a></h2>' +
            (dateStr ? '<p class="resources-article-date">' + escapeHtml(dateStr) + '</p>' : '') +
            (excerpt ? '<p class="resources-article-excerpt">' + escapeHtml(excerpt) + '</p>' : '') +
            '<a href="/articles/' +
            encodeURIComponent(slug) +
            '" class="btn btn-secondary resources-read-more">Read more</a>' +
            '</div></li>';
        });
        html += '</ul>';
        listEl.innerHTML = html;
      })
      .catch(function (err) {
        console.error('resources.js', err);
        listEl.innerHTML =
          '<p class="resources-error">Could not load articles. Please try again later.</p>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

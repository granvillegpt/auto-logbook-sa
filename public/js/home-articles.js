/**
 * Homepage — latest 3 published articles.
 */
(function () {
  'use strict';

  var mount = document.getElementById('homeLatestArticles');
  if (!mount || !window.db) return;

  function escapeHtml(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  window.db
    .collection('articles')
    .where('published', '==', true)
    .orderBy('publishedAt', 'desc')
    .limit(3)
    .get()
    .then(function (snap) {
      if (snap.empty) {
        mount.style.display = 'none';
        return;
      }
      var html = '';
      snap.forEach(function (doc) {
        var a = doc.data() || {};
        var slug = doc.id;
        var title = a.title || slug;
        var excerpt = (a.excerpt && String(a.excerpt).trim()) || '';
        if (excerpt.length > 160) excerpt = excerpt.slice(0, 157) + '…';
        html +=
          '<article class="home-article-teaser">' +
          '<h3 class="home-article-teaser-title"><a href="/articles/' +
          encodeURIComponent(slug) +
          '">' +
          escapeHtml(title) +
          '</a></h3>' +
          (excerpt ? '<p class="home-article-teaser-excerpt">' + escapeHtml(excerpt) + '</p>' : '') +
          '<a href="/articles/' +
          encodeURIComponent(slug) +
          '" class="btn btn-secondary" style="font-size:13px;padding:6px 12px;">Read more</a>' +
          '</article>';
      });
      mount.querySelector('.home-articles-grid').innerHTML = html;
    })
    .catch(function (err) {
      console.warn('home-articles', err);
      mount.style.display = 'none';
    });
})();

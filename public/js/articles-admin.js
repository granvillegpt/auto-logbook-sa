/**
 * Admin Articles tab — list + create/edit via /api/admin-dashboard
 * Featured image: Firebase Storage upload to articles/{slug}/{filename}
 */
(function () {
  'use strict';

  function slugifyTitle(t) {
    return String(t || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 200);
  }

  function getEls() {
    return {
      list: document.getElementById('articlesAdminList'),
      status: document.getElementById('articlesAdminStatus'),
      title: document.getElementById('articleFieldTitle'),
      slug: document.getElementById('articleFieldSlug'),
      originalSlug: document.getElementById('articleOriginalSlug'),
      featuredFile: document.getElementById('articleFeaturedFile'),
      featuredUrl: document.getElementById('articleFieldFeaturedUrl'),
      excerpt: document.getElementById('articleFieldExcerpt'),
      body: document.getElementById('articleFieldBody'),
      metaTitle: document.getElementById('articleFieldMetaTitle'),
      metaDesc: document.getElementById('articleFieldMetaDesc'),
      authorName: document.getElementById('articleFieldAuthorName'),
      published: document.getElementById('articleFieldPublished'),
      btnSave: document.getElementById('articleBtnSave'),
      btnNew: document.getElementById('articleBtnNew'),
      btnResanitize: document.getElementById('articleBtnResanitizeBodies'),
      previewWrap: document.getElementById('articleFeaturedPreviewWrap'),
      previewImg: document.getElementById('articleFeaturedPreviewImg')
    };
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /** True if body looks like a pasted full page (defensive; server still sanitises on save). */
  function bodyContainsDisallowedPageLayoutPaste(raw) {
    var s = String(raw || '');
    if (/<\s*header\b/i.test(s)) return true;
    if (/<\s*footer\b/i.test(s)) return true;
    if (/<\s*nav\b/i.test(s)) return true;
    if (/\bsite-header\b/i.test(s)) return true;
    if (/\bsite-footer\b/i.test(s)) return true;
    return false;
  }

  function setFeaturedPreview(url) {
    var el = getEls();
    if (!el.previewWrap || !el.previewImg) return;
    if (url && String(url).trim()) {
      el.previewImg.src = url;
      el.previewWrap.removeAttribute('hidden');
    } else {
      el.previewImg.removeAttribute('src');
      el.previewWrap.setAttribute('hidden', '');
    }
  }

  function safeImageFileName(originalName) {
    var base = String(originalName || 'image').replace(/^.*[/\\]/, '');
    base = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'image';
    return Date.now() + '-' + base;
  }

  function uploadFeaturedImage(file) {
    var el = getEls();
    var slug = (el.slug && el.slug.value.trim().toLowerCase()) || '';
    if (!slug) {
      alert('Enter a slug before uploading an image.');
      if (el.featuredFile) el.featuredFile.value = '';
      return;
    }
    if (typeof firebase === 'undefined' || !firebase.storage) {
      alert('Firebase Storage is not available.');
      return;
    }
    var fileName = safeImageFileName(file.name);
    var path = 'articles/' + slug + '/' + fileName;
    var ref = firebase.storage().ref(path);
    if (el.btnSave) el.btnSave.disabled = true;
    if (el.status) el.status.textContent = 'Uploading image…';
    ref
      .put(file)
      .then(function () {
        return ref.getDownloadURL();
      })
      .then(function (url) {
        if (el.featuredUrl) el.featuredUrl.value = url;
        setFeaturedPreview(url);
        if (el.status) el.status.textContent = 'Image uploaded. Save the article to persist.';
        if (el.featuredFile) el.featuredFile.value = '';
      })
      .catch(function (err) {
        console.error(err);
        alert(err.message || 'Image upload failed. Ensure you are logged in as admin.');
        if (el.featuredFile) el.featuredFile.value = '';
      })
      .finally(function () {
        if (el.btnSave) el.btnSave.disabled = false;
      });
  }

  function clearForm() {
    var el = getEls();
    if (el.originalSlug) el.originalSlug.value = '';
    if (el.title) el.title.value = '';
    if (el.slug) el.slug.value = '';
    if (el.featuredUrl) el.featuredUrl.value = '';
    if (el.featuredFile) el.featuredFile.value = '';
    setFeaturedPreview('');
    if (el.excerpt) el.excerpt.value = '';
    if (el.body) el.body.value = '';
    if (el.metaTitle) el.metaTitle.value = '';
    if (el.metaDesc) el.metaDesc.value = '';
    if (el.authorName) el.authorName.value = '';
    if (el.published) el.published.checked = false;
  }

  function fillForm(a) {
    var el = getEls();
    if (el.originalSlug) el.originalSlug.value = a.slug || a.id || '';
    if (el.title) el.title.value = a.title || '';
    if (el.slug) el.slug.value = a.slug || a.id || '';
    var url = (a.featuredImageUrl && String(a.featuredImageUrl).trim()) || '';
    if (el.featuredUrl) el.featuredUrl.value = url;
    if (el.featuredFile) el.featuredFile.value = '';
    setFeaturedPreview(url);
    if (el.excerpt) el.excerpt.value = a.excerpt || '';
    if (el.body) el.body.value = a.body || '';
    if (el.metaTitle) el.metaTitle.value = a.metaTitle || '';
    if (el.metaDesc) el.metaDesc.value = a.metaDescription || '';
    if (el.authorName) el.authorName.value = a.authorName || '';
    if (el.published) el.published.checked = !!a.published;
  }

  function renderList(articles) {
    var el = getEls();
    if (!el.list) return;
    if (!articles || !articles.length) {
      el.list.innerHTML = '<p class="admin-empty">No articles yet.</p>';
      return;
    }
    var rows = articles
      .map(function (a) {
        var slug = escapeHtml(a.slug || a.id);
        var title = escapeHtml(a.title || slug);
        var pub = a.published ? '<span class="status-badge approved">Published</span>' : '<span class="status-badge pending">Draft</span>';
        return (
          '<tr data-slug="' +
          escapeHtml(a.slug || a.id) +
          '">' +
          '<td>' +
          title +
          '</td>' +
          '<td><code>' +
          slug +
          '</code></td>' +
          '<td>' +
          pub +
          '</td>' +
          '<td><button type="button" class="btn btn-secondary article-edit-btn" data-slug="' +
          escapeHtml(a.slug || a.id) +
          '">Edit</button></td>' +
          '</tr>'
        );
      })
      .join('');
    el.list.innerHTML =
      '<table class="admin-articles-table"><thead><tr><th>Title</th><th>Slug</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows +
      '</tbody></table>';
    el.list.querySelectorAll('.article-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = btn.getAttribute('data-slug');
        var found = articles.filter(function (x) {
          return (x.slug || x.id) === s;
        })[0];
        if (found) fillForm(found);
      });
    });
  }

  window.loadArticlesAdmin = function () {
    var el = getEls();
    if (el.status) el.status.textContent = 'Loading…';
    if (typeof window.adminGet !== 'function') {
      if (el.status) el.status.textContent = 'Admin API not ready.';
      return;
    }
    window
      .adminGet({ action: 'articlesAdmin' })
      .then(function (data) {
        var articles = data.articles || [];
        renderList(articles);
        if (el.status) el.status.textContent = '';
      })
      .catch(function (err) {
        console.error(err);
        if (el.status) el.status.textContent = err.message || 'Failed to load';
        if (el.list) el.list.innerHTML = '';
      });
  };

  function wireForm() {
    var el = getEls();
    if (el.btnNew) {
      el.btnNew.addEventListener('click', function () {
        clearForm();
        if (el.status) el.status.textContent = 'New article — fill in and save.';
      });
    }
    if (el.featuredFile) {
      el.featuredFile.addEventListener('change', function () {
        var f = el.featuredFile.files && el.featuredFile.files[0];
        if (!f) return;
        if (!/^image\//.test(f.type)) {
          alert('Please choose an image file.');
          el.featuredFile.value = '';
          return;
        }
        uploadFeaturedImage(f);
      });
    }
    if (el.title && el.slug) {
      el.title.addEventListener('blur', function () {
        if (!el.originalSlug || !el.originalSlug.value) {
          if (!el.slug.value.trim()) el.slug.value = slugifyTitle(el.title.value);
        }
      });
    }
    if (el.btnResanitize && typeof window.adminPost === 'function') {
      el.btnResanitize.addEventListener('click', function () {
        if (
          !confirm(
            'Strip page-level layout HTML from every saved article body in Firestore? This cannot be undone (except from backups).'
          )
        ) {
          return;
        }
        el.btnResanitize.disabled = true;
        if (el.status) el.status.textContent = 'Sanitising all article bodies…';
        window
          .adminPost({ action: 'resanitizeArticleBodies' })
          .then(function (data) {
            var n = (data && data.updatedCount) || 0;
            var slugs = (data && data.updatedSlugs) || [];
            if (el.status) {
              el.status.textContent =
                n === 0
                  ? 'No articles needed changes.'
                  : 'Updated ' + n + ' article(s): ' + slugs.join(', ');
            }
            window.loadArticlesAdmin();
          })
          .catch(function (err) {
            console.error(err);
            alert(err.message || 'Resanitize failed');
            if (el.status) el.status.textContent = '';
          })
          .finally(function () {
            el.btnResanitize.disabled = false;
          });
      });
    }
    if (el.btnSave) {
      el.btnSave.addEventListener('click', function () {
        if (typeof window.adminPost !== 'function') return;
        var title = (el.title && el.title.value.trim()) || '';
        var slug = (el.slug && el.slug.value.trim().toLowerCase()) || '';
        var originalSlug = (el.originalSlug && el.originalSlug.value.trim().toLowerCase()) || '';
        if (!title || !slug) {
          alert('Title and slug are required.');
          return;
        }
        var bodyRaw = (el.body && el.body.value) || '';
        if (bodyContainsDisallowedPageLayoutPaste(bodyRaw)) {
          alert('Please paste article content only, not full page HTML.');
          return;
        }
        el.btnSave.disabled = true;
        if (el.status) el.status.textContent = 'Saving…';
        var payload = {
          action: 'upsertArticle',
          title: title,
          slug: slug,
          featuredImageUrl: (el.featuredUrl && el.featuredUrl.value.trim()) || '',
          excerpt: (el.excerpt && el.excerpt.value) || '',
          body: bodyRaw,
          metaTitle: (el.metaTitle && el.metaTitle.value.trim()) || '',
          metaDescription: (el.metaDesc && el.metaDesc.value.trim()) || '',
          published: !!(el.published && el.published.checked),
          authorName: (el.authorName && el.authorName.value.trim()) || ''
        };
        if (originalSlug && originalSlug !== slug) {
          payload.originalSlug = originalSlug;
        }
        window
          .adminPost(payload)
          .then(function (data) {
            if (el.status) el.status.textContent = 'Saved.';
            if (data && data.slug) {
              if (el.originalSlug) el.originalSlug.value = data.slug;
              if (el.slug) el.slug.value = data.slug;
            }
            window.loadArticlesAdmin();
          })
          .catch(function (err) {
            alert(err.message || 'Save failed');
            if (el.status) el.status.textContent = '';
          })
          .finally(function () {
            el.btnSave.disabled = false;
          });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireForm);
  } else {
    wireForm();
  }
})();

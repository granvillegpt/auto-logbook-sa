/**
 * Load ClearTrack logbook UI into #logbook, then initialize controller.
 */
(async function () {
  const container = document.getElementById('logbook');
  if (!container) return;

  const res = await fetch('ui/logbook.html', { cache: 'no-store' });
  if (!res.ok) {
    container.innerHTML = '<p style="padding:20px;color:red;">Failed to load logbook UI (HTTP ' + res.status + ').</p>';
    return;
  }

  const html = await res.text();
  container.innerHTML = html;

  const m = await import('./logbook.js');
  if (typeof m.init === 'function') {
    m.init();
  }
})();

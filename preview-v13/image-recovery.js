(() => {
  'use strict';

  const ATLAS = 'https://api.atlascloud.ai';
  const jobs = new Map();
  const objectUrls = new Map();
  let scanTimer = 0, reloadTimer = 0;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const api = () => window.seedream;
  const atlasKey = () => localStorage.getItem('seedream-atlas-api-key') || '';

  async function waitForApp() {
    for (let i = 0; i < 80; i++) {
      if (api()?.dbAll && api()?.dbUpdate) return api();
      await sleep(100);
    }
    return null;
  }

  function outputIndex(item) {
    if (Number.isInteger(item?.outputIndex)) return item.outputIndex;
    const task = String(item?.taskId || '');
    const id = String(item?.id || '');
    if (!task || id === task) return 0;
    const m = id.match(new RegExp('^' + task.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$'));
    return m ? Number(m[1]) || 0 : 0;
  }

  function refreshAppState() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => api()?.loadData?.().catch?.(() => {}), 250);
  }

  async function fetchPrediction(item) {
    const key = atlasKey();
    if (!key || !item?.taskId) return '';
    const r = await fetch(`${ATLAS}/api/v1/model/prediction/${encodeURIComponent(item.taskId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store'
    });
    if (!r.ok) throw new Error(`prediction ${r.status}`);
    const raw = await r.json();
    const d = raw?.data ?? raw;
    const outputs = Array.isArray(d?.outputs) ? d.outputs : [];
    const next = outputs[outputIndex(item)] || outputs[0] || '';
    return typeof next === 'string' ? next : '';
  }

  async function blobFrom(url) {
    if (!url) throw new Error('no url');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const r = await fetch(url, { signal: controller.signal, cache: 'no-store', mode: 'cors' });
      if (!r.ok) throw new Error(`image ${r.status}`);
      const blob = await r.blob();
      if (!blob.size || !String(blob.type || '').startsWith('image/')) throw new Error('invalid image blob');
      return blob;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getRecord(store, id) {
    const list = await api().dbAll(store);
    return list.find(x => String(x.id) === String(id)) || null;
  }

  function setObjectUrl(img, item) {
    if (!img || !item?.blob) return false;
    const key = String(item.id);
    const old = objectUrls.get(key);
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(item.blob);
    objectUrls.set(key, url);
    img.src = url;
    img.dataset.fullSrc = url;
    return true;
  }

  async function saveRecord(store, item) {
    const key = `${store}:${item.id}`;
    if (jobs.has(key)) return jobs.get(key);
    const job = (async () => {
      let current = item;
      if (current.blob) return current;

      let url = current.url || '';
      let blob = null;
      try { blob = await blobFrom(url); } catch {}

      if (!blob && current.taskId) {
        try {
          const fresh = await fetchPrediction(current);
          if (fresh) {
            url = fresh;
            current = await api().dbUpdate(store, current.id, old => ({ ...old, url: fresh, outputIndex: outputIndex(current) })) || { ...current, url: fresh };
            refreshAppState();
            try { blob = await blobFrom(fresh); } catch {}
          }
        } catch {}
      }

      if (blob) {
        current = await api().dbUpdate(store, current.id, old => ({ ...old, url, blob, outputIndex: outputIndex(current) })) || { ...current, blob, url };
        refreshAppState();
      }
      return current;
    })().finally(() => jobs.delete(key));
    jobs.set(key, job);
    return job;
  }

  async function locate(img) {
    const card = img.closest?.('.media-card');
    if (card?.dataset?.id) {
      const id = card.dataset.id;
      let item = await getRecord('history', id);
      if (item) return { store: 'history', item };
      item = await getRecord('album', id);
      if (item) return { store: 'album', item };
    }

    if (img.id === 'resultImage' || img.id === 'lightboxImage') {
      const src = img.dataset.fullSrc || img.currentSrc || img.src || '';
      for (const store of ['history', 'album']) {
        const list = await api().dbAll(store);
        const item = list.find(x => x.url && (
          x.url === src ||
          (x.id && src.includes(encodeURIComponent(String(x.id)))) ||
          (x.taskId && src.includes(String(x.taskId)))
        ));
        if (item) return { store, item };
      }
    }
    return null;
  }

  async function recoverImage(img) {
    if (!img || img.dataset.recovering === '1') return;
    img.dataset.recovering = '1';
    try {
      const found = await locate(img);
      if (!found) return;
      const { store, item } = found;

      if (item.blob) {
        setObjectUrl(img, item);
        return;
      }

      const recovered = await saveRecord(store, item);
      if (recovered?.blob) {
        setObjectUrl(img, recovered);
        return;
      }

      // A refreshed Atlas task URL can still be displayed even when CORS blocks blob saving.
      const retryUrl = recovered?.url || item.url || '';
      if (retryUrl) {
        await sleep(500);
        img.removeAttribute('src');
        await sleep(30);
        img.src = retryUrl;
        img.dataset.fullSrc = retryUrl;
      }
    } finally {
      setTimeout(() => { delete img.dataset.recovering; }, 1400);
    }
  }

  async function persistUnsaved() {
    if (document.hidden || !navigator.onLine) return;
    const app = api();
    if (!app?.dbAll) return;
    for (const store of ['history', 'album']) {
      const list = await app.dbAll(store);
      const pending = list.filter(x => !x.blob && x.url).slice(0, 8);
      for (const item of pending) {
        try { await saveRecord(store, item); } catch {}
      }
    }
  }

  function scheduleScan(delay = 250) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      persistUnsaved().catch(() => {});
      document.querySelectorAll('#resultImage,#historyGrid img,#albumGrid img,#lightboxImage').forEach(img => {
        if (!img.classList.contains('hidden') && img.complete && !img.naturalWidth) recoverImage(img).catch(() => {});
      });
    }, delay);
  }

  document.addEventListener('error', e => {
    if (e.target instanceof HTMLImageElement) recoverImage(e.target).catch(() => {});
  }, true);

  document.addEventListener('load', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.closest?.('#historyGrid,#albumGrid') || img.id === 'resultImage') scheduleScan(400);
  }, true);

  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleScan(100); });
  window.addEventListener('pageshow', () => scheduleScan(100));
  window.addEventListener('online', () => scheduleScan(100));

  const observer = new MutationObserver(() => scheduleScan(150));

  (async () => {
    const app = await waitForApp();
    if (!app) return;
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleScan(50);
    setInterval(() => { if (!document.hidden) scheduleScan(0); }, 20000);
  })();
})();

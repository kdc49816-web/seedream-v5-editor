(() => {
  'use strict';

  const ATLAS = 'https://api.atlascloud.ai';
  const jobs = new Map();
  const objectUrls = new Map();
  const retryAfter = new Map();
  let scanTimer = 0;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const api = () => window.seedream;
  const atlasKey = () => localStorage.getItem('seedream-atlas-api-key') || '';

  const style = document.createElement('style');
  style.textContent = `
    #historyGrid .media-card,#albumGrid .media-card{position:relative}
    #historyGrid .media-thumb.seedream-img-failed,#albumGrid .media-thumb.seedream-img-failed{opacity:0!important}
    #historyGrid .media-card:has(.seedream-img-failed)::before,
    #albumGrid .media-card:has(.seedream-img-failed)::before{
      content:'图片恢复中…';position:absolute;left:0;right:0;top:0;height:var(--thumb-h,72%);
      display:grid;place-items:center;color:#717773;font-size:12px;pointer-events:none;z-index:0
    }
  `;
  document.head.appendChild(style);

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
    const escaped = task.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = id.match(new RegExp('^' + escaped + '-(\\d+)$'));
    return m ? Number(m[1]) || 0 : 0;
  }

  async function fetchPrediction(item) {
    const key = atlasKey();
    if (!key || !item?.taskId) return '';
    const r = await fetch(`${ATLAS}/api/v1/model/prediction/${encodeURIComponent(item.taskId)}`, {
      headers: { Authorization: `Bearer ${key}` }, cache: 'no-store'
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
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch(url, { signal: controller.signal, cache: 'no-store', mode: 'cors' });
      if (!r.ok) throw new Error(`image ${r.status}`);
      const blob = await r.blob();
      if (!blob.size || !String(blob.type || '').startsWith('image/')) throw new Error('invalid image blob');
      return blob;
    } finally { clearTimeout(timer); }
  }

  function preload(src, timeout = 18000) {
    return new Promise(resolve => {
      if (!src) return resolve(false);
      const test = new Image();
      let done = false;
      const finish = ok => { if (done) return; done = true; clearTimeout(timer); test.onload = test.onerror = null; resolve(ok); };
      const timer = setTimeout(() => finish(false), timeout);
      test.onload = () => finish(!!test.naturalWidth);
      test.onerror = () => finish(false);
      test.src = src;
      if (test.complete) queueMicrotask(() => finish(!!test.naturalWidth));
    });
  }

  async function getRecord(store, id) {
    const list = await api().dbAll(store);
    return list.find(x => String(x.id) === String(id)) || null;
  }

  function objectUrl(item) {
    if (!item?.blob) return '';
    const key = String(item.id);
    const existing = objectUrls.get(key);
    if (existing?.blob === item.blob) return existing.url;
    if (existing) URL.revokeObjectURL(existing.url);
    const url = URL.createObjectURL(item.blob);
    objectUrls.set(key, { blob: item.blob, url });
    return url;
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
            try { blob = await blobFrom(fresh); } catch {}
          }
        } catch {}
      }

      if (blob) {
        current = await api().dbUpdate(store, current.id, old => ({ ...old, url, blob, outputIndex: outputIndex(current) })) || { ...current, blob, url };
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
    return null;
  }

  async function swapWhenReady(img, src) {
    if (!img?.isConnected || !src) return false;
    const ok = await preload(src);
    if (!ok || !img.isConnected) return false;
    img.src = src;
    img.dataset.fullSrc = src;
    img.classList.remove('seedream-img-failed');
    return true;
  }

  async function recoverImage(img, force = false) {
    if (!img || img.dataset.recovering === '1') return;
    const found = await locate(img);
    if (!found) return;
    const key = `${found.store}:${found.item.id}`;
    const now = Date.now();
    if (!force && (retryAfter.get(key) || 0) > now) return;
    retryAfter.set(key, now + 45000);
    img.dataset.recovering = '1';
    img.classList.add('seedream-img-failed');

    try {
      let item = found.item;
      if (item.blob) {
        await swapWhenReady(img, objectUrl(item));
        return;
      }

      item = await saveRecord(found.store, item);
      if (item?.blob && await swapWhenReady(img, objectUrl(item))) return;

      const fresh = item?.url || '';
      if (fresh && await swapWhenReady(img, fresh)) return;

      // Keep one stable placeholder. Do not repeatedly clear/reassign src: that was the source of the flashing.
      img.classList.add('seedream-img-failed');
    } finally {
      delete img.dataset.recovering;
    }
  }

  async function persistUnsaved() {
    if (document.hidden || !navigator.onLine) return;
    const app = api();
    if (!app?.dbAll) return;
    for (const store of ['history', 'album']) {
      const list = await app.dbAll(store);
      for (const item of list.filter(x => !x.blob && x.url).slice(0, 6)) {
        const key = `${store}:${item.id}`;
        if ((retryAfter.get(key) || 0) > Date.now()) continue;
        retryAfter.set(key, Date.now() + 45000);
        try { await saveRecord(store, item); } catch {}
      }
    }
  }

  function scanFailed(force = false) {
    document.querySelectorAll('#historyGrid img,#albumGrid img').forEach(img => {
      if (img.complete && !img.naturalWidth) recoverImage(img, force).catch(() => {});
    });
  }

  function scheduleScan(delay = 250, force = false) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanFailed(force);
      persistUnsaved().catch(() => {});
    }, delay);
  }

  document.addEventListener('error', e => {
    if (e.target instanceof HTMLImageElement && e.target.closest?.('#historyGrid,#albumGrid')) {
      recoverImage(e.target).catch(() => {});
    }
  }, true);

  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleScan(200, true); });
  window.addEventListener('pageshow', () => scheduleScan(200, true));
  window.addEventListener('online', () => scheduleScan(200, true));

  (async () => {
    if (!await waitForApp()) return;
    scheduleScan(80, true);
    // Background persistence only. No DOM rerender loop and no repeated src toggling.
    setInterval(() => { if (!document.hidden) persistUnsaved().catch(() => {}); }, 60000);
  })();
})();

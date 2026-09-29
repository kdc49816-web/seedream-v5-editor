(() => {
  'use strict';

  const ATLAS = 'https://api.atlascloud.ai';
  const jobs = new Map();
  const objectUrls = new Map();
  const uiRetryAfter = new Map();
  const persistRetryAfter = new Map();
  let scanTimer = 0;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const api = () => window.seedream;
  const atlasKey = () => localStorage.getItem('seedream-atlas-api-key') || '';

  const style = document.createElement('style');
  style.id = 'seedream-image-recovery-v40';
  style.textContent = `
    #historyGrid .media-card,#albumGrid .media-card{position:relative}
    #historyGrid .media-card.seedream-recovering::before,
    #albumGrid .media-card.seedream-recovering::before{
      content:'正在恢复图片…';position:absolute;left:0;right:0;top:0;height:68%;
      display:grid;place-items:center;color:#717773;font-size:12px;pointer-events:none;z-index:0
    }
    #historyGrid .media-card.seedream-unavailable::before,
    #albumGrid .media-card.seedream-unavailable::before{
      content:'图片暂时加载失败 · 点一下重试';position:absolute;left:0;right:0;top:0;height:68%;
      display:grid;place-items:center;color:#8a908c;font-size:12px;pointer-events:none;z-index:0
    }
    #historyGrid .media-thumb.seedream-img-failed,
    #albumGrid .media-thumb.seedream-img-failed{opacity:0!important}
  `;
  document.head.appendChild(style);

  async function waitForApp() {
    for (let i = 0; i < 100; i++) {
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

  async function fetchPrediction(item, timeout = 12000) {
    const key = atlasKey();
    if (!key || !item?.taskId) return '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const r = await fetch(`${ATLAS}/api/v1/model/prediction/${encodeURIComponent(item.taskId)}`, {
        headers: { Authorization: `Bearer ${key}` }, cache: 'no-store', signal: controller.signal
      });
      if (!r.ok) throw new Error(`prediction ${r.status}`);
      const raw = await r.json();
      const d = raw?.data ?? raw;
      const outputs = Array.isArray(d?.outputs) ? d.outputs : [];
      const next = outputs[outputIndex(item)] || outputs[0] || '';
      return typeof next === 'string' ? next : '';
    } finally { clearTimeout(timer); }
  }

  async function blobFrom(url, timeout = 12000) {
    if (!url) throw new Error('no url');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const r = await fetch(url, { signal: controller.signal, cache: 'default', mode: 'cors' });
      if (!r.ok) throw new Error(`image ${r.status}`);
      const blob = await r.blob();
      if (!blob.size || !String(blob.type || '').startsWith('image/')) throw new Error('invalid image blob');
      return blob;
    } finally { clearTimeout(timer); }
  }

  function preload(src, timeout = 10000) {
    return new Promise(resolve => {
      if (!src) return resolve(false);
      const test = new Image();
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        test.onload = test.onerror = null;
        resolve(ok);
      };
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

  async function locate(img) {
    const card = img.closest?.('.media-card');
    if (!card?.dataset?.id) return null;
    const id = card.dataset.id;
    let item = await getRecord('history', id);
    if (item) return { store: 'history', item, card };
    item = await getRecord('album', id);
    if (item) return { store: 'album', item, card };
    return null;
  }

  function showImage(img, src) {
    if (!img?.isConnected || !src) return;
    img.src = src;
    img.dataset.fullSrc = src;
    img.classList.remove('seedream-img-failed');
    const card = img.closest?.('.media-card');
    card?.classList.remove('seedream-recovering','seedream-unavailable');
  }

  async function swapWhenReady(img, src) {
    if (!img?.isConnected || !src) return false;
    if (!await preload(src)) return false;
    if (!img.isConnected) return false;
    showImage(img, src);
    return true;
  }

  async function saveBlob(store, item, url) {
    const key = `${store}:${item.id}`;
    if (jobs.has(key)) return jobs.get(key);
    const job = (async () => {
      const blob = await blobFrom(url);
      return await api().dbUpdate(store, item.id, old => ({ ...old, url, blob, outputIndex: outputIndex(item) })) || { ...item, url, blob };
    })().finally(() => jobs.delete(key));
    jobs.set(key, job);
    return job;
  }

  function persistInBackground(store, item, url) {
    const key = `${store}:${item.id}`;
    if ((persistRetryAfter.get(key) || 0) > Date.now()) return;
    persistRetryAfter.set(key, Date.now() + 30000);
    saveBlob(store, item, url).catch(() => {});
  }

  async function recoverImage(img, force = false) {
    if (!img || img.dataset.recovering === '1') return;
    const found = await locate(img);
    if (!found) return;

    const { store, card } = found;
    let item = found.item;
    const key = `${store}:${item.id}`;
    const now = Date.now();
    if (!force && (uiRetryAfter.get(key) || 0) > now) return;
    uiRetryAfter.set(key, now + 15000);
    img.dataset.recovering = '1';
    card?.classList.add('seedream-recovering');
    card?.classList.remove('seedream-unavailable');

    try {
      // Best case: a permanent local copy already exists. Never touch the network.
      if (item.blob) {
        const src = objectUrl(item);
        if (await swapWhenReady(img, src)) return;
      }

      // For old generated records, ask Atlas for the task output FIRST.
      // This avoids sitting on an expired signed URL for 20-40 seconds.
      let fresh = '';
      if (item.taskId) {
        try { fresh = await fetchPrediction(item, 9000); } catch {}
        if (fresh) {
          try {
            item = await api().dbUpdate(store, item.id, old => ({ ...old, url: fresh, outputIndex: outputIndex(item) })) || { ...item, url: fresh };
          } catch { item = { ...item, url: fresh }; }
          if (await swapWhenReady(img, fresh)) {
            persistInBackground(store, item, fresh);
            return;
          }
        }
      }

      // Fall back to the original URL. preload uses the normal image cache,
      // so an image Safari still has cached remains recoverable.
      const original = item.url || found.item.url || '';
      if (original && await swapWhenReady(img, original)) {
        persistInBackground(store, item, original);
        return;
      }

      // Only hide the broken-image glyph after every recovery path failed.
      img.classList.add('seedream-img-failed');
      card?.classList.remove('seedream-recovering');
      card?.classList.add('seedream-unavailable');
    } finally {
      card?.classList.remove('seedream-recovering');
      delete img.dataset.recovering;
    }
  }

  async function persistLoadedImage(img) {
    const found = await locate(img);
    if (!found || found.item.blob) return;
    const src = img.currentSrc || img.src || found.item.url || '';
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;
    persistInBackground(found.store, found.item, src);
  }

  async function persistUnsaved() {
    if (document.hidden || !navigator.onLine) return;
    const app = api();
    if (!app?.dbAll) return;
    for (const store of ['history','album']) {
      const list = await app.dbAll(store);
      const pending = list.filter(x => !x.blob && x.url).slice(0, 2);
      await Promise.all(pending.map(async item => {
        const key = `${store}:${item.id}`;
        if ((persistRetryAfter.get(key) || 0) > Date.now()) return;
        persistRetryAfter.set(key, Date.now() + 45000);
        let url = item.url;
        if (item.taskId) {
          try { url = await fetchPrediction(item, 7000) || url; } catch {}
        }
        if (!url) return;
        try { await saveBlob(store, item, url); } catch {}
      }));
    }
  }

  function scanFailed(force = false) {
    document.querySelectorAll('#historyGrid img,#albumGrid img').forEach(img => {
      if (img.naturalWidth > 0) {
        img.classList.remove('seedream-img-failed');
        img.closest?.('.media-card')?.classList.remove('seedream-recovering','seedream-unavailable');
        return;
      }
      if (img.complete) recoverImage(img, force).catch(() => {});
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
      recoverImage(e.target, true).catch(() => {});
    }
  }, true);

  document.addEventListener('load', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.closest?.('#historyGrid,#albumGrid')) return;
    img.classList.remove('seedream-img-failed');
    img.closest('.media-card')?.classList.remove('seedream-recovering','seedream-unavailable');
    persistLoadedImage(img).catch(() => {});
  }, true);

  // Tap a failed card's image area to force one immediate retry.
  document.addEventListener('click', e => {
    const card = e.target.closest?.('.media-card.seedream-unavailable');
    if (!card || !(card.closest('#historyGrid') || card.closest('#albumGrid'))) return;
    const img = card.querySelector('img');
    if (img) recoverImage(img, true).catch(() => {});
  }, true);

  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleScan(250, true); });
  window.addEventListener('pageshow', () => scheduleScan(250, true));
  window.addEventListener('online', () => scheduleScan(250, true));

  (async () => {
    if (!await waitForApp()) return;
    // Important: first preserve everything that is already visible. Recovery only touches failed images.
    document.querySelectorAll('#historyGrid img,#albumGrid img').forEach(img => {
      if (img.naturalWidth > 0) persistLoadedImage(img).catch(() => {});
    });
    scheduleScan(300, false);
    setInterval(() => { if (!document.hidden) persistUnsaved().catch(() => {}); }, 90000);
  })();
})();

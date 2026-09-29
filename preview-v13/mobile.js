(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isFormControlFocused = () => document.activeElement?.matches?.('input,textarea,select');

  if (standalone) root.classList.add('seedream-standalone');

  const style = document.createElement('style');
  style.id = 'studio-mobile-fix-v34';
  style.textContent = `
    html,body{background:#090a0b!important}
    @media(max-width:720px){
      main{padding-bottom:12px!important}
      .tabs{margin-bottom:0!important}
      #albumStackView:has(#albumStackDeck > .empty-state) .stack-topline,
      #albumStackView:has(#albumStackDeck > .empty-state) .stack-nav{display:none!important}
      #albumStackView .stack-viewport:has(#albumStackDeck > .empty-state){height:168px!important;min-height:168px!important;max-height:168px!important}
      #albumStackDeck > .empty-state{height:100%!important;min-height:0!important;border:0!important;border-radius:16px!important;background:#101213!important}
    }
    html.seedream-standalone,
    html.seedream-standalone body{
      position:fixed!important;
      inset:0!important;
      width:100%!important;
      height:100%!important;
      min-height:0!important;
      max-height:none!important;
      overflow:hidden!important;
      overscroll-behavior:none!important;
    }
    html.seedream-standalone .app-shell{
      position:fixed!important;
      inset:0!important;
      width:100%!important;
      height:auto!important;
      min-height:0!important;
      max-height:none!important;
      padding-bottom:0!important;
      margin:0!important;
      grid-template-rows:auto minmax(0,1fr) auto!important;
    }
    html.seedream-standalone .topbar{grid-row:1!important}
    html.seedream-standalone main{grid-row:2!important;min-height:0!important;overflow-y:auto!important}
    html.seedream-standalone .tabs{
      grid-row:3!important;
      position:relative!important;
      bottom:auto!important;
      padding-bottom:calc(8px + env(safe-area-inset-bottom))!important;
      background:#0c0e0f!important;
    }
  `;
  document.head.appendChild(style);

  const applyHeight = () => {
    if (standalone) {
      root.style.removeProperty('--app-height');
      return;
    }
    const inner = window.innerHeight || root.clientHeight || 0;
    const visual = viewport?.height || inner;
    const keyboardOpen = !!isFormControlFocused() && inner - visual > 120;
    root.style.setProperty('--app-height', keyboardOpen ? `${Math.round(visual)}px` : '100dvh');
    if (!keyboardOpen) window.scrollTo(0, 0);
  };

  applyHeight();
  viewport?.addEventListener('resize', applyHeight);
  window.addEventListener('resize', applyHeight);
  window.addEventListener('orientationchange', () => setTimeout(applyHeight, 180));
  window.addEventListener('pageshow', applyHeight);
  document.addEventListener('focusin', e => {
    if (e.target.matches('input,textarea,select')) {
      setTimeout(() => e.target.scrollIntoView({ block:'nearest', behavior:'smooth' }), 220);
    }
  });

  // GitHub Pages cannot host the account backend. The previous button opened
  // chatgpt.site, which can be blocked by Cloudflare on iOS. In the installed
  // GitHub app we keep account switching fully local, so login never leaves app.
  if (location.hostname.endsWith('github.io')) {
    const USERS_KEY = 'seedream-local-users-v2';
    const ACTIVE_KEY = 'seedream-account-id';

    const readUsers = () => {
      try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}') || {}; }
      catch { return {}; }
    };
    const writeUsers = users => localStorage.setItem(USERS_KEY, JSON.stringify(users));
    const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
    const digest = async text => {
      if (crypto?.subtle) return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
      let h = 2166136261;
      for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16).padStart(8,'0');
    };
    const toast = msg => window.seedream?.toast ? window.seedream.toast(msg) : (() => {
      const el = $('#toast'); if (!el) return; el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2200);
    })();

    function currentLocalUser() {
      const id = localStorage.getItem(ACTIVE_KEY) || '';
      const users = readUsers();
      return Object.values(users).find(x => x.id === id) || null;
    }

    function renderLocalAccount() {
      const user = currentLocalUser();
      const active = !!user;
      $('#accountBtn').textContent = active ? '相册账号' : '登录';
      $('#accountTitle').textContent = active ? user.username : '登录相册';
      $('#accountFields')?.classList.toggle('hidden', active);
      $('#loginBtn')?.classList.toggle('hidden', active);
      $('#registerBtn')?.classList.toggle('hidden', active);
      $('#logoutBtn')?.classList.toggle('hidden', !active);
      $('#syncBtn')?.classList.add('hidden');
      if ($('#syncStatus')) $('#syncStatus').textContent = active
        ? `已登录 ${user.username}。相册保存在这台设备，不会再跳转外部登录页。`
        : '登录只在当前设备内完成，不再跳转到会被拦截的外部页面。';
    }

    async function copyGuestAlbum(targetId) {
      const open = name => new Promise((resolve,reject) => {
        const r = indexedDB.open(name,1);
        r.onupgradeneeded = () => {
          for (const s of ['history','album']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s,{keyPath:'id'});
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const all = async (db, store) => new Promise((resolve,reject) => {
        const tx = db.transaction(store,'readonly'), req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
      });
      const putMany = async (db, store, items) => new Promise((resolve,reject) => {
        const tx = db.transaction(store,'readwrite'), os = tx.objectStore(store);
        items.forEach(x => os.put(x)); tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
      });
      try {
        const guest = await open('seedream-studio-db');
        const target = await open('seedream-studio-db-' + targetId);
        const existing = await all(target,'album');
        if (!existing.length) {
          const items = await all(guest,'album');
          if (items.length) await putMany(target,'album',items);
        }
        guest.close(); target.close();
      } catch {}
    }

    async function localAuth(action) {
      const username = ($('#username')?.value || '').trim();
      const password = $('#password')?.value || '';
      if (username.length < 3) { toast('账号至少 3 个字符'); return; }
      if (password.length < 8) { toast('密码至少 8 位'); return; }
      const key = username.toLowerCase();
      const users = readUsers();
      const id = 'local-' + (await digest('seedream-account:' + key)).slice(0,20);
      const passwordHash = await digest('seedream-password:' + key + ':' + password);

      if (action === 'register') {
        if (users[key]) { toast('这个账号已经注册过了'); return; }
        users[key] = { id, username, passwordHash };
        writeUsers(users);
      } else {
        if (!users[key]) { toast('账号不存在，可以先点注册'); return; }
        if (users[key].passwordHash !== passwordHash) { toast('密码不对'); return; }
      }

      await copyGuestAlbum(id);
      localStorage.setItem(ACTIVE_KEY, id);
      if ($('#password')) $('#password').value = '';
      toast(action === 'register' ? '注册成功' : '登录成功');
      setTimeout(() => location.reload(), 180);
    }

    const openAccount = e => {
      e?.preventDefault?.();
      e?.stopImmediatePropagation?.();
      renderLocalAccount();
      const dlg = $('#accountModal');
      if (dlg && !dlg.open) dlg.showModal();
    };

    $('#accountBtn')?.addEventListener('click', openAccount, true);
    $('#backupSettingsBtn')?.addEventListener('click', e => { $('#apiModal')?.close(); openAccount(e); }, true);
    $('#accountForm')?.addEventListener('submit', e => { e.preventDefault(); e.stopImmediatePropagation(); localAuth('login'); }, true);
    $('#registerBtn')?.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); localAuth('register'); }, true);
    $('#logoutBtn')?.addEventListener('click', e => {
      e.preventDefault(); e.stopImmediatePropagation();
      localStorage.removeItem(ACTIVE_KEY);
      toast('已退出登录');
      setTimeout(() => location.reload(), 150);
    }, true);
    $('#syncBtn')?.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
    renderLocalAccount();
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=34').catch(() => {});
})();

const CACHE='seedream-shell-35';
const SHELL=['./','./index.html','./styles.css?v=30','./app.js?v=30','./album-card.js?v=30','./sync.js?v=30','./mobile.js?v=35','./sd-icon-180-v32.png','./manifest.webmanifest?v=34'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('seedream-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url),base=new URL('./',self.location);
  if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.includes('/api/')||!u.pathname.startsWith(base.pathname))return;
  let target=e.request.url;
  if(u.pathname.endsWith('/mobile.js')) target=new URL('./mobile.js?v=35',base).href;
  if(u.pathname.endsWith('/manifest.webmanifest')) target=new URL('./manifest.webmanifest?v=34',base).href;
  const req=new Request(target,{method:'GET',headers:e.request.headers,mode:e.request.mode,credentials:e.request.credentials,redirect:'follow',cache:'no-store'});
  e.respondWith(fetch(req).then(r=>{
    if(r.ok&&r.type!=='opaqueredirect'){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}
    return r;
  }).catch(()=>caches.match(e.request).then(r=>r||Response.error())));
});

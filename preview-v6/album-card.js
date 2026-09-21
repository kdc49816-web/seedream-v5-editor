(()=>{
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const DB_NAME='seedream-studio-db', DB_VERSION=1;
const mod=(n,m)=>((n%m)+m)%m;
let view='grid',items=[],index=0,els=null,animating=false,active=false,sx=0,sy=0,dx=0,dy=0,moved=false,startTime=0,raf=0,pending=null,lastTap=0;
const urls=new Map();

function srcFor(item){
  if(!item)return '';
  if(item.blob){
    if(urls.has(item.id))return urls.get(item.id);
    const u=URL.createObjectURL(item.blob);urls.set(item.id,u);return u;
  }
  return item.url||item.dataUrl||'';
}
function cleanupUrls(){
  const ids=new Set(items.map(x=>x.id));
  for(const [id,u] of urls)if(!ids.has(id)){URL.revokeObjectURL(u);urls.delete(id)}
}
function readAlbum(){
  return new Promise(resolve=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onerror=()=>resolve({ok:false,error:String(req.error||'IndexedDB 打开失败'),items:[]});
    req.onupgradeneeded=()=>{};
    req.onsuccess=()=>{
      try{
        const db=req.result;
        if(!db.objectStoreNames.contains('album')){resolve({ok:false,error:'没有找到 album 数据表',items:[]});return}
        const tx=db.transaction('album','readonly');
        const q=tx.objectStore('album').getAll();
        q.onsuccess=()=>resolve({ok:true,items:(q.result||[]).sort((a,b)=>(a.order??0)-(b.order??0))});
        q.onerror=()=>resolve({ok:false,error:String(q.error||'读取相册失败'),items:[]});
      }catch(e){resolve({ok:false,error:String(e),items:[]})}
    };
  });
}
function createCard(){
  const el=document.createElement('article');
  el.className='stack-card';
  el.innerHTML='<div class="stack-card-shell"><div class="stack-image-wrap"><img class="stack-image" draggable="false" alt=""><div class="stack-meta"><strong></strong><span></span></div></div></div>';
  return el;
}
function ensurePool(){
  const deck=$('#albumStackDeck');if(!deck)return false;
  if(els?.current?.isConnected)return true;
  deck.replaceChildren();
  const next3=createCard(),next2=createCard(),next1=createCard(),prev=createCard(),current=createCard();
  const hint=document.createElement('div');hint.className='stack-swipe-hint';hint.textContent='右滑下一张 · 左滑上一张 · 首尾循环';
  deck.append(next3,next2,next1,prev,current,hint);
  els={deck,current,next1,next2,next3,prev};
  deck.addEventListener('pointerdown',onDown,{passive:true});
  deck.addEventListener('pointermove',onMove,{passive:false});
  deck.addEventListener('pointerup',onUp,{passive:false});
  deck.addEventListener('pointercancel',onCancel,{passive:true});
  deck.addEventListener('dblclick',e=>{if(e.target.closest('.role-current .stack-card-shell')){e.preventDefault();openCurrent()}});
  return true;
}
const roles=['role-current','role-next1','role-next2','role-next3','role-prev','current'];
function role(el,name){
  roles.forEach(c=>el.classList.remove(c));el.classList.add('stack-card',name);if(name==='role-current')el.classList.add('current');
  el.style.transform='';el.style.opacity='';
}
function idx(off){return mod(index+off,items.length)}
function hydrate(el,item,n){
  if(!item)return;
  const img=$('.stack-image',el),strong=$('.stack-meta strong',el),span=$('.stack-meta span',el),src=srcFor(item);
  if(img.dataset.id!==String(item.id)){img.dataset.id=String(item.id);img.src=src;img.decoding='async';img.decode?.().catch(()=>{})}
  strong.textContent=item.name||'相册图片';span.textContent='第 '+(n+1)+' 张';
}
function resetRoles(){role(els.current,'role-current');role(els.next1,'role-next1');role(els.next2,'role-next2');role(els.next3,'role-next3');role(els.prev,'role-prev')}
function hydrateAll(){
  hydrate(els.current,items[idx(0)],idx(0));hydrate(els.next1,items[idx(1)],idx(1));hydrate(els.next2,items[idx(2)],idx(2));hydrate(els.next3,items[idx(3)],idx(3));hydrate(els.prev,items[idx(-1)],idx(-1));
  $('#albumStackCounter').textContent=(index+1)+' / '+items.length;$('#stackPrevBtn').disabled=items.length<=1;$('#stackNextBtn').disabled=items.length<=1;
}
function preload(){
  for(let o=-2;o<=5;o++){const s=srcFor(items[idx(o)]);if(!s)continue;const im=new Image();im.decoding='async';im.src=s;im.decode?.().catch(()=>{})}
}
function showEmpty(msg='相册还是空的'){
  const deck=$('#albumStackDeck');deck.innerHTML='<div class="empty-state"><strong>'+msg+'</strong><span>宫格模式仍由原相册功能负责。</span></div>';els=null;$('#albumStackCounter').textContent='0 / 0';
}
async function refresh(){
  const oldId=items[index]?.id;
  const result=await readAlbum();
  if(!result.ok){showEmpty('相册读取失败：'+result.error);return}
  items=result.items;cleanupUrls();
  if(oldId){const p=items.findIndex(x=>x.id===oldId);if(p>=0)index=p}
  if(!items.length){showEmpty();return}
  index=mod(index,items.length);ensurePool();resetRoles();hydrateAll();preload();
}
function setView(v){
  view=v==='stack'?'stack':'grid';
  $$('#albumViewSwitch [data-album-view]').forEach(b=>b.classList.toggle('active',b.dataset.albumView===view));
  $('#albumGrid').classList.toggle('hidden',view==='stack');
  $('#albumPagination').classList.toggle('hidden',view==='stack');
  $('#albumStackView').classList.toggle('hidden',view!=='stack');
  $('#toggleArrangeBtn').disabled=view==='stack';
  if(view==='stack')refresh();
}
function tf(x,y,s=1,r=0){return 'translate3d(calc(-50% + '+x+'px),calc(-50% + '+y+'px),0) scale('+s+') rotate('+r+'deg)'}
function frame(){
  raf=0;if(!pending||!active||animating||!els)return;
  const x=pending.x,y=pending.y,p=Math.min(1,Math.abs(x)/130);
  els.current.style.transform=tf(x,Math.max(-14,Math.min(14,y*.07)),1,x/31);els.current.style.opacity=String(Math.max(.64,1-Math.abs(x)/580));
  if(x>0){
    els.next1.style.transform=tf(14*(1-p),18*(1-p),.965+.035*p);els.next1.style.opacity=String(.96+.04*p);
    els.next2.style.transform=tf(27-13*p,34-16*p,.93+.035*p);els.next2.style.opacity=String(.89+.07*p);
    els.next3.style.transform=tf(39-12*p,49-15*p,.90+.03*p);els.next3.style.opacity=String(.72+.17*p);
  }else if(x<0){els.prev.style.transform=tf(-18*(1-p),18*(1-p),.965+.035*p);els.prev.style.opacity=String(p)}
}
function onDown(e){if(view!=='stack'||animating||items.length<=1||!e.target.closest('.role-current .stack-card-shell'))return;active=true;moved=false;dx=dy=0;sx=e.clientX;sy=e.clientY;startTime=performance.now()}
function onMove(e){if(!active||animating)return;dx=e.clientX-sx;dy=e.clientY-sy;if(Math.abs(dx)>5)moved=true;if(Math.abs(dx)>Math.abs(dy)){e.preventDefault();pending={x:dx,y:dy};if(!raf)raf=requestAnimationFrame(frame)}}
function clearInline(){if(!els)return;[els.current,els.next1,els.next2,els.next3,els.prev].forEach(x=>{x.style.transform='';x.style.opacity=''})}
async function spring(){
  if(!els)return;const p=Math.min(1,Math.abs(dx)/130),opts={duration:280,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'};
  const jobs=[els.current.animate([{transform:getComputedStyle(els.current).transform,opacity:getComputedStyle(els.current).opacity},{transform:tf(0,0),opacity:1}],opts)];
  if(dx>0){jobs.push(els.next1.animate([{transform:getComputedStyle(els.next1).transform},{transform:tf(14,18,.965)}],opts),els.next2.animate([{transform:getComputedStyle(els.next2).transform},{transform:tf(27,34,.93)}],opts),els.next3.animate([{transform:getComputedStyle(els.next3).transform},{transform:tf(39,49,.90)}],opts))}
  else if(dx<0)jobs.push(els.prev.animate([{transform:getComputedStyle(els.prev).transform,opacity:getComputedStyle(els.prev).opacity},{transform:tf(-18,18,.965),opacity:0}],opts));
  await Promise.all(jobs.map(a=>a.finished.catch(()=>{})));jobs.forEach(a=>a.cancel());clearInline();
}
async function next(){
  if(animating||items.length<=1||!els)return;animating=true;const w=$('.stack-viewport').clientWidth,opts={duration:270,easing:'cubic-bezier(.18,.82,.23,1)',fill:'forwards'};
  const jobs=[els.current.animate([{transform:getComputedStyle(els.current).transform,opacity:getComputedStyle(els.current).opacity},{transform:tf(w+160,0,1,12),opacity:0}],opts),els.next1.animate([{transform:getComputedStyle(els.next1).transform},{transform:tf(0,0,1)}],opts),els.next2.animate([{transform:getComputedStyle(els.next2).transform},{transform:tf(14,18,.965)}],opts),els.next3.animate([{transform:getComputedStyle(els.next3).transform},{transform:tf(27,34,.93)}],opts)];
  await Promise.all(jobs.map(a=>a.finished.catch(()=>{})));jobs.forEach(a=>a.cancel());index=idx(1);
  const oc=els.current,op=els.prev;els.current=els.next1;els.next1=els.next2;els.next2=els.next3;els.next3=op;els.prev=oc;resetRoles();hydrate(els.next3,items[idx(3)],idx(3));hydrate(els.prev,items[idx(-1)],idx(-1));clearInline();hydrateAll();preload();animating=false;
}
async function prev(){
  if(animating||items.length<=1||!els)return;animating=true;const w=$('.stack-viewport').clientWidth,opts={duration:270,easing:'cubic-bezier(.18,.82,.23,1)',fill:'forwards'};
  const jobs=[els.current.animate([{transform:getComputedStyle(els.current).transform,opacity:getComputedStyle(els.current).opacity},{transform:tf(-(w+160),0,1,-12),opacity:0}],opts),els.prev.animate([{transform:getComputedStyle(els.prev).transform,opacity:getComputedStyle(els.prev).opacity},{transform:tf(0,0,1),opacity:1}],opts)];
  await Promise.all(jobs.map(a=>a.finished.catch(()=>{})));jobs.forEach(a=>a.cancel());index=idx(-1);
  const oc=els.current,on3=els.next3,op=els.prev;els.current=op;els.next3=els.next2;els.next2=els.next1;els.next1=oc;els.prev=on3;resetRoles();hydrate(els.prev,items[idx(-1)],idx(-1));hydrateAll();clearInline();preload();animating=false;
}
async function onUp(e){if(!active||animating)return;active=false;if(raf){cancelAnimationFrame(raf);raf=0}pending=null;const t=Math.max(1,performance.now()-startTime),v=Math.abs(dx)/t,swipe=(Math.abs(dx)>68||(Math.abs(dx)>34&&v>.38))&&Math.abs(dx)>Math.abs(dy);if(swipe){dx>0?await next():await prev();return}await spring();if(!moved){const now=Date.now();if(e.pointerType!=='mouse'&&now-lastTap<330){openCurrent();lastTap=0}else lastTap=now}}
function onCancel(){if(!active)return;active=false;if(raf){cancelAnimationFrame(raf);raf=0}pending=null;spring()}
function openCurrent(){
  const src=srcFor(items[index]);const d=$('#lightbox'),img=$('#lightboxImage');if(!src||!d||!img)return;img.src=src;img.classList.add('zoomed');if(!d.open)d.showModal();
}
function program(delta){if(animating||items.length<=1)return;dx=delta>0?1:-1;dy=0;delta>0?next():prev()}

document.addEventListener('DOMContentLoaded',()=>{
  const sw=$('#albumViewSwitch');
  sw?.addEventListener('click',e=>{const b=e.target.closest('[data-album-view]');if(b){e.preventDefault();e.stopPropagation();setView(b.dataset.albumView)}});
  $('#stackPrevBtn')?.addEventListener('click',()=>program(-1));$('#stackNextBtn')?.addEventListener('click',()=>program(1));
  $('#albumUpload')?.addEventListener('change',()=>setTimeout(()=>{if(view==='stack')refresh()},500));
  // whenever user enters Album, refresh independent stack data, but don't interfere with original grid
  document.querySelector('[data-tab="album"]')?.addEventListener('click',()=>setTimeout(()=>{if(view==='stack')refresh()},80));
  setView('grid');
});
window.addEventListener('beforeunload',()=>{for(const u of urls.values())URL.revokeObjectURL(u);urls.clear()});
})();
(()=>{
'use strict';
window.__albumCardVersion='v13-fixed-slot-promotion';

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const DB='seedream-studio-db',VER=1,mod=(n,m)=>((n%m)+m)%m;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),lerp=(a,b,p)=>a+(b-a)*p;

let view='grid',items=[],index=0,slots=null;
let active=false,animating=false,sx=0,sy=0,dx=0,dy=0,started=0,raf=0,pending=null,lastTap=0;
const originalUrls=new Map(),previewUrls=new Map(),previewJobs=new Map();
const roles=['role-current','role-prev','role-prev2','role-next1','role-next2','role-next3','role-spare','current'];
const PREVIEW_MAX=1000;

function key(item){return String(item?.id??'')}
function originalSrc(item){
  if(!item)return '';
  if(item.blob){
    const k=key(item);if(originalUrls.has(k))return originalUrls.get(k);
    const u=URL.createObjectURL(item.blob);originalUrls.set(k,u);return u;
  }
  return item.url||item.dataUrl||'';
}
async function itemBlob(item){
  if(item?.blob)return item.blob;
  const u=item?.url||item?.dataUrl||'';
  if(!u)return null;
  try{const r=await fetch(u,{mode:'cors',cache:'force-cache'});return r.ok?await r.blob():null}catch{return null}
}
async function previewFor(item){
  if(!item)return '';
  const k=key(item);
  if(previewUrls.has(k))return previewUrls.get(k);
  if(previewJobs.has(k))return previewJobs.get(k);
  const job=(async()=>{
    try{
      const blob=await itemBlob(item);
      if(!blob)return originalSrc(item);
      const bmp=await createImageBitmap(blob);
      const scale=Math.min(1,PREVIEW_MAX/Math.max(bmp.width,bmp.height));
      if(scale>=.92){bmp.close?.();return originalSrc(item)}
      const w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale));
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const cx=c.getContext('2d',{alpha:true});cx.imageSmoothingEnabled=true;cx.imageSmoothingQuality='medium';cx.drawImage(bmp,0,0,w,h);bmp.close?.();
      const out=await new Promise(res=>c.toBlob(res,'image/webp',.84));
      if(!out)return originalSrc(item);
      const u=URL.createObjectURL(out);previewUrls.set(k,u);return u;
    }catch{return originalSrc(item)}
    finally{previewJobs.delete(k)}
  })();
  previewJobs.set(k,job);return job;
}
function cleanup(){
  const ids=new Set(items.map(key));
  for(const [k,u] of originalUrls){if(!ids.has(k)){URL.revokeObjectURL(u);originalUrls.delete(k)}}
  for(const [k,u] of previewUrls){if(!ids.has(k)){URL.revokeObjectURL(u);previewUrls.delete(k)}}
}
function readAlbum(){
  return new Promise(resolve=>{
    const req=indexedDB.open(DB,VER);req.onerror=()=>resolve([]);req.onupgradeneeded=()=>{};
    req.onsuccess=()=>{try{
      const db=req.result;if(!db.objectStoreNames.contains('album'))return resolve([]);
      const tx=db.transaction('album','readonly'),q=tx.objectStore('album').getAll();
      q.onsuccess=()=>resolve((q.result||[]).sort((a,b)=>(a.order??0)-(b.order??0)));q.onerror=()=>resolve([]);
    }catch{resolve([])}};
  });
}
function createCard(){
  const el=document.createElement('article');el.className='stack-card';
  el.innerHTML='<div class="stack-card-shell"><div class="stack-image-wrap"><img class="stack-image" draggable="false" alt=""><div class="stack-meta"><strong></strong><span></span></div></div></div>';
  el._ready=false;el._itemId='';return el;
}
function idx(o){return mod(index+o,items.length)}
function setRole(el,name){
  roles.forEach(c=>el.classList.remove(c));el.classList.add('stack-card',name);if(name==='role-current')el.classList.add('current');
  el.style.transition='';el.style.transform='';el.style.opacity='';
}
async function assign(el,item,n){
  if(!el||!item)return;
  const id=key(item);
  if(el._itemId===id&&el._ready)return;
  el._ready=false;el._itemId=id;
  const img=$('.stack-image',el);
  const u=await previewFor(item);
  if(el._itemId!==id)return;
  await new Promise(resolve=>{
    const done=()=>resolve();
    img.onload=done;img.onerror=done;img.src=u;
    img.decode?.().then(done).catch(()=>{});
    setTimeout(done,1200);
  });
  if(el._itemId!==id)return;
  el._ready=true;
  $('.stack-meta strong',el).textContent=item.name||'相册图片';
  $('.stack-meta span',el).textContent='第 '+(n+1)+' 张';
}
function resetRoles(){
  setRole(slots.current,'role-current');setRole(slots.prev,'role-prev');setRole(slots.prev2,'role-prev2');
  setRole(slots.next1,'role-next1');setRole(slots.next2,'role-next2');setRole(slots.next3,'role-next3');setRole(slots.spare,'role-spare');
}
async function initialFill(){
  const jobs=[
    assign(slots.prev2,items[idx(-2)],idx(-2)),assign(slots.prev,items[idx(-1)],idx(-1)),assign(slots.current,items[idx(0)],idx(0)),
    assign(slots.next1,items[idx(1)],idx(1)),assign(slots.next2,items[idx(2)],idx(2)),assign(slots.next3,items[idx(3)],idx(3)),assign(slots.spare,items[idx(4)],idx(4))
  ];
  await Promise.all(jobs);
}
function updateCount(){
  $('#albumStackCounter').textContent=(index+1)+' / '+items.length;
  $('#stackPrevBtn').disabled=items.length<=1;$('#stackNextBtn').disabled=items.length<=1;
}
function makePool(){
  const deck=$('#albumStackDeck');deck.replaceChildren();
  const loading=document.createElement('div');loading.className='stack-loading';loading.textContent='正在准备卡片…';deck.append(loading);
  const prev2=createCard(),prev=createCard(),current=createCard(),next1=createCard(),next2=createCard(),next3=createCard(),spare=createCard();
  const hint=document.createElement('div');hint.className='stack-swipe-hint';hint.textContent='左右滑动切换 · 后面的卡片会直接顶上来';
  deck.append(prev2,prev,current,next1,next2,next3,spare,hint);
  slots={deck,prev2,prev,current,next1,next2,next3,spare,loading};
  resetRoles();
  deck.addEventListener('pointerdown',onDown,{passive:true});deck.addEventListener('pointermove',onMove,{passive:false});
  deck.addEventListener('pointerup',onUp,{passive:false});deck.addEventListener('pointercancel',onCancel,{passive:true});
  deck.addEventListener('dblclick',e=>{if(e.target.closest('.role-current .stack-card-shell')){e.preventDefault();openCurrent()}});
}
async function refresh(){
  const old=items[index]?.id;items=await readAlbum();cleanup();
  if(old){const p=items.findIndex(x=>x.id===old);if(p>=0)index=p}
  if(!items.length){
    $('#albumStackDeck').innerHTML='<div class="empty-state"><strong>相册还是空的</strong><span>先上传图片，再切到卡片模式。</span></div>';updateCount();return;
  }
  index=mod(index,items.length);makePool();await initialFill();slots.loading.remove();slots.loading=null;updateCount();
  // 后续远端预览提前做，不触碰任何可见卡片
  [5,-3].forEach(o=>previewFor(items[idx(o)]).catch(()=>{}));
}
function setView(v){
  view=v==='stack'?'stack':'grid';
  $$('#albumViewSwitch [data-album-view]').forEach(b=>b.classList.toggle('active',b.dataset.albumView===view));
  $('#albumGrid').classList.toggle('hidden',view==='stack');$('#albumPagination').classList.toggle('hidden',view==='stack');$('#albumStackView').classList.toggle('hidden',view!=='stack');
  if(view==='stack')refresh();
}

function vw(){return $('#albumStackView .stack-viewport')?.clientWidth||window.innerWidth}
function tf(x,y,s=1,r=0){return 'translate3d(calc(-50% + '+x+'px),calc(-50% + '+y+'px),0) scale('+s+') rotate('+r+'deg)'}
function prevBase(){return -(vw()*.90)}
function out(dir){return dir*vw()*1.10}

function frame(){
  raf=0;if(!pending||!active||animating||!slots)return;
  const x=pending.x,y=pending.y,p=clamp(Math.abs(x)/(vw()*.60),0,1);
  slots.current.style.transform=tf(x,clamp(y*.04,-8,8),1,x/70);
  if(x<0){
    // 后面的 next1 就是之后的 current，不换图。
    slots.next1.style.transform=tf(lerp(10,0,p),lerp(12,0,p),lerp(.975,1,p));
    slots.next2.style.transform=tf(lerp(20,10,p),lerp(24,12,p),lerp(.95,.975,p));
  }else if(x>0){
    slots.prev.style.transform=tf(Math.min(0,x+prevBase()),lerp(10,0,p),lerp(.975,1,p));
    slots.next1.style.transform=tf(lerp(10,20,p),lerp(12,24,p),lerp(.975,.95,p));
  }
}
function onDown(e){
  if(view!=='stack'||animating||items.length<=1||!slots?.current?._ready||!e.target.closest('.role-current .stack-card-shell'))return;
  // 必须保证将要进入主位的卡已经加载完成，否则不启动手势。
  active=true;dx=dy=0;sx=e.clientX;sy=e.clientY;started=performance.now();slots.deck.classList.add('is-dragging');
}
function onMove(e){
  if(!active||animating)return;dx=e.clientX-sx;dy=e.clientY-sy;
  if(Math.abs(dx)>Math.abs(dy)){e.preventDefault();pending={x:dx,y:dy};if(!raf)raf=requestAnimationFrame(frame)}
}
function trans(ms=220){
  [slots.current,slots.prev,slots.next1,slots.next2].forEach(el=>el.style.transition='transform '+ms+'ms cubic-bezier(.22,.78,.22,1)');
}
function clearInline(){
  [slots.current,slots.prev,slots.prev2,slots.next1,slots.next2,slots.next3,slots.spare].forEach(el=>{el.style.transition='';el.style.transform='';el.style.opacity=''});
}
function wait(el,cb,ms=220){
  let done=false;const end=()=>{if(done)return;done=true;el.removeEventListener('transitionend',end);cb()};
  el.addEventListener('transitionend',end,{once:true});setTimeout(end,ms+90);
}
function spring(){
  trans(220);requestAnimationFrame(()=>{
    slots.current.style.transform=tf(0,0,1);slots.prev.style.transform=tf(prevBase(),0,.975);slots.next1.style.transform=tf(10,12,.975);slots.next2.style.transform=tf(20,24,.95);
  });setTimeout(clearInline,250);
}
async function loadFarForward(el){
  el.style.opacity='0';setRole(el,'role-spare');
  await assign(el,items[idx(5)],idx(5));
}
async function loadFarBackward(el){
  el.style.opacity='0';setRole(el,'role-prev2');
  await assign(el,items[idx(-2)],idx(-2));
}
function finishNext(){
  index=idx(1);
  const oldPrev2=slots.prev2,oldPrev=slots.prev,oldCurrent=slots.current;
  slots.prev2=oldPrev;slots.prev=oldCurrent;slots.current=slots.next1;slots.next1=slots.next2;slots.next2=slots.next3;slots.next3=slots.spare;slots.spare=oldPrev2;
  resetRoles();clearInline();updateCount();animating=false;
  // 只有最远、完全不可见的 spare 才换新图
  assign(slots.spare,items[idx(4)],idx(4)).then(()=>previewFor(items[idx(5)]).catch(()=>{}));
}
function next(){
  if(animating||!slots.next1._ready)return;animating=true;active=false;trans(220);
  requestAnimationFrame(()=>{
    slots.current.style.transform=tf(out(-1),0,1,-7);
    slots.next1.style.transform=tf(0,0,1);
    slots.next2.style.transform=tf(10,12,.975);
  });
  wait(slots.current,finishNext,220);
}
function finishPrev(){
  index=idx(-1);
  const oldPrev2=slots.prev2,oldPrev=slots.prev,oldCurrent=slots.current,oldNext1=slots.next1,oldNext2=slots.next2,oldNext3=slots.next3,oldSpare=slots.spare;
  slots.spare=oldNext3;slots.next3=oldNext2;slots.next2=oldNext1;slots.next1=oldCurrent;slots.current=oldPrev;slots.prev=oldPrev2;slots.prev2=oldSpare;
  resetRoles();clearInline();updateCount();animating=false;
  // 只有最远、完全不可见的 prev2 才换新图
  assign(slots.prev2,items[idx(-2)],idx(-2)).then(()=>previewFor(items[idx(-3)]).catch(()=>{}));
}
function prev(){
  if(animating||!slots.prev._ready)return;animating=true;active=false;trans(220);
  requestAnimationFrame(()=>{
    slots.current.style.transform=tf(out(1),0,1,7);
    slots.prev.style.transform=tf(0,0,1);
    slots.next1.style.transform=tf(20,24,.95);
  });
  wait(slots.current,finishPrev,220);
}
function onUp(e){
  if(!active||animating)return;active=false;slots.deck.classList.remove('is-dragging');if(raf){cancelAnimationFrame(raf);raf=0}pending=null;
  const elapsed=Math.max(1,performance.now()-started),vel=Math.abs(dx)/elapsed;
  const commit=(Math.abs(dx)>68||(Math.abs(dx)>36&&vel>.38))&&Math.abs(dx)>Math.abs(dy);
  if(commit){if(dx>0)prev();else next();return}
  spring();
  if(Math.abs(dx)<7&&Math.abs(dy)<7&&e.pointerType!=='mouse'){const now=Date.now();if(now-lastTap<330){openCurrent();lastTap=0}else lastTap=now}
}
function onCancel(){if(!active)return;active=false;slots.deck.classList.remove('is-dragging');if(raf){cancelAnimationFrame(raf);raf=0}pending=null;spring()}
function openCurrent(){
  const u=originalSrc(items[index]),dlg=$('#lightbox'),img=$('#lightboxImage');if(!u||!dlg||!img)return;
  img.src=u;img.classList.remove('zoomed');if(!dlg.open)dlg.showModal();
}
function program(delta){if(animating||items.length<=1)return;dx=delta<0?1:-1;dy=0;if(delta<0)prev();else next()}

document.addEventListener('DOMContentLoaded',()=>{
  $('#albumViewSwitch')?.addEventListener('click',e=>{const b=e.target.closest('[data-album-view]');if(b){e.preventDefault();e.stopPropagation();setView(b.dataset.albumView)}});
  $('#toggleArrangeBtn')?.addEventListener('click',()=>{if(view==='stack')setView('grid')},true);
  $('#stackPrevBtn')?.addEventListener('click',()=>program(-1));$('#stackNextBtn')?.addEventListener('click',()=>program(1));
  $('#albumUpload')?.addEventListener('change',()=>setTimeout(()=>{if(view==='stack')refresh()},450));
  document.querySelector('[data-tab="album"]')?.addEventListener('click',()=>setTimeout(()=>{if(view==='stack')refresh()},60));
  setView('grid');
});
window.addEventListener('beforeunload',()=>{
  for(const u of originalUrls.values())URL.revokeObjectURL(u);for(const u of previewUrls.values())URL.revokeObjectURL(u);
  originalUrls.clear();previewUrls.clear();
});
})();
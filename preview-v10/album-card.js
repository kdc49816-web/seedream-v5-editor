(()=>{
'use strict';
window.__albumCardVersion='v10-stacked-deck';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const DB='seedream-studio-db', VER=1;
const mod=(n,m)=>((n%m)+m)%m;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const lerp=(a,b,p)=>a+(b-a)*p;

let view='grid', items=[], index=0, els=null;
let active=false, animating=false, sx=0, sy=0, dx=0, dy=0, started=0, raf=0, pending=null, lastTap=0;
const urls=new Map();
const roles=['role-current','role-prev','role-next1','role-next2','role-stash','role-mirror','current'];

function srcFor(item){
  if(!item)return '';
  if(item.blob){
    if(urls.has(item.id))return urls.get(item.id);
    const u=URL.createObjectURL(item.blob); urls.set(item.id,u); return u;
  }
  return item.url||item.dataUrl||'';
}
function cleanupUrls(){
  const ids=new Set(items.map(x=>x.id));
  for(const [id,u] of urls){if(!ids.has(id)){URL.revokeObjectURL(u);urls.delete(id)}}
}
function readAlbum(){
  return new Promise(resolve=>{
    const req=indexedDB.open(DB,VER);
    req.onerror=()=>resolve([]);
    req.onupgradeneeded=()=>{};
    req.onsuccess=()=>{
      try{
        const db=req.result;
        if(!db.objectStoreNames.contains('album'))return resolve([]);
        const tx=db.transaction('album','readonly');
        const q=tx.objectStore('album').getAll();
        q.onsuccess=()=>resolve((q.result||[]).sort((a,b)=>(a.order??0)-(b.order??0)));
        q.onerror=()=>resolve([]);
      }catch{resolve([])}
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
  const deck=$('#albumStackDeck'); if(!deck)return false;
  if(els?.current?.isConnected)return true;
  deck.replaceChildren();
  const stash=createCard(),next2=createCard(),next1=createCard(),mirror=createCard(),prev=createCard(),current=createCard();
  const hint=document.createElement('div');
  hint.className='stack-swipe-hint';
  hint.textContent='右滑上一张 · 左滑下一张 · 松手自动吸附';
  deck.append(stash,next2,next1,mirror,prev,current,hint);
  els={deck,current,prev,next1,next2,stash,mirror};

  deck.addEventListener('pointerdown',onDown,{passive:true});
  deck.addEventListener('pointermove',onMove,{passive:false});
  deck.addEventListener('pointerup',onUp,{passive:false});
  deck.addEventListener('pointercancel',onCancel,{passive:true});
  deck.addEventListener('dblclick',e=>{
    if(e.target.closest('.role-current .stack-card-shell')){
      e.preventDefault(); openCurrent();
    }
  });
  return true;
}
function setRole(el,name){
  roles.forEach(c=>el.classList.remove(c));
  el.classList.add('stack-card',name);
  if(name==='role-current')el.classList.add('current');
  el.style.transition='';
  el.style.transform='';
  el.style.opacity='';
}
function idx(off){return mod(index+off,items.length)}
function hydrate(el,item,n){
  if(!el||!item)return;
  const img=$('.stack-image',el),u=srcFor(item);
  if(img.dataset.itemId!==String(item.id)){
    img.dataset.itemId=String(item.id);
    img.decoding='async';
    img.src=u;
    img.decode?.().catch(()=>{});
  }
  $('.stack-meta strong',el).textContent=item.name||'相册图片';
  $('.stack-meta span',el).textContent='第 '+(n+1)+' 张';
}
function resetRoles(){
  setRole(els.current,'role-current');
  setRole(els.prev,'role-prev');
  setRole(els.next1,'role-next1');
  setRole(els.next2,'role-next2');
  setRole(els.stash,'role-stash');
  setRole(els.mirror,'role-mirror');
}
function hydrateAll(){
  if(!items.length)return;
  hydrate(els.current,items[idx(0)],idx(0));
  hydrate(els.prev,items[idx(-1)],idx(-1));
  hydrate(els.next1,items[idx(1)],idx(1));
  hydrate(els.next2,items[idx(2)],idx(2));
  hydrate(els.stash,items[idx(3)],idx(3));
  hydrate(els.mirror,items[idx(0)],idx(0));
  $('#albumStackCounter').textContent=(index+1)+' / '+items.length;
  $('#stackPrevBtn').disabled=items.length<=1;
  $('#stackNextBtn').disabled=items.length<=1;

  els.next1.style.display=items.length>=2?'':'none';
  els.prev.style.display=items.length>=2?'':'none';
  els.next2.style.display=items.length>=3?'':'none';
  els.stash.style.display=items.length>=4?'':'none';
}
function predecode(){
  if(!items.length)return;
  for(let o=-2;o<=5;o++){
    const u=srcFor(items[idx(o)]); if(!u)continue;
    const im=new Image(); im.decoding='async'; im.src=u; im.decode?.().catch(()=>{});
  }
}
function showEmpty(){
  const deck=$('#albumStackDeck');
  deck.innerHTML='<div class="empty-state"><strong>相册还是空的</strong><span>先上传图片，再切到卡片模式。</span></div>';
  els=null;
  $('#albumStackCounter').textContent='0 / 0';
}
async function refresh(){
  const currentId=items[index]?.id;
  items=await readAlbum();
  cleanupUrls();
  if(currentId){
    const p=items.findIndex(x=>x.id===currentId);
    if(p>=0)index=p;
  }
  if(!items.length){showEmpty();return}
  index=mod(index,items.length);
  ensurePool();
  resetRoles();
  hydrateAll();
  predecode();
}
function setView(v){
  view=v==='stack'?'stack':'grid';
  $$('#albumViewSwitch [data-album-view]').forEach(b=>b.classList.toggle('active',b.dataset.albumView===view));
  $('#albumGrid').classList.toggle('hidden',view==='stack');
  $('#albumPagination').classList.toggle('hidden',view==='stack');
  $('#albumStackView').classList.toggle('hidden',view!=='stack');
  if(view==='stack')refresh();
}

function viewportW(){return $('#albumStackView .stack-viewport')?.clientWidth||window.innerWidth}
function tf(x,y,s=1,r=0){return 'translate3d(calc(-50% + '+x+'px),calc(-50% + '+y+'px),0) scale('+s+') rotate('+r+'deg)'}
function basePrevX(){return -(viewportW()*0.90)}
function outX(dir){return dir*viewportW()*1.12}

function applyFrame(){
  raf=0;
  if(!pending||!active||animating||!els)return;
  const x=pending.x,y=pending.y,w=viewportW();
  const p=clamp(Math.abs(x)/(w*0.60),0,1);
  const tilt=x/55;

  els.current.style.transform=tf(x,clamp(y*.05,-10,10),1,tilt);
  els.current.style.opacity='1';

  if(x<0){
    // 左滑：下一张从右后方连续顶到主位，后两张同步补位。
    els.next1.style.transform=tf(lerp(10,0,p),lerp(12,0,p),lerp(.975,1,p));
    els.next2.style.transform=tf(lerp(20,10,p),lerp(24,12,p),lerp(.95,.975,p));
    els.stash.style.opacity=String(p);
    els.stash.style.transform=tf(lerp(30,20,p),lerp(36,24,p),lerp(.925,.95,p));
    els.prev.style.transform=tf(basePrevX(),0,.975);
    els.mirror.style.opacity='0';
  }else if(x>0){
    // 右滑：上一张从左侧与手指同步进入。
    const prevX=Math.min(0,x+basePrevX());
    els.prev.style.transform=tf(prevX,lerp(10,0,p),lerp(.975,1,p));
    els.prev.style.opacity='1';

    // 当前卡离开时，在新主卡后方同步生成当前图的“后排镜像”，
    // 保证堆叠层级连续，不出现换层跳变。
    els.mirror.style.opacity=String(p);
    els.mirror.style.transform=tf(10,12,.975);

    els.next1.style.transform=tf(lerp(10,20,p),lerp(12,24,p),lerp(.975,.95,p));
    els.next2.style.transform=tf(lerp(20,30,p),lerp(24,36,p),lerp(.95,.925,p));
    els.next2.style.opacity=String(1-p*.28);
    els.stash.style.opacity='0';
  }
}
function onDown(e){
  if(view!=='stack'||animating||items.length<=1||!e.target.closest('.role-current .stack-card-shell'))return;
  active=true; dx=dy=0; sx=e.clientX; sy=e.clientY; started=performance.now();
  els.deck.setPointerCapture?.(e.pointerId);
}
function onMove(e){
  if(!active||animating)return;
  dx=e.clientX-sx; dy=e.clientY-sy;
  if(Math.abs(dx)>Math.abs(dy)){
    e.preventDefault();
    pending={x:dx,y:dy};
    if(!raf)raf=requestAnimationFrame(applyFrame);
  }
}
function setTransitions(ms=260){
  [els.current,els.prev,els.next1,els.next2,els.stash,els.mirror].forEach(el=>{
    el.style.transition='transform '+ms+'ms cubic-bezier(.22,.78,.22,1), opacity '+Math.min(ms,180)+'ms ease-out';
  });
}
function clearInline(){
  [els.current,els.prev,els.next1,els.next2,els.stash,els.mirror].forEach(el=>{
    el.style.transition=''; el.style.transform=''; el.style.opacity='';
  });
}
function waitTransition(el,cb,ms=260){
  let done=false;
  const finish=()=>{if(done)return;done=true;el.removeEventListener('transitionend',finish);cb()};
  el.addEventListener('transitionend',finish,{once:true});
  setTimeout(finish,ms+90);
}
function springBack(){
  if(!els)return;
  setTransitions(260);
  requestAnimationFrame(()=>{
    els.current.style.transform=tf(0,0,1,0); els.current.style.opacity='1';
    els.prev.style.transform=tf(basePrevX(),0,.975); els.prev.style.opacity='1';
    els.next1.style.transform=tf(10,12,.975); els.next1.style.opacity='1';
    els.next2.style.transform=tf(20,24,.95); els.next2.style.opacity='1';
    els.stash.style.transform=tf(30,36,.925); els.stash.style.opacity='0';
    els.mirror.style.transform=tf(10,12,.975); els.mirror.style.opacity='0';
  });
  setTimeout(clearInline,300);
}
function finalizeNext(){
  index=idx(1);
  const oldCurrent=els.current,oldPrev=els.prev;
  els.prev=oldCurrent;
  els.current=els.next1;
  els.next1=els.next2;
  els.next2=els.stash;
  els.stash=oldPrev;
  resetRoles();
  hydrate(els.prev,items[idx(-1)],idx(-1));
  hydrate(els.stash,items[idx(3)],idx(3));
  hydrate(els.mirror,items[idx(0)],idx(0));
  clearInline();
  hydrateAll();
  predecode();
  animating=false;
}
function animateNext(){
  if(animating||items.length<=1||!els)return;
  animating=true; active=false;
  const w=viewportW();
  const p=clamp(Math.abs(dx)/(w*0.60),0,1);
  setTransitions(250);
  requestAnimationFrame(()=>{
    els.current.style.transform=tf(outX(-1),0,1,-9);
    els.current.style.opacity='1';
    els.next1.style.transform=tf(0,0,1);
    els.next1.style.opacity='1';
    els.next2.style.transform=tf(10,12,.975);
    els.next2.style.opacity='1';
    els.stash.style.transform=tf(20,24,.95);
    els.stash.style.opacity='1';
    els.prev.style.transform=tf(basePrevX(),0,.975);
    els.mirror.style.opacity='0';
  });
  waitTransition(els.current,finalizeNext,250);
}
function finalizePrev(){
  index=idx(-1);

  const oldCurrent=els.current;
  const oldPrev=els.prev;
  const oldNext1=els.next1;
  const oldNext2=els.next2;
  const oldStash=els.stash;

  // 新顺序：prev -> current，旧 current -> next1，旧 next1 -> next2。
  els.current=oldPrev;
  els.next1=oldCurrent;
  els.next2=oldNext1;
  els.stash=oldNext2;
  els.prev=oldStash;

  resetRoles();
  hydrate(els.prev,items[idx(-1)],idx(-1));
  hydrate(els.stash,items[idx(3)],idx(3));
  hydrate(els.mirror,items[idx(0)],idx(0));
  clearInline();
  hydrateAll();
  predecode();
  animating=false;
}
function animatePrev(){
  if(animating||items.length<=1||!els)return;
  animating=true; active=false;
  const w=viewportW();
  setTransitions(250);
  requestAnimationFrame(()=>{
    els.current.style.transform=tf(outX(1),0,1,9);
    els.current.style.opacity='1';

    els.prev.style.transform=tf(0,0,1);
    els.prev.style.opacity='1';

    // 镜像在过渡末端就是旧 current 的后排位置。
    els.mirror.style.transform=tf(10,12,.975);
    els.mirror.style.opacity='1';

    els.next1.style.transform=tf(20,24,.95);
    els.next1.style.opacity='1';
    els.next2.style.transform=tf(30,36,.925);
    els.next2.style.opacity='.72';
    els.stash.style.opacity='0';
  });
  waitTransition(els.current,finalizePrev,250);
}
function onUp(e){
  if(!active||animating)return;
  active=false;
  if(raf){cancelAnimationFrame(raf);raf=0}
  pending=null;

  const elapsed=Math.max(1,performance.now()-started);
  const velocity=Math.abs(dx)/elapsed;
  const commit=(Math.abs(dx)>72||(Math.abs(dx)>38&&velocity>.38))&&Math.abs(dx)>Math.abs(dy);

  if(commit){
    // 当前需求：右滑上一张，左滑下一张。
    if(dx>0)animatePrev(); else animateNext();
    return;
  }

  springBack();

  if(Math.abs(dx)<7&&Math.abs(dy)<7&&e.pointerType!=='mouse'){
    const now=Date.now();
    if(now-lastTap<330){openCurrent();lastTap=0}else lastTap=now;
  }
}
function onCancel(){
  if(!active)return;
  active=false;
  if(raf){cancelAnimationFrame(raf);raf=0}
  pending=null;
  springBack();
}
function openCurrent(){
  const u=srcFor(items[index]),dlg=$('#lightbox'),img=$('#lightboxImage');
  if(!u||!dlg||!img)return;
  img.src=u;
  img.classList.remove('zoomed');
  if(!dlg.open)dlg.showModal();
}
function program(delta){
  if(animating||items.length<=1)return;
  dx=delta>0?-1:1; dy=0;
  // 上一张按钮 delta=-1；下一张按钮 delta=+1。
  if(delta<0)animatePrev(); else animateNext();
}

document.addEventListener('DOMContentLoaded',()=>{
  $('#albumViewSwitch')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-album-view]');
    if(b){e.preventDefault();e.stopPropagation();setView(b.dataset.albumView)}
  });

  // 卡片模式点“整理顺序”：先回宫格，再让原 app 的 click handler 开启整理。
  $('#toggleArrangeBtn')?.addEventListener('click',()=>{if(view==='stack')setView('grid')},true);

  $('#stackPrevBtn')?.addEventListener('click',()=>program(-1));
  $('#stackNextBtn')?.addEventListener('click',()=>program(1));

  $('#albumUpload')?.addEventListener('change',()=>setTimeout(()=>{if(view==='stack')refresh()},450));
  document.querySelector('[data-tab="album"]')?.addEventListener('click',()=>setTimeout(()=>{if(view==='stack')refresh()},60));
  setView('grid');
});

window.addEventListener('beforeunload',()=>{
  for(const u of urls.values())URL.revokeObjectURL(u);
  urls.clear();
});
})();
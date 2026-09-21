(()=>{
'use strict';
window.__albumCardVersion='v8';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const DB='seedream-studio-db',VER=1,mod=(n,m)=>((n%m)+m)%m;
let view='grid',items=[],index=0,els=null,animating=false,active=false,sx=0,sy=0,dx=0,dy=0,startTime=0,raf=0,pending=null,lastTap=0;
const urls=new Map();
const ROLE_CLASSES=['role-current','role-next1','role-next2','role-stash','role-prev','current'];

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
        const tx=db.transaction('album','readonly'),q=tx.objectStore('album').getAll();
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
  const deck=$('#albumStackDeck');if(!deck)return false;
  if(els?.current?.isConnected)return true;
  deck.replaceChildren();
  const stash=createCard(),next2=createCard(),next1=createCard(),prev=createCard(),current=createCard();
  const hint=document.createElement('div');hint.className='stack-swipe-hint';hint.textContent='左右滑动切换 · 双击查看';
  deck.append(stash,next2,next1,prev,current,hint);
  els={deck,current,next1,next2,stash,prev};
  deck.addEventListener('pointerdown',onPointerDown,{passive:true});
  deck.addEventListener('pointermove',onPointerMove,{passive:false});
  deck.addEventListener('pointerup',onPointerUp,{passive:false});
  deck.addEventListener('pointercancel',onPointerCancel,{passive:true});
  deck.addEventListener('dblclick',e=>{if(e.target.closest('.role-current .stack-card-shell')){e.preventDefault();openCurrent();}});
  return true;
}
function setRole(el,name){
  ROLE_CLASSES.forEach(c=>el.classList.remove(c));
  el.classList.add('stack-card',name);
  if(name==='role-current')el.classList.add('current');
  el.style.transition='';el.style.transform='';el.style.opacity='';
}
function idx(offset){return mod(index+offset,items.length)}
function hydrate(el,item,absoluteIndex){
  if(!el||!item)return;
  const img=$('.stack-image',el),src=srcFor(item);
  if(img.dataset.itemId!==String(item.id)){
    img.dataset.itemId=String(item.id);
    img.decoding='async';img.src=src;
    img.decode?.().catch(()=>{});
  }
  $('.stack-meta strong',el).textContent=item.name||'相册图片';
  $('.stack-meta span',el).textContent='第 '+(absoluteIndex+1)+' 张';
}
function resetRoles(){
  setRole(els.current,'role-current');setRole(els.next1,'role-next1');setRole(els.next2,'role-next2');setRole(els.stash,'role-stash');setRole(els.prev,'role-prev');
}
function hydrateAll(){
  hydrate(els.current,items[idx(0)],idx(0));
  hydrate(els.next1,items[idx(1)],idx(1));
  hydrate(els.next2,items[idx(2)],idx(2));
  hydrate(els.stash,items[idx(3)],idx(3));
  hydrate(els.prev,items[idx(-1)],idx(-1));
  $('#albumStackCounter').textContent=(index+1)+' / '+items.length;
  $('#stackPrevBtn').disabled=items.length<=1;$('#stackNextBtn').disabled=items.length<=1;
  els.next2.style.display=items.length>=3?'':'none';
  els.stash.style.display=items.length>=4?'':'none';
  els.prev.style.display=items.length>=2?'':'none';
}
function predecode(){
  if(!items.length)return;
  for(let o=-2;o<=5;o++){
    const u=srcFor(items[idx(o)]);if(!u)continue;
    const im=new Image();im.decoding='async';im.src=u;im.decode?.().catch(()=>{});
  }
}
function showEmpty(){
  const deck=$('#albumStackDeck');deck.innerHTML='<div class="empty-state"><strong>相册还是空的</strong><span>先上传图片，再切到卡片模式。</span></div>';
  els=null;$('#albumStackCounter').textContent='0 / 0';
}
async function refresh(){
  const currentId=items[index]?.id;
  items=await readAlbum();cleanupUrls();
  if(currentId){const p=items.findIndex(x=>x.id===currentId);if(p>=0)index=p;}
  if(!items.length){showEmpty();return;}
  index=mod(index,items.length);ensurePool();resetRoles();hydrateAll();predecode();
}
function setView(v){
  view=v==='stack'?'stack':'grid';
  $$('#albumViewSwitch [data-album-view]').forEach(b=>b.classList.toggle('active',b.dataset.albumView===view));
  $('#albumGrid').classList.toggle('hidden',view==='stack');
  $('#albumPagination').classList.toggle('hidden',view==='stack');
  $('#albumStackView').classList.toggle('hidden',view!=='stack');
  if(view==='stack')refresh();
}
function tf(x,y,s=1,r=0){return `translate3d(calc(-50% + ${x}px),calc(-50% + ${y}px),0) scale(${s}) rotate(${r}deg)`}
function blend(a,b,p){return a+(b-a)*p}
function applyFrame(){
  raf=0;if(!pending||!active||animating||!els)return;
  const x=pending.x,y=pending.y,ax=Math.abs(x),p=Math.min(1,ax/135);
  els.current.style.transform=tf(x,Math.max(-10,Math.min(10,y*.05)),1,x/52);
  els.current.style.opacity='1';
  if(x>0){
    els.next1.style.transform=tf(blend(8,0,p),blend(7,0,p),blend(.975,1,p));
    els.next2.style.transform=tf(blend(16,8,p),blend(14,7,p),blend(.95,.975,p));
    els.stash.style.opacity=String(p);
    els.stash.style.transform=tf(blend(23,16,p),blend(21,14,p),blend(.925,.95,p));
  }else if(x<0){
    els.prev.style.opacity=String(p);
    els.prev.style.transform=tf(blend(-22,0,p),blend(7,0,p),blend(.975,1,p));
    els.next1.style.transform=tf(blend(8,16,p),blend(7,14,p),blend(.975,.95,p));
    els.next2.style.opacity=String(1-p);
    els.next2.style.transform=tf(blend(16,23,p),blend(14,21,p),blend(.95,.925,p));
  }
}
function onPointerDown(e){
  if(view!=='stack'||animating||items.length<=1||!e.target.closest('.role-current .stack-card-shell'))return;
  active=true;dx=dy=0;sx=e.clientX;sy=e.clientY;startTime=performance.now();
  els.deck.setPointerCapture?.(e.pointerId);
}
function onPointerMove(e){
  if(!active||animating)return;
  dx=e.clientX-sx;dy=e.clientY-sy;
  if(Math.abs(dx)>Math.abs(dy)){
    e.preventDefault();pending={x:dx,y:dy};if(!raf)raf=requestAnimationFrame(applyFrame);
  }
}
function transitionAll(duration=250){
  [els.current,els.next1,els.next2,els.stash,els.prev].forEach(el=>el.style.transition=`transform ${duration}ms cubic-bezier(.18,.82,.23,1), opacity ${Math.min(duration,180)}ms ease-out`);
}
function clearInline(){
  [els.current,els.next1,els.next2,els.stash,els.prev].forEach(el=>{el.style.transition='';el.style.transform='';el.style.opacity='';});
}
function finishOn(el,cb,duration=250){
  let done=false;const end=()=>{if(done)return;done=true;el.removeEventListener('transitionend',end);cb();};
  el.addEventListener('transitionend',end,{once:true});setTimeout(end,duration+90);
}
function springBack(){
  if(!els)return;transitionAll(260);
  requestAnimationFrame(()=>{[els.current,els.next1,els.next2,els.stash,els.prev].forEach(el=>{el.style.transform='';el.style.opacity='';});});
  setTimeout(clearInline,300);
}
function commitNext(){
  index=idx(1);
  const oldPrev=els.prev,oldCurrent=els.current;
  els.prev=oldCurrent;els.current=els.next1;els.next1=els.next2;els.next2=els.stash;els.stash=oldPrev;
  resetRoles();hydrate(els.stash,items[idx(3)],idx(3));hydrate(els.prev,items[idx(-1)],idx(-1));
  clearInline();hydrateAll();predecode();animating=false;
}
function animateNext(){
  if(animating||items.length<=1||!els)return;animating=true;active=false;
  if(items.length>=3)els.next2.style.display='';
  if(items.length>=4)els.stash.style.display='';
  const w=$('.stack-viewport').clientWidth;transitionAll(230);
  requestAnimationFrame(()=>{
    els.current.style.transform=tf(w+150,0,1,10);els.current.style.opacity='1';
    els.next1.style.transform=tf(0,0,1);els.next1.style.opacity='1';
    els.next2.style.transform=tf(8,7,.975);els.next2.style.opacity='1';
    els.stash.style.transform=tf(16,14,.95);els.stash.style.opacity='1';
  });
  finishOn(els.current,commitNext,230);
}
function animatePrev(){
  if(animating||items.length<=1||!els)return;animating=true;active=false;
  const oldCurrent=els.current,oldNext1=els.next1,oldNext2=els.next2,oldStash=els.stash,oldPrev=els.prev;
  transitionAll(230);
  requestAnimationFrame(()=>{
    oldPrev.style.transform=tf(0,0,1);oldPrev.style.opacity='1';
    oldCurrent.style.transform=tf(8,7,.975);oldCurrent.style.opacity='1';
    oldNext1.style.transform=tf(16,14,.95);oldNext1.style.opacity='1';
    oldNext2.style.transform=tf(23,21,.925);oldNext2.style.opacity='0';
    oldStash.style.transform=tf(-22,7,.975);oldStash.style.opacity='0';
  });
  finishOn(oldPrev,()=>{
    index=idx(-1);
    els.current=oldPrev;els.next1=oldCurrent;els.next2=oldNext1;els.stash=oldNext2;els.prev=oldStash;
    resetRoles();hydrate(els.prev,items[idx(-1)],idx(-1));hydrate(els.stash,items[idx(3)],idx(3));
    clearInline();hydrateAll();predecode();animating=false;
  },230);
}
async function onPointerUp(e){
  if(!active||animating)return;active=false;if(raf){cancelAnimationFrame(raf);raf=0}pending=null;
  const elapsed=Math.max(1,performance.now()-startTime),velocity=Math.abs(dx)/elapsed;
  const swipe=(Math.abs(dx)>64||(Math.abs(dx)>34&&velocity>.36))&&Math.abs(dx)>Math.abs(dy);
  if(swipe){dx>0?animateNext():animatePrev();return;}
  springBack();
  const now=Date.now();if(Math.abs(dx)<7&&Math.abs(dy)<7&&e.pointerType!=='mouse'){
    if(now-lastTap<330){openCurrent();lastTap=0}else lastTap=now;
  }
}
function onPointerCancel(){if(!active)return;active=false;if(raf){cancelAnimationFrame(raf);raf=0}pending=null;springBack();}
function openCurrent(){
  const u=srcFor(items[index]),dlg=$('#lightbox'),img=$('#lightboxImage');if(!u||!dlg||!img)return;
  img.src=u;img.classList.remove('zoomed');if(!dlg.open)dlg.showModal();
}
function program(delta){if(animating||items.length<=1)return;dx=delta>0?1:-1;dy=0;delta>0?animateNext():animatePrev();}

document.addEventListener('DOMContentLoaded',()=>{
  $('#albumViewSwitch')?.addEventListener('click',e=>{const b=e.target.closest('[data-album-view]');if(b){e.preventDefault();e.stopPropagation();setView(b.dataset.albumView);}});
  $('#toggleArrangeBtn')?.addEventListener('click',()=>{if(view==='stack')setView('grid');},true);
  $('#stackPrevBtn')?.addEventListener('click',()=>program(-1));$('#stackNextBtn')?.addEventListener('click',()=>program(1));
  $('#albumUpload')?.addEventListener('change',()=>setTimeout(()=>{if(view==='stack')refresh();},450));
  document.querySelector('[data-tab="album"]')?.addEventListener('click',()=>setTimeout(()=>{if(view==='stack')refresh();},60));
  setView('grid');
});
window.addEventListener('beforeunload',()=>{for(const u of urls.values())URL.revokeObjectURL(u);urls.clear();});
})();

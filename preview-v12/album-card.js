(()=>{
'use strict';
window.__albumCardVersion='v12-canvas-deck';

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const DB='seedream-studio-db',VER=1;
const mod=(n,m)=>((n%m)+m)%m;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const lerp=(a,b,p)=>a+(b-a)*p;

let view='grid',items=[],index=0,canvas=null,ctx=null,dpr=1;
let active=false,animating=false,sx=0,sy=0,dx=0,dy=0,startTime=0,raf=0,lastTap=0;
let animStart=0,animFrom=null,animTo=null,animDone=null,animDuration=230;
const bitmapCache=new Map();
const bitmapJobs=new Map();
const originalUrls=new Map();
const lru=[];
const CACHE_MAX=10;

function itemKey(item){return String(item?.id??'')}
function originalSrc(item){
  if(!item)return '';
  if(item.blob){
    const key=itemKey(item);
    if(originalUrls.has(key))return originalUrls.get(key);
    const u=URL.createObjectURL(item.blob);originalUrls.set(key,u);return u;
  }
  return item.url||item.dataUrl||'';
}
async function blobFor(item){
  if(item?.blob)return item.blob;
  const u=item?.url||item?.dataUrl||'';
  if(!u)return null;
  try{
    const r=await fetch(u,{mode:'cors',cache:'force-cache'});
    if(!r.ok)return null;
    return await r.blob();
  }catch{return null}
}
function touchLRU(key){
  const p=lru.indexOf(key);if(p>=0)lru.splice(p,1);lru.push(key);
  while(lru.length>CACHE_MAX){
    const k=lru.shift(),b=bitmapCache.get(k);
    if(b){b.close?.();bitmapCache.delete(k)}
  }
}
async function bitmapFor(item){
  if(!item)return null;
  const key=itemKey(item);
  if(bitmapCache.has(key)){touchLRU(key);return bitmapCache.get(key)}
  if(bitmapJobs.has(key))return bitmapJobs.get(key);
  const job=(async()=>{
    try{
      const blob=await blobFor(item);
      if(!blob)return null;
      let bmp;
      try{
        bmp=await createImageBitmap(blob,{resizeWidth:1200,resizeHeight:1200,resizeQuality:'medium'});
      }catch{
        bmp=await createImageBitmap(blob);
      }
      bitmapCache.set(key,bmp);touchLRU(key);return bmp;
    }catch{return null}
    finally{bitmapJobs.delete(key)}
  })();
  bitmapJobs.set(key,job);
  return job;
}
function cleanupCaches(){
  const ids=new Set(items.map(itemKey));
  for(const [k,b] of bitmapCache){if(!ids.has(k)){b.close?.();bitmapCache.delete(k)}}
  for(const [k,u] of originalUrls){if(!ids.has(k)){URL.revokeObjectURL(u);originalUrls.delete(k)}}
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
function idx(o){return mod(index+o,items.length)}
function resizeCanvas(){
  if(!canvas)return;
  const r=canvas.getBoundingClientRect();
  dpr=Math.min(window.devicePixelRatio||1,2);
  const w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  ctx=canvas.getContext('2d',{alpha:true,desynchronized:true});
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
function stageSize(){
  const r=canvas.getBoundingClientRect();
  return {w:r.width,h:r.height};
}
function cardRect(){
  const {w,h}=stageSize();
  const cw=Math.min(w*.78,330);
  const ch=Math.min(h*.84,420);
  return {cw,ch,cx:w/2,cy:h/2};
}
function roundRectPath(x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
}
function drawBitmap(bmp,x,y,w,h,scale=1,rot=0,alpha=1,shadow=true){
  if(!bmp)return;
  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.translate(x+w/2,y+h/2);ctx.rotate(rot);ctx.scale(scale,scale);ctx.translate(-w/2,-h/2);
  if(shadow){ctx.shadowColor='rgba(24,28,36,.13)';ctx.shadowBlur=18;ctx.shadowOffsetY=8}
  ctx.fillStyle='#fff';roundRectPath(0,0,w,h,22);ctx.fill();
  ctx.shadowColor='transparent';
  ctx.save();roundRectPath(0,0,w,h,22);ctx.clip();
  ctx.fillStyle='#f7f7f8';ctx.fillRect(0,0,w,h);
  const ar=bmp.width/bmp.height,cr=w/h;let dw,dh,dx,dy;
  if(ar>cr){dw=w;dh=w/ar;dx=0;dy=(h-dh)/2}else{dh=h;dw=h*ar;dy=0;dx=(w-dw)/2}
  ctx.drawImage(bmp,dx,dy,dw,dh);
  ctx.restore();ctx.restore();
}
function easeOut(t){return 1-Math.pow(1-t,3)}
function stateForDrag(x,y){
  const {w}=stageSize();
  const p=clamp(Math.abs(x)/(w*.60),0,1);
  return {x,y,p};
}
async function ensureAround(){
  if(!items.length)return;
  await Promise.all([-1,0,1,2].map(o=>bitmapFor(items[idx(o)])));
  requestDraw();
  [3,-2].forEach(o=>bitmapFor(items[idx(o)]).catch(()=>{}));
}
function requestDraw(){
  if(!raf)raf=requestAnimationFrame(draw);
}
function draw(){
  raf=0;if(!ctx||!canvas)return;
  resizeCanvas();
  const {w,h}=stageSize(),{cw,ch,cx,cy}=cardRect();
  ctx.clearRect(0,0,w,h);
  if(!items.length)return;

  const cur=bitmapCache.get(itemKey(items[idx(0)]));
  const prev=bitmapCache.get(itemKey(items[idx(-1)]));
  const n1=bitmapCache.get(itemKey(items[idx(1)]));
  const n2=bitmapCache.get(itemKey(items[idx(2)]));

  let x=dx,y=dy;
  if(animating&&animFrom&&animTo){
    const t=clamp((performance.now()-animStart)/animDuration,0,1),e=easeOut(t);
    x=lerp(animFrom.x,animTo.x,e);y=lerp(animFrom.y,animTo.y,e);
    if(t<1)requestDraw();else{const done=animDone;animating=false;animFrom=animTo=animDone=null;dx=dy=0;done?.();return}
  }

  const p=clamp(Math.abs(x)/(w*.60),0,1);
  const baseX=cx-cw/2,baseY=cy-ch/2;

  if(x>=0){
    // right swipe: previous enters from left, current follows finger right
    drawBitmap(n2,baseX+20,baseY+24,cw,ch,.95,0,1,!active);
    drawBitmap(n1,baseX+10,baseY+12,cw,ch,.975,0,1,!active);
    const prevX=baseX-w*.90+x;
    drawBitmap(prev,prevX,baseY+lerp(10,0,p),cw,ch,lerp(.975,1,p),0,1,!active);
    drawBitmap(cur,baseX+x,baseY+clamp(y*.05,-8,8),cw,ch,1,x/900,1,!active);
  }else{
    // left swipe: next card rises from stack while current leaves left
    drawBitmap(n2,baseX+lerp(20,10,p),baseY+lerp(24,12,p),cw,ch,lerp(.95,.975,p),0,1,!active);
    drawBitmap(n1,baseX+lerp(10,0,p),baseY+lerp(12,0,p),cw,ch,lerp(.975,1,p),0,1,!active);
    drawBitmap(cur,baseX+x,baseY+clamp(y*.05,-8,8),cw,ch,1,x/900,1,!active);
  }
}
function animateTo(tx,ty,done){
  animating=true;active=false;animStart=performance.now();animFrom={x:dx,y:dy};animTo={x:tx,y:ty};animDone=done;requestDraw();
}
async function commitNext(){
  index=idx(1);$('#albumStackCounter').textContent=(index+1)+' / '+items.length;await ensureAround();requestDraw();
}
async function commitPrev(){
  index=idx(-1);$('#albumStackCounter').textContent=(index+1)+' / '+items.length;await ensureAround();requestDraw();
}
function onDown(e){
  if(view!=='stack'||animating||items.length<=1)return;
  const r=canvas.getBoundingClientRect();
  active=true;sx=e.clientX;sy=e.clientY;dx=dy=0;startTime=performance.now();
  canvas.setPointerCapture?.(e.pointerId);
}
function onMove(e){
  if(!active||animating)return;
  const nx=e.clientX-sx,ny=e.clientY-sy;
  if(Math.abs(nx)>Math.abs(ny)){e.preventDefault();dx=nx;dy=ny;requestDraw()}
}
function onUp(e){
  if(!active||animating)return;
  active=false;
  const elapsed=Math.max(1,performance.now()-startTime),velocity=Math.abs(dx)/elapsed;
  const commit=(Math.abs(dx)>68||(Math.abs(dx)>36&&velocity>.38))&&Math.abs(dx)>Math.abs(dy);
  const {w}=stageSize();
  if(commit){
    if(dx>0)animateTo(w*1.08,0,()=>{commitPrev()});
    else animateTo(-w*1.08,0,()=>{commitNext()});
  }else{
    animateTo(0,0,()=>{requestDraw()});
  }
  if(Math.abs(dx)<7&&Math.abs(dy)<7&&e.pointerType!=='mouse'){
    const now=Date.now();
    if(now-lastTap<330){openCurrent();lastTap=0}else lastTap=now;
  }
}
function onCancel(){if(!active)return;active=false;animateTo(0,0,()=>requestDraw())}
function openCurrent(){
  const u=originalSrc(items[index]),dlg=$('#lightbox'),img=$('#lightboxImage');
  if(!u||!dlg||!img)return;
  img.src=u;img.classList.remove('zoomed');if(!dlg.open)dlg.showModal();
}
function program(delta){
  if(animating||items.length<=1)return;
  const {w}=stageSize();dx=0;dy=0;
  if(delta<0)animateTo(w*1.08,0,()=>commitPrev());
  else animateTo(-w*1.08,0,()=>commitNext());
}
function renderCanvas(){
  const deck=$('#albumStackDeck');if(!deck)return;
  deck.replaceChildren();
  canvas=document.createElement('canvas');canvas.className='stack-canvas';deck.append(canvas);
  const hint=document.createElement('div');hint.className='stack-swipe-hint';hint.textContent='左右滑动切换 · 双击查看';deck.append(hint);
  canvas.addEventListener('pointerdown',onDown,{passive:true});
  canvas.addEventListener('pointermove',onMove,{passive:false});
  canvas.addEventListener('pointerup',onUp,{passive:false});
  canvas.addEventListener('pointercancel',onCancel,{passive:true});
  canvas.addEventListener('dblclick',e=>{e.preventDefault();openCurrent()});
  resizeCanvas();requestDraw();
}
async function refresh(){
  const currentId=items[index]?.id;
  items=await readAlbum();cleanupCaches();
  if(currentId){const p=items.findIndex(x=>x.id===currentId);if(p>=0)index=p}
  if(!items.length){
    const deck=$('#albumStackDeck');deck.innerHTML='<div class="empty-state"><strong>相册还是空的</strong><span>先上传图片，再切到卡片模式。</span></div>';
    $('#albumStackCounter').textContent='0 / 0';return;
  }
  index=mod(index,items.length);
  renderCanvas();
  $('#albumStackCounter').textContent=(index+1)+' / '+items.length;
  $('#stackPrevBtn').disabled=items.length<=1;$('#stackNextBtn').disabled=items.length<=1;
  await ensureAround();
}
function setView(v){
  view=v==='stack'?'stack':'grid';
  $$('#albumViewSwitch [data-album-view]').forEach(b=>b.classList.toggle('active',b.dataset.albumView===view));
  $('#albumGrid').classList.toggle('hidden',view==='stack');
  $('#albumPagination').classList.toggle('hidden',view==='stack');
  $('#albumStackView').classList.toggle('hidden',view!=='stack');
  if(view==='stack')refresh();
}
document.addEventListener('DOMContentLoaded',()=>{
  $('#albumViewSwitch')?.addEventListener('click',e=>{const b=e.target.closest('[data-album-view]');if(b){e.preventDefault();e.stopPropagation();setView(b.dataset.albumView)}});
  $('#toggleArrangeBtn')?.addEventListener('click',()=>{if(view==='stack')setView('grid')},true);
  $('#stackPrevBtn')?.addEventListener('click',()=>program(-1));
  $('#stackNextBtn')?.addEventListener('click',()=>program(1));
  $('#albumUpload')?.addEventListener('change',()=>setTimeout(()=>{if(view==='stack')refresh()},450));
  document.querySelector('[data-tab="album"]')?.addEventListener('click',()=>setTimeout(()=>{if(view==='stack')refresh()},60));
  window.addEventListener('resize',()=>{if(view==='stack'){resizeCanvas();requestDraw()}});
  setView('grid');
});
window.addEventListener('beforeunload',()=>{
  for(const b of bitmapCache.values())b.close?.();
  for(const u of originalUrls.values())URL.revokeObjectURL(u);
  bitmapCache.clear();originalUrls.clear();
});
})();
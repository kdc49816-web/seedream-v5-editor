(()=>{
'use strict';
window.__albumCardVersion='v19-smooth-settle';

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const DB='seedream-studio-db',VER=1,mod=(n,m)=>((n%m)+m)%m;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),lerp=(a,b,p)=>a+(b-a)*p;

let view='grid',items=[],index=0,slots=null;
let active=false,animating=false,sx=0,sy=0,dx=0,dy=0,started=0,raf=0,pending=null,lastTap=0;
let editingReviewId='';
let cards=[],moving=[],refreshToken=0;
let deckWidth=400,cardWidth=320,pointerId=null,settleCancel=null,velocity=0,lastX=0,lastTime=0;
const originalUrls=new Map(),previewUrls=new Map(),previewJobs=new Map();
const roles=['role-current','role-prev','role-prev2','role-next1','role-next2','role-next3','role-spare','current'];
const PREVIEW_MAX=window.innerWidth<=720?880:1100;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let warmTimer=0;
function warmFarPreview(){
  clearTimeout(warmTimer);
  warmTimer=setTimeout(()=>{
    if(view!=='stack'||!items.length)return;
    if(active||animating){warmFarPreview();return}
    prepareNearby();
  },180);
}

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
function writeAlbum(item){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB,VER);req.onerror=()=>reject(req.error);req.onupgradeneeded=()=>{};
    req.onsuccess=()=>{try{
      const db=req.result,tx=db.transaction('album','readwrite');tx.objectStore('album').put(item);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
    }catch(error){reject(error)}};
  });
}
function createCard(){
  const el=document.createElement('article');el.className='stack-card';
  el.innerHTML='<div class="stack-card-shell"><div class="stack-image-wrap"><img class="stack-image" draggable="false" alt=""><div class="stack-caption" aria-live="polite"></div><div class="stack-meta"><strong></strong><span></span></div></div></div>';
  el._ready=false;el._itemId='';el._image=$('.stack-image',el);el._blur=0;return el;
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
  const caption=$('.stack-caption',el),review=String(item.review||'').trim();
  caption.textContent=review;caption.classList.toggle('hidden',!review);
  $('.stack-meta strong',el).textContent=item.name||'相册图片';
  $('.stack-meta span',el).textContent='第 '+(n+1)+' 张';
}
function resetRoles(){
  cards.forEach((el,n)=>{
    const depth=mod(n-index,items.length);
    el.className='stack-card'+(depth===0?' role-current current':'');
    el.style.transition='none';el.style.transform=restTransform(depth);el.style.opacity='1';
    el.style.zIndex=String(items.length-depth);el.style.willChange=depth<4?'transform':'auto';
    el.style.pointerEvents=depth===0?'auto':'none';el.dataset.depth=String(depth);el._depth=depth;
    setBlur(el,0);
  });
  slots.current=cards[index];slots.prev=cards[idx(-1)];slots.next1=cards[idx(1)];moving=[];
}
async function initialFill(){
  await prepareNearby();
}
function prepareNearby(){
  if(!items.length)return Promise.resolve();
  const indices=new Set([idx(-1),idx(-2),...Array.from({length:Math.min(6,items.length)},(_,i)=>idx(i))]);
  return Promise.all([...indices].map(n=>assign(cards[n],items[n],n)));
}
function updateCount(){
  $('#albumStackCounter').textContent=(items.length?index+1:0)+' / '+items.length;
  $('#stackPrevBtn').disabled=items.length<=1;$('#stackNextBtn').disabled=items.length<=1;
  updateReviewEntry();
}
function currentItem(){return items[index]||null}
function updateReviewEntry(){
  const btn=$('#reviewEntryBtn'),item=currentItem();if(!btn)return;
  btn.classList.toggle('hidden',!item);btn.classList.toggle('has-review',!!String(item?.review||'').trim());
  btn.setAttribute('aria-label',String(item?.review||'').trim()?'修改当前照片评价':'给当前照片写评价');
}
function openReview(){
  if(active||animating)return;
  const item=currentItem(),dlg=$('#reviewModal'),input=$('#reviewInput');if(!item||!dlg||!input)return;
  editingReviewId=key(item);input.value=String(item.review||'');
  $('#reviewCount').textContent=String(input.value.length);
  const has=!!input.value.trim();$('#reviewModalTitle').textContent=has?'修改评价':'写评价';$('#deleteReviewBtn').classList.toggle('hidden',!has);
  if(!dlg.open)dlg.showModal();setTimeout(()=>input.focus(),40);
}
async function persistReview(value){
  const item=items.find(x=>key(x)===editingReviewId);if(!item)return;
  const review=String(value||'').trim();
  if(review)item.review=review;else delete item.review;
  await writeAlbum(item);
  document.dispatchEvent(new CustomEvent('album-review-changed',{detail:{id:key(item),review}}));
  cards.forEach(el=>{if(el._itemId===key(item)){const caption=$('.stack-caption',el);caption.textContent=review;caption.classList.toggle('hidden',!review)}});
  updateReviewEntry();
}
async function saveReview(){
  const input=$('#reviewInput'),value=input?.value.trim()||'';if(!value){input?.focus();return}
  try{await persistReview(value);$('#reviewModal')?.close();notify('评价已保存')}catch{notify('评价保存失败，请重试')}
}
async function deleteReview(){
  const item=items.find(x=>key(x)===editingReviewId);if(!item?.review||!confirm('删除这条评价？'))return;
  try{await persistReview('');$('#reviewModal')?.close();notify('评价已删除')}catch{notify('评价删除失败，请重试')}
}
function notify(text){
  const el=$('#toast');if(!el)return;el.textContent=text;el.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove('show'),2200);
}
function makePool(){
  const deck=$('#albumStackDeck');deck.replaceChildren();
  const loading=document.createElement('div');loading.className='stack-loading';loading.textContent='正在准备卡片…';deck.append(loading);
  cards=items.map(item=>{const el=createCard();el._itemId=key(item);el.dataset.photoId=key(item);return el});
  const hint=document.createElement('div');hint.className='stack-swipe-hint';hint.textContent='左右滑动切换 · 后面的卡片会直接顶上来';
  deck.append(...cards,hint);
  slots={deck,loading};
  resetRoles();
  measureDeck();
  deck.addEventListener('pointerdown',onDown,{passive:true});deck.addEventListener('pointermove',onMove,{passive:false});
  deck.addEventListener('pointerup',onUp,{passive:false});deck.addEventListener('pointercancel',onCancel,{passive:true});
  deck.addEventListener('dblclick',e=>{if(e.target.closest('.role-current .stack-card-shell')){e.preventDefault();openCurrent()}});
}
async function refresh(){
  const token=++refreshToken,old=items[index]?.id,loaded=await readAlbum();if(token!==refreshToken)return;
  if(settleCancel){settleCancel();settleCancel=null}if(raf)cancelAnimationFrame(raf);
  raf=0;active=animating=false;pointerId=null;pending=null;items=loaded;cleanup();
  if(old){const p=items.findIndex(x=>x.id===old);if(p>=0)index=p}
  if(!items.length){
    cards=[];slots=null;index=0;
    $('#albumStackDeck').innerHTML='<div class="empty-state"><strong>相册还是空的</strong><span>先上传图片，再切到卡片模式。</span></div>';updateCount();return;
  }
  index=mod(index,items.length);makePool();await initialFill();if(token!==refreshToken)return;slots.loading.remove();slots.loading=null;updateCount();
  // 后续远端预览提前做，不触碰任何可见卡片
  warmFarPreview();
}
function setView(v){
  view=v==='stack'?'stack':'grid';
  $$('#albumViewSwitch [data-album-view]').forEach(b=>b.classList.toggle('active',b.dataset.albumView===view));
  $('#albumGrid').classList.toggle('hidden',view==='stack');$('#albumPagination').classList.toggle('hidden',view==='stack');$('#albumStackView').classList.toggle('hidden',view!=='stack');
  if(view==='stack')refresh();
}

function measureDeck(){
  deckWidth=$('#albumStackView .stack-viewport')?.clientWidth||window.innerWidth;
  cardWidth=slots?.current?.offsetWidth||320;
  slots?.deck.style.setProperty('--prev-offset',(-deckWidth*.9)+'px');
}
function vw(){return deckWidth}
function tf(x,y,s=1,r=0){return 'translate(calc(-50% + '+x+'px),calc(-50% + '+y+'px)) scale('+s+') rotate('+r+'deg)'}
function prevBase(){return -(vw()*.90)}
function out(dir){return dir*vw()*1.10}
const poses=[];
function depthPose(depth){
  if(poses[depth])return poses[depth];
  // Each real card has its own depth. Compress deep stacks into the available margin.
  const d=Math.max(0,depth),offset=26*(1-Math.exp(-d/3));
  return poses[depth]={x:offset*.65,y:offset,s:1-.055*offset/26};
}
function restTransform(depth){const p=depthPose(depth);return tf(p.x,p.y,p.s)}
function setBlur(el,amount){
  if(el._blur===amount)return;
  el._blur=amount;el._image.style.filter=amount?'blur('+amount+'px)':'none';
}
let motionForward=null;
function beginMotion(){
  motionForward=null;
  moving=[...new Set([slots.current,slots.prev,...Array.from({length:Math.min(6,items.length)},(_,i)=>cards[idx(i)])])];
  moving.forEach(el=>{el.style.transition='none';el.style.willChange='transform';
    el._from=depthPose(el._depth);el._next=depthPose(el._depth-1);el._prev=depthPose(el._depth+1);
  });
}
function paintMotion(x,p,blur=0){
  const forward=x<=0,previous=slots.prev;
  if(motionForward!==forward){
    moving.forEach(el=>{el.style.zIndex=String(!forward&&el===previous?items.length+1:items.length-el._depth)});
    motionForward=forward;
  }
  moving.forEach(el=>{
    if(el===slots.current){
      el.style.transform=tf(x,0,1,reducedMotion.matches?0:clamp(x/cardWidth*9,-5,5));
    }else if(!forward&&el===previous){
      // Move the actual last card to the front; no duplicate image is inserted.
      el.style.transform=tf(lerp(prevBase(),0,p),0,lerp(.985,1,p));
    }else{
      const a=el._from,b=forward?el._next:el._prev;
      el.style.transform=tf(lerp(a.x,b.x,p),lerp(a.y,b.y,p),lerp(a.s,b.s,p));
    }
    if(el===slots.current||el===previous)setBlur(el,blur);
  });
}

function frame(){
  raf=0;if(!pending||!active||animating||!slots)return;
  const x=pending.x,p=clamp(Math.abs(x)/(cardWidth*.72),0,1);
  paintMotion(x,p,reducedMotion.matches||Math.abs(x)<6?0:.4);
}
function onDown(e){
  if(view!=='stack'||animating||items.length<=1||!slots?.current?._ready||!e.target.closest('.role-current .stack-card-shell'))return;
  // 必须保证将要进入主位的卡已经加载完成，否则不启动手势。
  if(pointerId!==null)return;
  if(settleCancel){settleCancel();settleCancel=null;clearInline()}
  measureDeck();pointerId=e.pointerId;slots.deck.setPointerCapture?.(e.pointerId);
  beginMotion();
  active=true;dx=dy=velocity=0;sx=lastX=e.clientX;sy=e.clientY;started=lastTime=performance.now();
}
function onMove(e){
  if(!active||animating||e.pointerId!==pointerId)return;
  const now=performance.now(),dt=now-lastTime;
  if(dt>0){velocity=(e.clientX-lastX)/dt;lastX=e.clientX;lastTime=now}
  dx=e.clientX-sx;dy=e.clientY-sy;
  if(Math.abs(dx)>Math.abs(dy)){e.preventDefault();pending={x:dx,y:dy};if(!raf)raf=requestAnimationFrame(frame)}
}
function trans(ms=400){
  if(reducedMotion.matches)ms=1;
  moving.forEach(el=>el.style.transition='transform '+ms+'ms cubic-bezier(.25,.46,.45,1)');
}
function clearInline(){
  resetRoles();
}
function wait(el,cb,ms=220){
  let done=false,timer;const cancel=()=>{done=true;clearTimeout(timer);el.removeEventListener('transitionend',end)};
  const end=e=>{if(done||(e&&(e.target!==el||e.propertyName!=='transform')))return;cancel();cb()};
  el.addEventListener('transitionend',end);timer=setTimeout(end,ms+60);return cancel;
}
function spring(){
  trans(320);
  moving.forEach(el=>{el.style.transform=restTransform(el._depth)});
  settleCancel=wait(slots.current,()=>{clearInline();settleCancel=null},320);
}
function finishNext(){
  index=idx(1);
  resetRoles();updateCount();animating=false;warmFarPreview();
}
function next(){
  if(animating)return;if(!slots.next1._ready){spring();return}animating=true;active=false;
  const ms=reducedMotion.matches?1:clamp(440-Math.abs(dx)/cardWidth*65-Math.abs(velocity)*12,340,440);trans(ms);
  paintMotion(out(-1),1,slots.current._blur);
  settleCancel=wait(slots.current,()=>{settleCancel=null;finishNext()},ms);
}
function finishPrev(){
  index=idx(-1);
  resetRoles();updateCount();animating=false;warmFarPreview();
}
function prev(){
  if(animating)return;if(!slots.prev._ready){spring();return}animating=true;active=false;
  const ms=reducedMotion.matches?1:clamp(440-Math.abs(dx)/cardWidth*65-Math.abs(velocity)*12,340,440);trans(ms);
  paintMotion(1,1,slots.current._blur);slots.current.style.transform=restTransform(1);
  settleCancel=wait(slots.prev,()=>{settleCancel=null;finishPrev()},ms);
}
function onUp(e){
  if(e.pointerId!==pointerId)return;pointerId=null;
  if(!active||animating)return;
  if(raf){cancelAnimationFrame(raf);raf=0;frame()}active=false;pending=null;
  const elapsed=Math.max(1,performance.now()-started),vel=Math.abs(dx)/elapsed;
  const commit=(Math.abs(dx)>68||(Math.abs(dx)>36&&vel>.38))&&Math.abs(dx)>Math.abs(dy);
  if(commit){if(dx>0)prev();else next();return}
  spring();
  if(Math.abs(dx)<7&&Math.abs(dy)<7&&e.pointerType!=='mouse'){const now=Date.now();if(now-lastTap<330){openCurrent();lastTap=0}else lastTap=now}
}
function onCancel(){pointerId=null;if(!active)return;active=false;if(raf){cancelAnimationFrame(raf);raf=0}pending=null;spring()}
function openCurrent(){
  const u=originalSrc(items[index]),dlg=$('#lightbox'),img=$('#lightboxImage');if(!u||!dlg||!img)return;
  img.src=u;img.classList.remove('zoomed');if(!dlg.open)dlg.showModal();
}
function program(delta){if(animating||active||!slots||items.length<=1)return;if(settleCancel){settleCancel();settleCancel=null;clearInline()}measureDeck();beginMotion();dx=delta<0?1:-1;dy=velocity=0;if(delta<0)prev();else next()}

document.addEventListener('DOMContentLoaded',()=>{
  $('#albumViewSwitch')?.addEventListener('click',e=>{const b=e.target.closest('[data-album-view]');if(b){e.preventDefault();e.stopPropagation();setView(b.dataset.albumView)}});
  $('#toggleArrangeBtn')?.addEventListener('click',()=>{if(view==='stack')setView('grid')},true);
  $('#stackPrevBtn')?.addEventListener('click',()=>program(-1));$('#stackNextBtn')?.addEventListener('click',()=>program(1));
  $('#albumUpload')?.addEventListener('change',()=>setTimeout(()=>{if(view==='stack')refresh()},450));
  document.querySelector('[data-tab="album"]')?.addEventListener('click',()=>setTimeout(()=>{if(view==='stack')refresh()},60));
  $('#reviewEntryBtn')?.addEventListener('click',openReview);
  $('#reviewInput')?.addEventListener('input',e=>{$('#reviewCount').textContent=String(e.target.value.length)});
  $('#saveReviewBtn')?.addEventListener('click',saveReview);
  $('#deleteReviewBtn')?.addEventListener('click',deleteReview);
  $('#reviewModal')?.addEventListener('close',()=>{editingReviewId=''});
  setView('grid');
});
window.addEventListener('beforeunload',()=>{
  for(const u of originalUrls.values())URL.revokeObjectURL(u);for(const u of previewUrls.values())URL.revokeObjectURL(u);
  originalUrls.clear();previewUrls.clear();
});
})();

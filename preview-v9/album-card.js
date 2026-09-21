(()=>{
'use strict';
window.__albumCardVersion='v9-native-scroll';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const DB='seedream-studio-db', VER=1;
let view='grid', items=[], realIndex=0, deck=null, slides=[], debounceTimer=0, lastTapAt=0, lastTapTarget=null;
const urls=new Map();

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
function openLightbox(item){
  const u=srcFor(item), dlg=$('#lightbox'), img=$('#lightboxImage');
  if(!u||!dlg||!img)return;
  img.src=u; img.classList.remove('zoomed');
  if(!dlg.open)dlg.showModal();
}
function makeSlide(item,real,clone=false){
  const slide=document.createElement('div');
  slide.className='carousel-slide';
  slide.dataset.real=String(real);
  slide.dataset.clone=clone?'1':'0';
  const card=document.createElement('div');
  card.className='carousel-card';
  const img=document.createElement('img');
  img.alt='相册图片';
  img.src=srcFor(item);
  img.decoding='async';
  img.draggable=false;
  img.dataset.real=String(real);
  img.decode?.().catch(()=>{});
  card.append(img); slide.append(card);
  return slide;
}
function slideStep(){
  if(slides.length<2)return 1;
  const a=slides[1], b=slides[2] || slides[1];
  const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
  return Math.max(1,rb.left-ra.left);
}
function currentVisualIndex(){
  if(!deck||!slides.length)return 1;
  const step=slideStep();
  return Math.round(deck.scrollLeft/step);
}
function updateCounterFromVisual(){
  if(!items.length)return;
  const v=currentVisualIndex();
  let r=Number(slides[v]?.dataset.real ?? realIndex);
  if(Number.isFinite(r))realIndex=r;
  $('#albumStackCounter').textContent=(realIndex+1)+' / '+items.length;
}
function jumpToVisual(v){
  if(!deck||!slides[v])return;
  const step=slideStep();
  deck.scrollTo({left:v*step,behavior:'auto'});
}
function finalizeLoop(){
  if(!items.length||!deck)return;
  let v=currentVisualIndex();
  const last=slides.length-1;
  if(v<=0){
    realIndex=items.length-1;
    jumpToVisual(items.length);
  }else if(v>=last){
    realIndex=0;
    jumpToVisual(1);
  }else{
    realIndex=Number(slides[v].dataset.real||0);
  }
  $('#albumStackCounter').textContent=(realIndex+1)+' / '+items.length;
}
function bindDeck(){
  if(!deck)return;
  deck.addEventListener('scroll',()=>{
    updateCounterFromVisual();
    clearTimeout(debounceTimer);
    debounceTimer=setTimeout(finalizeLoop,90);
  },{passive:true});
  if('onscrollend' in deck){
    deck.addEventListener('scrollend',finalizeLoop,{passive:true});
  }
  deck.addEventListener('pointerup',e=>{
    const img=e.target.closest('.carousel-card img');
    if(!img)return;
    const now=Date.now();
    if(lastTapTarget===img && now-lastTapAt<330){
      e.preventDefault();
      const idx=Number(img.dataset.real||0);
      openLightbox(items[idx]);
      lastTapAt=0; lastTapTarget=null;
    }else{
      lastTapAt=now; lastTapTarget=img;
    }
  });
  deck.addEventListener('dblclick',e=>{
    const img=e.target.closest('.carousel-card img'); if(!img)return;
    e.preventDefault();
    openLightbox(items[Number(img.dataset.real||0)]);
  });
}
function renderCarousel(){
  deck=$('#albumStackDeck');
  if(!deck)return;
  if(!items.length){
    deck.replaceChildren();
    const empty=document.createElement('div');
    empty.className='empty-state';
    empty.style.flex='0 0 100%';
    empty.innerHTML='<strong>相册还是空的</strong><span>先上传图片，再切到卡片模式。</span>';
    deck.append(empty);
    $('#albumStackCounter').textContent='0 / 0';
    $('#stackPrevBtn').disabled=true;$('#stackNextBtn').disabled=true;
    slides=[];return;
  }
  const oldReal=items[realIndex]?.id;
  if(oldReal){
    const p=items.findIndex(x=>x.id===oldReal);
    if(p>=0)realIndex=p;
  }
  realIndex=Math.max(0,Math.min(realIndex,items.length-1));
  const frag=document.createDocumentFragment();
  // clone last + all real + clone first => seamless loop
  frag.append(makeSlide(items[items.length-1],items.length-1,true));
  items.forEach((item,i)=>frag.append(makeSlide(item,i,false)));
  frag.append(makeSlide(items[0],0,true));
  deck.replaceChildren(frag);
  slides=$$('.carousel-slide',deck);
  bindDeck();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const step=slideStep();
    deck.scrollLeft=(realIndex+1)*step;
    $('#albumStackCounter').textContent=(realIndex+1)+' / '+items.length;
  }));
  $('#stackPrevBtn').disabled=items.length<=1;$('#stackNextBtn').disabled=items.length<=1;
}
async function refresh(){
  const currentId=items[realIndex]?.id;
  items=await readAlbum();
  cleanupUrls();
  if(currentId){
    const p=items.findIndex(x=>x.id===currentId);
    if(p>=0)realIndex=p;
  }
  renderCarousel();
}
function setView(v){
  view=v==='stack'?'stack':'grid';
  $$('#albumViewSwitch [data-album-view]').forEach(b=>b.classList.toggle('active',b.dataset.albumView===view));
  $('#albumGrid').classList.toggle('hidden',view==='stack');
  $('#albumPagination').classList.toggle('hidden',view==='stack');
  $('#albumStackView').classList.toggle('hidden',view!=='stack');
  if(view==='stack')refresh();
}
function moveBy(delta){
  if(!deck||items.length<=1)return;
  const step=slideStep();
  const v=currentVisualIndex();
  deck.scrollTo({left:(v+delta)*step,behavior:'smooth'});
}
document.addEventListener('DOMContentLoaded',()=>{
  $('#albumViewSwitch')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-album-view]');
    if(b){e.preventDefault();e.stopPropagation();setView(b.dataset.albumView)}
  });
  // Arrange remains usable: switch back to grid first, then let original app handler toggle arranging.
  $('#toggleArrangeBtn')?.addEventListener('click',()=>{if(view==='stack')setView('grid')},true);
  $('#stackPrevBtn')?.addEventListener('click',()=>moveBy(-1));
  $('#stackNextBtn')?.addEventListener('click',()=>moveBy(1));
  $('#albumUpload')?.addEventListener('change',()=>setTimeout(()=>{if(view==='stack')refresh()},450));
  document.querySelector('[data-tab="album"]')?.addEventListener('click',()=>setTimeout(()=>{if(view==='stack')refresh()},60));
  setView('grid');
});
window.addEventListener('beforeunload',()=>{for(const u of urls.values())URL.revokeObjectURL(u);urls.clear()});
})();
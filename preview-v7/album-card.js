(()=>{
'use strict';
window.__albumCardVersion='v7';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const DB='seedream-studio-db',VER=1,mod=(n,m)=>((n%m)+m)%m;
let view='grid',items=[],index=0,els=null,anim=false,active=false,sx=0,sy=0,dx=0,dy=0,start=0,raf=0,pending=null,lastTap=0;
const urls=new Map(),roles=['role-current','role-next1','role-next2','role-next3','role-prev','current','is-moving'];

function src(item){
  if(!item)return '';
  if(item.blob){
    if(urls.has(item.id))return urls.get(item.id);
    const u=URL.createObjectURL(item.blob);urls.set(item.id,u);return u;
  }
  return item.url||item.dataUrl||'';
}
function cleanup(){
  const ids=new Set(items.map(x=>x.id));
  for(const [id,u] of urls)if(!ids.has(id)){URL.revokeObjectURL(u);urls.delete(id)}
}
function readAlbum(){
  return new Promise(resolve=>{
    const q=indexedDB.open(DB,VER);
    q.onerror=()=>resolve([]);
    q.onupgradeneeded=()=>{};
    q.onsuccess=()=>{
      try{
        const d=q.result;if(!d.objectStoreNames.contains('album'))return resolve([]);
        const tx=d.transaction('album','readonly'),r=tx.objectStore('album').getAll();
        r.onsuccess=()=>resolve((r.result||[]).sort((a,b)=>(a.order??0)-(b.order??0)));
        r.onerror=()=>resolve([]);
      }catch{resolve([])}
    };
  });
}
function make(){
  const e=document.createElement('article');
  e.className='stack-card';
  e.innerHTML='<div class="stack-card-shell"><div class="stack-image-wrap"><img class="stack-image" draggable="false" alt=""><div class="stack-meta"><strong></strong><span></span></div></div></div>';
  return e;
}
function ensure(){
  const d=$('#albumStackDeck');if(!d)return false;
  if(els?.current?.isConnected)return true;
  d.replaceChildren();
  const next3=make(),next2=make(),next1=make(),prev=make(),current=make();
  const hint=document.createElement('div');hint.className='stack-swipe-hint';hint.textContent='右滑下一张 · 左滑上一张 · 首尾循环';
  d.append(next3,next2,next1,prev,current,hint);
  els={d,current,next1,next2,next3,prev};
  d.addEventListener('pointerdown',down,{passive:true});
  d.addEventListener('pointermove',move,{passive:false});
  d.addEventListener('pointerup',up,{passive:false});
  d.addEventListener('pointercancel',cancel,{passive:true});
  d.addEventListener('dblclick',e=>{if(e.target.closest('.role-current .stack-card-shell')){e.preventDefault();openCurrent()}});
  return true;
}
function role(e,n){
  roles.forEach(c=>e.classList.remove(c));e.classList.add('stack-card',n);if(n==='role-current')e.classList.add('current');
  e.style.transition='';e.style.transform='';e.style.opacity='';
}
function idx(o){return mod(index+o,items.length)}
function hydrate(e,item,n){
  if(!e||!item)return;
  const im=$('.stack-image',e),st=$('.stack-meta strong',e),sp=$('.stack-meta span',e),u=src(item);
  if(im.dataset.id!==String(item.id)){
    im.dataset.id=String(item.id);im.decoding='async';im.src=u;im.decode?.().catch(()=>{});
  }
  st.textContent=item.name||'相册图片';sp.textContent='第 '+(n+1)+' 张';
}
function rolesReset(){
  role(els.current,'role-current');role(els.next1,'role-next1');role(els.next2,'role-next2');role(els.next3,'role-next3');role(els.prev,'role-prev');
}
function fill(){
  if(!items.length)return;
  hydrate(els.current,items[idx(0)],idx(0));hydrate(els.next1,items[idx(1)],idx(1));hydrate(els.next2,items[idx(2)],idx(2));hydrate(els.next3,items[idx(3)],idx(3));hydrate(els.prev,items[idx(-1)],idx(-1));
  $('#albumStackCounter').textContent=(index+1)+' / '+items.length;
  $('#stackPrevBtn').disabled=items.length<=1;$('#stackNextBtn').disabled=items.length<=1;
  for(let o=-2;o<=5;o++){const u=src(items[idx(o)]);if(!u)continue;const im=new Image();im.decoding='async';im.src=u;im.decode?.().catch(()=>{})}
}
function empty(){
  const d=$('#albumStackDeck');d.innerHTML='<div class="empty-state"><strong>相册还是空的</strong><span>先上传图片，再切到卡片模式。</span></div>';els=null;$('#albumStackCounter').textContent='0 / 0';
}
async function refresh(){
  const old=items[index]?.id;items=await readAlbum();cleanup();
  if(old){const p=items.findIndex(x=>x.id===old);if(p>=0)index=p}
  if(!items.length){empty();return}
  index=mod(index,items.length);ensure();rolesReset();fill();
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
  raf=0;if(!pending||!active||anim||!els)return;
  const x=pending.x,y=pending.y,p=Math.min(1,Math.abs(x)/135);
  // Important: outgoing card stays opaque. This removes the ghosting seen in the recording.
  els.current.style.transform=tf(x,Math.max(-12,Math.min(12,y*.06)),1,x/34);
  els.current.style.opacity='1';
  if(x>0){
    els.next1.style.transform=tf(14*(1-p),18*(1-p),.965+.035*p);
    els.next2.style.transform=tf(27-13*p,34-16*p,.93+.035*p);
    els.next3.style.transform=tf(39-12*p,49-15*p,.90+.03*p);
  }else if(x<0){
    els.prev.style.opacity=String(Math.min(1,p*1.35));
    els.prev.style.transform=tf(-28*(1-p),18*(1-p),.965+.035*p);
  }
}
function down(e){
  if(view!=='stack'||anim||items.length<=1||!e.target.closest('.role-current .stack-card-shell'))return;
  active=true;dx=dy=0;sx=e.clientX;sy=e.clientY;start=performance.now();
}
function move(e){
  if(!active||anim)return;dx=e.clientX-sx;dy=e.clientY-sy;
  if(Math.abs(dx)>Math.abs(dy)){e.preventDefault();pending={x:dx,y:dy};if(!raf)raf=requestAnimationFrame(frame)}
}
function clearInline(){if(!els)return;[els.current,els.next1,els.next2,els.next3,els.prev].forEach(e=>{e.style.transition='';e.style.transform='';e.style.opacity=''})}
function transition(el,transform,opacity){
  el.style.transition='transform 300ms cubic-bezier(.18,.82,.23,1), opacity 180ms ease-out';
  requestAnimationFrame(()=>{el.style.transform=transform;if(opacity!==undefined)el.style.opacity=String(opacity)});
}
function onceEnd(el,cb){
  let done=false;const finish=()=>{if(done)return;done=true;el.removeEventListener('transitionend',finish);cb()};
  el.addEventListener('transitionend',finish,{once:true});setTimeout(finish,360);
}
function spring(){
  if(!els)return;
  const all=[els.current,els.next1,els.next2,els.next3,els.prev];
  all.forEach(e=>e.style.transition='transform 280ms cubic-bezier(.22,1,.36,1), opacity 180ms ease-out');
  requestAnimationFrame(()=>{els.current.style.transform='';els.next1.style.transform='';els.next2.style.transform='';els.next3.style.transform='';els.prev.style.transform='';els.prev.style.opacity=''});
  setTimeout(()=>all.forEach(e=>e.style.transition=''),300);
}
function finishNext(){
  index=idx(1);
  const oc=els.current,op=els.prev;
  els.current=els.next1;els.next1=els.next2;els.next2=els.next3;els.next3=op;els.prev=oc;
  rolesReset();hydrate(els.next3,items[idx(3)],idx(3));hydrate(els.prev,items[idx(-1)],idx(-1));clearInline();fill();anim=false;
}
function finishPrev(){
  index=idx(-1);
  const oc=els.current,on3=els.next3,op=els.prev;
  els.current=op;els.next3=els.next2;els.next2=els.next1;els.next1=oc;els.prev=on3;
  rolesReset();hydrate(els.prev,items[idx(-1)],idx(-1));hydrate(els.next1,items[idx(1)],idx(1));clearInline();fill();anim=false;
}
function next(){
  if(anim||items.length<=1||!els)return;anim=true;active=false;
  const w=$('.stack-viewport').clientWidth;
  [els.current,els.next1,els.next2,els.next3].forEach(e=>e.classList.add('is-moving'));
  transition(els.current,tf(w+180,0,1,11),1);
  transition(els.next1,tf(0,0,1),1);transition(els.next2,tf(14,18,.965),1);transition(els.next3,tf(27,34,.93),1);
  onceEnd(els.current,finishNext);
}
function prev(){
  if(anim||items.length<=1||!els)return;anim=true;active=false;
  const w=$('.stack-viewport').clientWidth;
  els.current.classList.add('is-moving');els.prev.classList.add('is-moving');
  transition(els.current,tf(-(w+180),0,1,-11),1);
  transition(els.prev,tf(0,0,1),1);
  onceEnd(els.current,finishPrev);
}
function up(e){
  if(!active||anim)return;active=false;if(raf){cancelAnimationFrame(raf);raf=0}pending=null;
  const t=Math.max(1,performance.now()-start),v=Math.abs(dx)/t,swipe=(Math.abs(dx)>68||(Math.abs(dx)>36&&v>.38))&&Math.abs(dx)>Math.abs(dy);
  if(swipe){dx>0?next():prev();return}
  spring();
  const now=Date.now();if(Math.abs(dx)<7&&Math.abs(dy)<7&&e.pointerType!=='mouse'){if(now-lastTap<330){openCurrent();lastTap=0}else lastTap=now}
}
function cancel(){if(!active)return;active=false;if(raf){cancelAnimationFrame(raf);raf=0}pending=null;spring()}
function openCurrent(){
  const u=src(items[index]),d=$('#lightbox'),im=$('#lightboxImage');if(!u||!d||!im)return;
  im.src=u;im.classList.add('zoomed');if(!d.open)d.showModal();
}
function program(n){if(anim||items.length<=1)return;dx=n>0?1:-1;dy=0;n>0?next():prev()}

document.addEventListener('DOMContentLoaded',()=>{
  $('#albumViewSwitch')?.addEventListener('click',e=>{const b=e.target.closest('[data-album-view]');if(b){e.preventDefault();e.stopPropagation();setView(b.dataset.albumView)}});
  $('#stackPrevBtn')?.addEventListener('click',()=>program(-1));$('#stackNextBtn')?.addEventListener('click',()=>program(1));
  $('#albumUpload')?.addEventListener('change',()=>setTimeout(()=>{if(view==='stack')refresh()},450));
  document.querySelector('[data-tab="album"]')?.addEventListener('click',()=>setTimeout(()=>{if(view==='stack')refresh()},60));
  setView('grid');
});
window.addEventListener('beforeunload',()=>{for(const u of urls.values())URL.revokeObjectURL(u);urls.clear()});
})();
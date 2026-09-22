(() => {
  'use strict';

  const MODEL = 'bytedance/seedream-v5.0-pro/edit';
  const ATLAS_BASE = 'https://api.atlascloud.ai';
  const DEEPSEEK_BASE = 'https://api.deepseek.com';
  const DB_NAME = 'seedream-studio-db';
  const DB_VERSION = 1;
  const ALBUM_PAGE_SIZE = 20;
  const LS = {
    atlas: 'seedream-atlas-api-key',
    deepseek: 'seedream-deepseek-api-key',
    proxy: 'seedream-proxy-base',
    legacyHistory: 'seedream-edit-history'
  };

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const state = {
    tab: 'editor', sourceDataUrl: '', sourceName: '', sourceDims: null,
    ratio: 'original', resolution: '1K', analysis: null, generating: false,
    currentResult: null, history: [], album: [], albumPage: 1, arranging: false,
    dragId: null, toastTimer: null
  };

  const ratios = [
    ['original','原图'],['1:1','1:1'],['16:9','16:9'],['9:16','9:16'],['4:3','4:3'],['3:4','3:4'],['2:3','2:3'],['3:2','3:2']
  ];
  const sizePresets = {
    '1K': {'1:1':'1024*1024','16:9':'1344*768','9:16':'768*1344','4:3':'1184*896','3:4':'896*1184','2:3':'832*1248','3:2':'1248*832'},
    '1.5K': {'1:1':'1536*1536','16:9':'2048*1152','9:16':'1152*2048','4:3':'1776*1328','3:4':'1328*1776','2:3':'1248*1872','3:2':'1872*1248'},
    '2K': {'1:1':'2048*2048','16:9':'2720*1530','9:16':'1530*2720','4:3':'2304*1728','3:4':'1728*2304','2:3':'1664*2496','3:2':'2496*1664'}
  };

  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function uid(prefix='id') { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
  function formatTime(iso) { try { return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso)); } catch { return ''; } }
  function escapeHtml(v='') { return String(v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function fileToDataUrl(file) { return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result)); r.onerror=reject; r.readAsDataURL(file); }); }
  function imageDims(dataUrl) { return new Promise((resolve)=>{ const img=new Image(); img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight}); img.onerror=()=>resolve(null); img.src=dataUrl; }); }
  function nearestRatio(w,h) { if(!w||!h) return '1:1'; const target=w/h; const options=['1:1','16:9','9:16','4:3','3:4','2:3','3:2']; return options.map(r=>{const [a,b]=r.split(':').map(Number);return [r,Math.abs(a/b-target)]}).sort((a,b)=>a[1]-b[1])[0][0]; }

  let dbPromise;
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded=()=>{
        const d=req.result;
        if(!d.objectStoreNames.contains('history')) d.createObjectStore('history',{keyPath:'id'});
        if(!d.objectStoreNames.contains('album')) d.createObjectStore('album',{keyPath:'id'});
      };
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
    return dbPromise;
  }
  async function dbAll(store){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction(store,'readonly');const r=tx.objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)});}
  async function dbPut(store,item){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction(store,'readwrite');tx.objectStore(store).put(item);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)});}
  async function dbDelete(store,id){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)});}
  async function dbClear(store){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction(store,'readwrite');tx.objectStore(store).clear();tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)});}

  function mediaSrc(item){ return item.blob ? URL.createObjectURL(item.blob) : item.url || item.dataUrl || ''; }
  const tempUrls = new Set();
  function trackedSrc(item){ const src=mediaSrc(item); if(src.startsWith('blob:')) tempUrls.add(src); return src; }
  function revokeTempUrls(){ tempUrls.forEach(u=>URL.revokeObjectURL(u)); tempUrls.clear(); }

  async function migrateLegacyHistory(){
    const raw=localStorage.getItem(LS.legacyHistory); if(!raw) return;
    try{
      const arr=JSON.parse(raw); if(!Array.isArray(arr)) return;
      const existing=await dbAll('history'); const ids=new Set(existing.map(x=>x.id));
      for(const x of arr){ if(x?.id && x?.url && !ids.has(x.id)) await dbPut('history',{id:x.id,url:x.url,prompt:x.prompt||'',size:x.size||'',ratio:x.ratio||'',createdAt:x.createdAt||new Date().toISOString()}); }
      localStorage.removeItem(LS.legacyHistory);
    }catch{}
  }

  async function loadData(){
    await migrateLegacyHistory();
    state.history=(await dbAll('history')).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    state.album=(await dbAll('album')).sort((a,b)=>(a.order??0)-(b.order??0));
    renderCounts(); renderHistory(); renderAlbum();
  }

  function renderCounts(){ $('#historyCount').textContent=state.history.length; $('#albumCount').textContent=state.album.length; }
  function switchTab(tab){ state.tab=tab; $$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab)); $$('.tab-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tab)); if(tab==='history') renderHistory(); if(tab==='album') renderAlbum(); window.scrollTo({top:0,behavior:'smooth'}); }

  function renderRatios(){
    $('#ratioGrid').innerHTML=ratios.map(([v,label])=>`<button type="button" class="ratio ${state.ratio===v?'active':''}" data-ratio="${v}">${label}</button>`).join('');
  }
  function selectedRatio(){ return state.ratio==='original' ? (state.sourceDims ? nearestRatio(state.sourceDims.width,state.sourceDims.height) : '1:1') : state.ratio; }
  function selectedSize(){ const ratio=selectedRatio(); return sizePresets[state.resolution]?.[ratio] || sizePresets[state.resolution]['1:1']; }
  function updateOutputHint(){ const ratio=selectedRatio(),size=selectedSize(); $('#ratioHint').textContent=state.sourceDims?`${state.sourceDims.width} × ${state.sourceDims.height} → ${ratio}`:'上传后自动识别'; if(state.currentResult) $('#resultSubtitle').textContent=`${ratio} · ${size.replace('*',' × ')}`; }

  async function setSource(file){
    if(!file) return; if(file.size>30*1024*1024){toast('原图不能超过 30MB');return;}
    if(!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(file.name)){toast('请选择图片文件');return;}
    const data=await fileToDataUrl(file); state.sourceDataUrl=data; state.sourceName=file.name; state.sourceDims=await imageDims(data); state.currentResult=null;
    $('#uploadEmpty').classList.add('hidden'); $('#sourcePreview').classList.remove('hidden'); $('#sourceOverlay').classList.remove('hidden'); $('#sourcePreview').src=data; $('#sourceMeta').textContent=state.sourceDims?`${state.sourceDims.width} × ${state.sourceDims.height}`:file.name;
    state.ratio='original'; renderRatios(); updateOutputHint(); $('#canvasPlaceholder').classList.remove('hidden'); $('#resultImage').classList.add('hidden'); $('#resultSubtitle').textContent='原图已就绪'; $('#addResultAlbumBtn').classList.add('hidden'); $('#downloadResultBtn').classList.add('hidden');
    if($('#personProtect').checked) analyzePerson();
  }

  function atlasKey(){ return localStorage.getItem(LS.atlas)||''; }
  function deepseekKey(){ return localStorage.getItem(LS.deepseek)||''; }
  function proxyBase(){ return (localStorage.getItem(LS.proxy)||'').replace(/\/$/,''); }
  async function jsonFetch(url,opts={}){ const r=await fetch(url,opts); const data=await r.json().catch(()=>({})); if(!r.ok){ const msg=data?.error?.message||data?.error||data?.message||`请求失败（${r.status}）`; throw new Error(typeof msg==='string'?msg:JSON.stringify(msg)); } return data; }

  async function atlas(action,payload){
    const key=atlasKey(); if(!key) throw new Error('请先保存 AtlasCloud API Key');
    const proxy=proxyBase();
    if(proxy){
      const body=action==='prediction'?{action,id:payload}:{action,payload};
      return jsonFetch(`${proxy}/api/atlas`,{method:'POST',headers:{'Content-Type':'application/json','x-atlas-api-key':key},body:JSON.stringify(body)});
    }
    if(action==='generate') return jsonFetch(`${ATLAS_BASE}/api/v1/model/generateImage`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify(payload)});
    if(action==='prediction') return jsonFetch(`${ATLAS_BASE}/api/v1/model/prediction/${encodeURIComponent(payload)}`,{headers:{'Authorization':`Bearer ${key}`}});
    if(action==='balance') return jsonFetch(`${ATLAS_BASE}/public/v1/balance`,{headers:{'Authorization':`Bearer ${key}`}});
  }

  function personProtectionText(a){
    if(!a?.has_person) return '';
    const parts=['保持人物身份、脸型、五官比例、发型和年龄特征一致，不要换脸。','保持原图人物姿势和身体比例自然，避免额外肢体、手指畸形、关节错位。'];
    if((a.person_count||0)>1) parts.push('多人场景中每个人的肢体归属清楚，避免身体穿插、共用肢体或错误连接。');
    if(a.occlusion) parts.push('保留原图已有的自然遮挡关系，不要擅自补全被遮挡的面部。');
    return parts.join('\n');
  }

  async function analyzePerson(){
    if(!state.sourceDataUrl) return; const key=deepseekKey(); if(!key){ state.analysis=null; $('#analysisStatus').textContent='未填写 DeepSeek Key，将使用基础人物保护'; return; }
    $('#analysisStatus').textContent='DeepSeek 正在识别人脸与人体场景…';
    try{
      const prompt='只返回 JSON，不要 Markdown。分析图片中的人物与人脸：{"has_person":boolean,"person_count":number,"face_count":number,"face_visibility":"clear|partial|hidden|none|unknown","occlusion":boolean,"complex_scene":boolean}';
      const proxy=proxyBase(); let data;
      if(proxy){ data=await jsonFetch(`${proxy}/api/deepseek`,{method:'POST',headers:{'Content-Type':'application/json','x-deepseek-api-key':key},body:JSON.stringify({action:'analyze',image:state.sourceDataUrl})}); data=data.data??data; }
      else {
        data=await jsonFetch(`${DEEPSEEK_BASE}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:state.sourceDataUrl}}]}],temperature:0,response_format:{type:'json_object'}})});
        let txt=data?.choices?.[0]?.message?.content||'{}'; txt=txt.replace(/^```json\s*|```$/g,'').trim(); data=JSON.parse(txt);
      }
      state.analysis=data; $('#analysisStatus').textContent=data.has_person?`${data.person_count||1} 人 · ${data.face_visibility==='clear'?'人脸清晰':data.occlusion?'存在遮挡':'已识别人像'}`:'未检测到人物';
    }catch(e){ state.analysis=null; $('#analysisStatus').textContent='人物分析失败，已使用基础保护'; }
  }

  function buildPrompt(){
    let p=$('#prompt').value.trim(); if(!p) return '';
    if($('#personProtect').checked && (state.analysis?.has_person || /人物|人像|男人|女人|男生|女生|女孩|男孩|person|people|woman|man/i.test(p))){
      const add=personProtectionText(state.analysis)||'保持人物长相、五官、身份与原图一致；保持身体结构、手部和关节自然，不添加多余肢体。'; p+=`\n\n【智能人物保护】\n${add}`;
    }
    return p;
  }

  async function pollPrediction(id){
    let tries=0; while(tries<120){ await new Promise(r=>setTimeout(r,2500)); const raw=await atlas('prediction',id); const d=raw.data??raw; const status=String(d.status||'processing').toLowerCase();
      if(status==='completed'){ if(!d.outputs?.[0]) throw new Error('任务完成，但没有返回结果图片'); return d.outputs[0]; }
      if(status==='failed') throw new Error(typeof d.error==='string'?d.error:'图片处理失败'); tries++; setProgress(Math.min(92,18+tries*2),status==='created'?'任务排队中':'Seedream 正在编辑图片');
    } throw new Error('任务等待超时，请到生成记录稍后查看');
  }
  function setProgress(p,text){ $('#processingBox').classList.toggle('hidden',p<=0||p>=100&&!state.generating); $('#processingText').textContent=text||'正在处理'; $('#progressBar').style.width=`${p}%`; }

  async function persistRemoteImage(item, store){
    try{ const r=await fetch(item.url); if(r.ok){ const blob=await r.blob(); item={...item,blob}; delete item.dataUrl; await dbPut(store,item); return item; } }catch{}
    await dbPut(store,item); return item;
  }

  async function generate(){
    if(state.generating) return; if(!atlasKey()){openApi();toast('先保存 AtlasCloud API Key');return;} if(!state.sourceDataUrl){toast('先上传一张原图');return;} const prompt=buildPrompt(); if(!prompt){toast('写一下你想怎么修改图片');return;}
    state.generating=true; $('#generateBtn').disabled=true; $('#generateBtn').textContent='正在处理…'; $('#canvasPlaceholder').classList.add('hidden'); $('#resultImage').classList.add('hidden'); setProgress(8,'正在提交任务');
    try{
      const payload={model:MODEL,prompt,images:[state.sourceDataUrl],size:selectedSize(),output_format:'png',thinking:$('#thinking').value,prompt_optimization_mode:$('#optimization').value};
      const raw=await atlas('generate',payload), d=raw.data??raw, id=String(d.id||''); if(!id) throw new Error('AtlasCloud 没有返回任务 ID'); setProgress(14,'任务已创建，等待处理');
      const url=await pollPrediction(id); const item={id,url,prompt,size:payload.size,ratio:selectedRatio(),createdAt:new Date().toISOString()}; state.currentResult=item;
      $('#resultImage').src=url; $('#resultImage').classList.remove('hidden'); $('#resultSubtitle').textContent=`${item.ratio} · ${item.size.replace('*',' × ')}`; $('#addResultAlbumBtn').classList.remove('hidden'); $('#downloadResultBtn').classList.remove('hidden');
      setProgress(100,'处理完成'); const stored=await persistRemoteImage(item,'history'); state.history=[stored,...state.history.filter(x=>x.id!==stored.id)]; renderCounts(); toast('图片处理完成');
    }catch(e){ $('#canvasPlaceholder').classList.remove('hidden'); toast(e.message||'处理失败'); }
    finally{ state.generating=false; $('#generateBtn').disabled=false; $('#generateBtn').textContent='开始编辑'; setTimeout(()=>setProgress(0,''),350); }
  }

  async function refreshBalance(){
    if(!atlasKey()){ $('#balanceValue').textContent='--'; return; } $('#balanceValue').textContent='…';
    try{ const raw=await atlas('balance'); const d=raw.data??raw; const v=d.available?.value??d.value; const c=d.available?.currency??d.currency; $('#balanceValue').textContent=v!=null?`${String(c).toLowerCase()==='usd'?'$':''}${Number(v).toFixed(2)}`:'--'; }
    catch{ $('#balanceValue').textContent='--'; toast('余额查询失败'); }
  }

  function historyCard(item){
    const src=trackedSrc(item); return `<article class="media-card" data-id="${escapeHtml(item.id)}"><img class="media-thumb zoomable" src="${escapeHtml(src)}" data-full-src="${escapeHtml(src)}" alt="历史结果" /><div class="media-info"><span class="meta">${escapeHtml(formatTime(item.createdAt))} · ${escapeHtml(item.ratio||'')} ${escapeHtml((item.size||'').replace('*','×'))}</span><span class="prompt-line">${escapeHtml(item.prompt||'')}</span></div><div class="card-actions"><button type="button" data-action="album">加入相册</button><button type="button" data-action="use">查看</button><button type="button" class="danger" data-action="delete">删除</button></div></article>`;
  }
  function renderHistory(){
    revokeTempUrls(); const grid=$('#historyGrid'); grid.innerHTML=state.history.map(historyCard).join(''); $('#historyEmpty').classList.toggle('hidden',state.history.length>0); bindZoomables(grid);
  }

  async function addToAlbumFromItem(item){
    if(state.album.some(x=>x.sourceHistoryId===item.id)){toast('这张图已经在相册里了');return;}
    let blob=item.blob||null; if(!blob && item.url){try{const r=await fetch(item.url);if(r.ok)blob=await r.blob()}catch{}}
    const albumItem={id:uid('album'),sourceHistoryId:item.id,blob,url:blob?'':item.url||'',name:'Seedream 生成图',createdAt:new Date().toISOString(),order:state.album.length?Math.max(...state.album.map(x=>x.order??0))+1:0}; await dbPut('album',albumItem); state.album.push(albumItem); renderCounts(); renderAlbum(); toast('已加入相册');
  }

  async function uploadAlbumFiles(files){
    const arr=[...files]; if(!arr.length)return; let order=state.album.length?Math.max(...state.album.map(x=>x.order??0))+1:0; let added=0;
    for(const f of arr){ if(!f.type.startsWith('image/')&&!/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(f.name))continue; const item={id:uid('album'),blob:f,name:f.name,createdAt:new Date().toISOString(),order:order++}; await dbPut('album',item); state.album.push(item); added++; }
    state.album.sort((a,b)=>(a.order??0)-(b.order??0)); state.albumPage=Math.ceil(state.album.length/ALBUM_PAGE_SIZE)||1; renderCounts(); renderAlbum(); toast(`已上传 ${added} 张图片`);
  }

  function albumCard(item,index){
    const src=trackedSrc(item); return `<article class="media-card" data-id="${escapeHtml(item.id)}"><button class="drag-handle" type="button" aria-label="拖动调整顺序">≡</button><img class="media-thumb zoomable" src="${escapeHtml(src)}" data-full-src="${escapeHtml(src)}" alt="${escapeHtml(item.name||'相册图片')}" /><div class="media-info"><span class="meta">${escapeHtml(item.name||'相册图片')}</span><span class="prompt-line">${escapeHtml(formatTime(item.createdAt))}</span></div><div class="reorder-actions"><button type="button" data-action="left">← 前移</button><button type="button" data-action="right">后移 →</button></div><div class="card-actions"><button type="button" data-action="open">查看</button><button type="button" class="danger" data-action="delete">删除</button></div></article>`;
  }
  function renderAlbum(){
    revokeTempUrls(); const totalPages=Math.max(1,Math.ceil(state.album.length/ALBUM_PAGE_SIZE)); state.albumPage=Math.min(Math.max(1,state.albumPage),totalPages); const start=(state.albumPage-1)*ALBUM_PAGE_SIZE; const visible=state.album.slice(start,start+ALBUM_PAGE_SIZE); const grid=$('#albumGrid'); grid.classList.toggle('arranging',state.arranging); grid.innerHTML=visible.map(albumCard).join(''); $('#albumEmpty').classList.toggle('hidden',state.album.length>0); $('#albumPagination').classList.toggle('hidden',state.album.length<=ALBUM_PAGE_SIZE); $('#pageInfo').textContent=`${state.albumPage} / ${totalPages}`; $('#prevPageBtn').disabled=state.albumPage<=1; $('#nextPageBtn').disabled=state.albumPage>=totalPages; $('#arrangeTip').classList.toggle('hidden',!state.arranging); $('#toggleArrangeBtn').textContent=state.arranging?'完成整理':'整理顺序'; bindZoomables(grid); bindAlbumDrag();
  }
  async function normalizeAlbumOrder(){ state.album.forEach((x,i)=>x.order=i); await Promise.all(state.album.map(x=>dbPut('album',x))); }
  async function moveAlbum(id,delta){ const i=state.album.findIndex(x=>x.id===id); const j=i+delta; if(i<0||j<0||j>=state.album.length)return; [state.album[i],state.album[j]]=[state.album[j],state.album[i]]; await normalizeAlbumOrder(); renderAlbum(); }
  async function reorderAlbum(dragId,targetId){ if(!dragId||!targetId||dragId===targetId)return; const from=state.album.findIndex(x=>x.id===dragId),to=state.album.findIndex(x=>x.id===targetId); if(from<0||to<0)return; const [m]=state.album.splice(from,1); state.album.splice(to,0,m); await normalizeAlbumOrder(); renderAlbum(); }

  function bindAlbumDrag(){
    if(!state.arranging)return; const grid=$('#albumGrid');
    $$('.media-card',grid).forEach(card=>{
      const handle=$('.drag-handle',card); let active=false;
      handle.addEventListener('pointerdown',e=>{ active=true; state.dragId=card.dataset.id; card.classList.add('dragging'); handle.setPointerCapture?.(e.pointerId); e.preventDefault(); });
      handle.addEventListener('pointermove',e=>{ if(!active)return; const el=document.elementFromPoint(e.clientX,e.clientY)?.closest?.('.media-card'); if(el&&el!==card) el.dataset.dragTarget='1'; });
      handle.addEventListener('pointerup',async e=>{ if(!active)return; active=false; card.classList.remove('dragging'); const target=document.elementFromPoint(e.clientX,e.clientY)?.closest?.('.media-card'); const drag=state.dragId; state.dragId=null; if(target) await reorderAlbum(drag,target.dataset.id); });
      handle.addEventListener('pointercancel',()=>{active=false;card.classList.remove('dragging');state.dragId=null;});
    });
  }

  function openLightbox(src){ const dlg=$('#lightbox'); const img=$('#lightboxImage'); img.src=src; img.classList.remove('zoomed'); if(!dlg.open) dlg.showModal(); }
  function bindZoomables(root=document){ $$('.zoomable',root).forEach(img=>{ img.addEventListener('click',()=>openLightbox(img.dataset.fullSrc||img.src)); img.addEventListener('dblclick',e=>{e.preventDefault();openLightbox(img.dataset.fullSrc||img.src);$('#lightboxImage').classList.add('zoomed');}); }); }
  function bindDoubleTap(el,fn){ let last=0; el.addEventListener('pointerup',e=>{ if(e.pointerType==='mouse') return; const now=Date.now(); if(now-last<330){e.preventDefault();fn();last=0}else last=now;}); }

  async function downloadUrl(url,name='seedream.png'){
    try{const r=await fetch(url);if(!r.ok)throw 0;const blob=await r.blob();const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}catch{window.open(url,'_blank','noopener,noreferrer');toast('图片已打开，手机可长按保存');}
  }

  function openApi(){ $('#atlasKeyInput').value=atlasKey(); $('#deepseekKeyInput').value=deepseekKey(); $('#proxyBaseInput').value=proxyBase(); $('#apiModal').showModal(); }
  function saveKeys(){ const a=$('#atlasKeyInput').value.trim(),d=$('#deepseekKeyInput').value.trim(),p=$('#proxyBaseInput').value.trim().replace(/\/$/,''); a?localStorage.setItem(LS.atlas,a):localStorage.removeItem(LS.atlas); d?localStorage.setItem(LS.deepseek,d):localStorage.removeItem(LS.deepseek); p?localStorage.setItem(LS.proxy,p):localStorage.removeItem(LS.proxy); $('#apiModal').close(); toast('API 设置已保存在这台设备'); refreshBalance(); if(state.sourceDataUrl&&d)analyzePerson(); }

  function bindEvents(){
    $$('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
    $('#apiBtn').addEventListener('click',openApi); $('#saveKeysBtn').addEventListener('click',saveKeys); $('#clearKeysBtn').addEventListener('click',()=>{localStorage.removeItem(LS.atlas);localStorage.removeItem(LS.deepseek);localStorage.removeItem(LS.proxy);$('#atlasKeyInput').value='';$('#deepseekKeyInput').value='';$('#proxyBaseInput').value='';toast('已清除 API 设置');}); $('#balanceBtn').addEventListener('click',refreshBalance);
    $('#editorFile').addEventListener('change',e=>setSource(e.target.files?.[0])); const dz=$('#editorDropZone'); ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('dragover')})); ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('dragover')})); dz.addEventListener('drop',e=>setSource(e.dataTransfer.files?.[0]));
    $('#prompt').addEventListener('input',e=>$('#promptCount').textContent=`${e.target.value.length} 字`); $$('.quick-prompts button').forEach(b=>b.addEventListener('click',()=>{const p=$('#prompt');p.value=b.dataset.prompt; p.dispatchEvent(new Event('input'));}));
    $('#ratioGrid').addEventListener('click',e=>{const b=e.target.closest('[data-ratio]');if(!b)return;state.ratio=b.dataset.ratio;renderRatios();updateOutputHint();}); $$('.resolution').forEach(b=>b.addEventListener('click',()=>{state.resolution=b.dataset.resolution;$$('.resolution').forEach(x=>x.classList.toggle('active',x===b));updateOutputHint();})); $('#personProtect').addEventListener('change',()=>{if($('#personProtect').checked&&state.sourceDataUrl)analyzePerson();}); $('#generateBtn').addEventListener('click',generate);
    $('#downloadResultBtn').addEventListener('click',()=>state.currentResult&&downloadUrl(state.currentResult.url)); $('#addResultAlbumBtn').addEventListener('click',()=>state.currentResult&&addToAlbumFromItem(state.currentResult));
    $('#historyGrid').addEventListener('click',async e=>{const btn=e.target.closest('[data-action]');if(!btn)return;const card=e.target.closest('.media-card'),item=state.history.find(x=>x.id===card?.dataset.id);if(!item)return;const a=btn.dataset.action;if(a==='album')await addToAlbumFromItem(item);if(a==='use')openLightbox(trackedSrc(item));if(a==='delete'&&confirm('删除这条生成记录？')){await dbDelete('history',item.id);state.history=state.history.filter(x=>x.id!==item.id);renderCounts();renderHistory();}});
    $('#clearHistoryBtn').addEventListener('click',async()=>{if(!state.history.length)return;if(confirm('清空全部生成记录？相册里的图片不会被删除。')){await dbClear('history');state.history=[];renderCounts();renderHistory();toast('生成记录已清空');}});
    $('#albumUpload').addEventListener('change',e=>{uploadAlbumFiles(e.target.files);e.target.value='';}); $('#toggleArrangeBtn').addEventListener('click',()=>{state.arranging=!state.arranging;renderAlbum();});
    $('#albumGrid').addEventListener('click',async e=>{if(e.target.closest('.drag-handle'))return;const btn=e.target.closest('[data-action]');if(!btn)return;const card=e.target.closest('.media-card'),id=card?.dataset.id,item=state.album.find(x=>x.id===id);if(!item)return;const a=btn.dataset.action;if(a==='open')openLightbox(trackedSrc(item));if(a==='delete'&&confirm('从相册删除这张图片？')){await dbDelete('album',id);state.album=state.album.filter(x=>x.id!==id);await normalizeAlbumOrder();renderCounts();renderAlbum();}if(a==='left')await moveAlbum(id,-1);if(a==='right')await moveAlbum(id,1);});
    $('#prevPageBtn').addEventListener('click',()=>{state.albumPage--;renderAlbum();window.scrollTo({top:0,behavior:'smooth'})}); $('#nextPageBtn').addEventListener('click',()=>{state.albumPage++;renderAlbum();window.scrollTo({top:0,behavior:'smooth'})});
    $('#lightboxClose').addEventListener('click',()=>$('#lightbox').close()); $('#lightbox').addEventListener('click',e=>{if(e.target===$('#lightbox'))$('#lightbox').close();}); const lb=$('#lightboxImage'); const toggleZoom=()=>lb.classList.toggle('zoomed'); lb.addEventListener('dblclick',e=>{e.preventDefault();toggleZoom()}); bindDoubleTap(lb,toggleZoom);
  }

  async function init(){ renderRatios(); bindEvents(); await loadData(); refreshBalance(); bindZoomables(); }
  document.addEventListener('album-review-changed',e=>{
    const item=state.album.find(x=>x.id===e.detail?.id);if(!item)return;
    const review=String(e.detail?.review||'').trim();if(review)item.review=review;else delete item.review;
  });
  window.addEventListener('beforeunload',revokeTempUrls); init().catch(e=>{console.error(e);toast('页面初始化失败，请刷新重试');});
})();

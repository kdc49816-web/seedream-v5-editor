const MODEL='bytedance/seedream-v5.0-pro/edit';
const VISION_MODEL='deepseek-v4-flash-vision-exp';
const KEY_ATLAS='seedream-atlas-api-key', KEY_DS='seedream-deepseek-api-key', KEY_HIST='seedream-edit-history';
const PRESETS={
 custom:'',
 enhance:'在不改变原图主体、构图、色彩关系和内容的前提下，提升画面清晰度与细节表现。修复轻微模糊、噪点和压缩痕迹，保持纹理自然，不要过度锐化，不要添加原图中不存在的元素。',
 stylize:'将原图转化为精致、统一的现代视觉风格，保留主体身份、姿态与原始构图。强化光影层次、材质细节和色彩氛围，画面高级自然，不要改变关键内容。',
 'remove-bg':'移除原图背景，只保留完整的前景主体。主体边缘要干净、自然、细节完整，背景替换为纯净白色，不要添加阴影、文字或其他元素。'
};
const SIZES={
 '1:1':[['1K','1024*1024'],['1.5K','1536*1536'],['2K','2048*2048']],
 '16:9':[['1.5K','2048*1152'],['2K','2720*1530']], '9:16':[['1.5K','1152*2048'],['2K','1530*2720']],
 '4:3':[['1.5K','1776*1328'],['2K','2304*1728']], '3:4':[['1.5K','1328*1776'],['2K','1728*2304']],
 '2:3':[['2K','1664*2496']], '3:2':[['2K','2496*1664']]
};
const $=id=>document.getElementById(id);
const state={image:'',fileName:'',vision:null,visionRaw:null,faceCrop:'',result:'',history:loadHistory(),busy:false};
let toastTimer;
function toast(msg,type=''){const el=$('toast');el.textContent=msg;el.className='toast'+(type?` ${type}`:'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),3500)}
function key(type){return localStorage.getItem(type==='atlas'?KEY_ATLAS:KEY_DS)||''}
function fmtMoney(v,c='USD'){const n=Number(v);if(!Number.isFinite(n))return '--';return `${String(c).toUpperCase()==='CNY'?'¥':'$'}${n.toFixed(2)}`}
function normalize(data){return data?.data??data}
async function post(url,keyHeader,keyValue,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',[keyHeader]:keyValue},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(j.error||`请求失败（${r.status}）`),{payload:j,status:r.status});return j}
function loadHistory(){try{return JSON.parse(localStorage.getItem(KEY_HIST)||'[]')}catch{return[]}}
function saveHistory(){localStorage.setItem(KEY_HIST,JSON.stringify(state.history.slice(0,12)))}
function renderHistory(){const box=$('history');box.innerHTML='';state.history.forEach(item=>{const b=document.createElement('button');b.className='history-item';b.type='button';b.title='点击查看';b.innerHTML=`<img alt="历史生成" src="${item.url}">`;b.addEventListener('click',()=>showResult(item.url));box.appendChild(b)})}
function initSizes(){const ratio=$('ratio');Object.keys(SIZES).forEach(r=>ratio.add(new Option(r,r)));ratio.value='1:1';ratio.addEventListener('change',renderSizes);renderSizes()}
function renderSizes(){const size=$('size');size.innerHTML='';SIZES[$('ratio').value].forEach(([label,val])=>size.add(new Option(`${label} · ${val}`,val)))}
function setPrompt(text){$('prompt').value=text;$('promptCount').textContent=`${text.length} 字`;updateSentContent()}
function setupPresets(){$('presets').addEventListener('click',e=>{const b=e.target.closest('button[data-preset]');if(!b)return;[...$('presets').children].forEach(x=>x.classList.toggle('active',x===b));setPrompt(PRESETS[b.dataset.preset]||'')});$('prompt').addEventListener('input',e=>{$('promptCount').textContent=`${e.target.value.length} 字`;updateSentContent()})}
function setupUpload(){const input=$('fileInput'),area=$('uploadArea');area.addEventListener('click',()=>input.click());input.addEventListener('change',()=>input.files[0]&&readFile(input.files[0]));['dragenter','dragover'].forEach(n=>area.addEventListener(n,e=>{e.preventDefault();area.style.borderColor='var(--lime)'}));['dragleave','drop'].forEach(n=>area.addEventListener(n,e=>{e.preventDefault();area.style.borderColor=''}));area.addEventListener('drop',e=>e.dataTransfer.files[0]&&readFile(e.dataTransfer.files[0]))}
function readFile(file){if(!/^image\/(jpeg|png|webp|gif)$/.test(file.type)){toast('请选择 JPEG、PNG、WebP 或 GIF 图片。','error');return}if(file.size>30*1024*1024){toast('原图不能超过 30MB。','error');return}const r=new FileReader();r.onload=()=>{state.image=String(r.result);state.fileName=file.name;$('previewImg').src=state.image;$('fileName').textContent=file.name;$('fileSize').textContent=`${(file.size/1024/1024).toFixed(2)} MB`;$('uploadEmpty').classList.add('hidden');$('uploadPreview').classList.remove('hidden');resetVision('等待智能分析');if(key('ds')&&$('personProtect').checked)testVision();};r.onerror=()=>toast('图片读取失败。','error');r.readAsDataURL(file)}
function resetVision(msg='等待上传图片'){state.vision=null;state.visionRaw=null;state.faceCrop='';$('visionDot').className='dot idle';$('visionStatus').textContent=msg;$('visionTiming').textContent='--';$('visionSummary').textContent=msg;$('visionSummary').classList.add('muted');$('visionFacts').classList.add('hidden');$('visionFacts').innerHTML='';$('rawBtn').disabled=true;$('rawBox').classList.add('hidden');$('rawBox').textContent='';updateProtectionUI()}
function fact(label,val){return `<span>${label}<b>${val}</b></span>`}
function protectionEnabled(){return !!$('personProtect')?.checked}
function protectionText(){
  if(!protectionEnabled())return '';
  const identity=$('keepIdentity')?.checked;
  const structure=$('keepFaceStructure')?.checked;
  const enhanced=$('enhancedFace')?.checked&&!!state.faceCrop;
  const v=state.vision;
  const parts=[];
  if(v?.has_person){
    const scene=[`检测到约 ${v.person_count||1} 人`,v.face_visibility==='clear'?'主要人脸清晰可见':v.face_visibility==='hidden'?'主要人脸不可见':'主要人脸存在不完整或遮挡',v.phone_covering_face?'存在手机挡脸':'',v.occlusion_description||'',v.complex_scene?'多人或复杂场景':''].filter(Boolean).join('；');
    parts.push(scene+'。');
  }else if(v && !v.has_person){
    return '';
  }else{
    parts.push('若原图中包含人物，则执行以下人物保护规则。');
  }
  if(identity)parts.push('严格保持原图人物身份、五官辨识特征、发型、年龄感、肤色与整体长相一致，不要把人物改成另一张脸。');
  if(structure)parts.push('保持脸型、五官位置与比例、头部朝向、身体姿态和服装主体结构稳定，避免面部重绘造成结构漂移。');
  if(v?.phone_covering_face||v?.occlusion)parts.push('原图存在遮挡时，不要凭空补造被遮挡的脸部细节，也不要擅自移除遮挡物，除非用户指令明确要求。');
  parts.push('不要无故增加、删除或合并人物。');
  if(enhanced)parts.push('第二张参考图是从原图自动截取的主脸近景，仅用于加强身份与长相一致性；编辑结果仍以第一张完整原图的构图、姿态和场景为准。');
  return parts.join('\n');
}
function protectPrompt(prompt){const p=protectionText();return p?`${prompt}\n\n【智能人物保护】\n${p}`:prompt}
function updateSentContent(){
  const p=$('prompt')?.value.trim()||'';
  const final=p?protectPrompt(p):'';
  const count=state.image?(($('enhancedFace')?.checked&&state.faceCrop)?2:1):0;
  if($('sentMeta'))$('sentMeta').textContent=state.image?`将发送 ${count} 张参考图${count===2?'（原图 + 主脸近景）':''} · 人物保护${protectionEnabled()?'已开启':'已关闭'}`:'等待上传图片';
  if($('sentPrompt'))$('sentPrompt').textContent=final||'填写修改要求后，这里会显示真正发送给 Seedream 的最终提示词。';
}
function updateProtectionUI(){
  const enabled=protectionEnabled();
  $('protectCard')?.classList.toggle('disabled',!enabled);
  ['keepIdentity','keepFaceStructure'].forEach(id=>{if($(id))$(id).disabled=!enabled});
  const v=state.vision;
  const clear=enabled&&!!state.faceCrop&&v?.has_person&&v?.face_visibility==='clear';
  if($('enhancedFace')){$('enhancedFace').disabled=!clear;if(!clear)$('enhancedFace').checked=false;}
  if($('enhancedFaceHint'))$('enhancedFaceHint').textContent=clear?'已检测到清晰主脸，可开启':'检测到清晰人脸时可用';
  if($('protectStatus')){
    if(!enabled)$('protectStatus').textContent='智能保护已关闭';
    else if(!state.image)$('protectStatus').textContent='上传图片后自动判断';
    else if(v?.has_person)$('protectStatus').textContent=`${v.person_count||1} 人 · ${v.face_visibility==='clear'?'人脸清晰':v.occlusion?'人脸有遮挡':'人脸不完整'}`;
    else if(v)$('protectStatus').textContent='未检测到人物，本次不添加人物保护';
    else $('protectStatus').textContent=key('ds')?'等待智能分析':'填写 DeepSeek Key 后自动识别人脸';
  }
  updateSentContent();
}
async function cropPrimaryFace(dataUrl,box){
  if(!dataUrl||!box)return '';
  const img=new Image();
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=dataUrl});
  let {x1,y1,x2,y2}=box;
  if([x1,y1,x2,y2].some(x=>!Number.isFinite(Number(x))))return '';
  x1=Number(x1)/1000*img.naturalWidth;y1=Number(y1)/1000*img.naturalHeight;x2=Number(x2)/1000*img.naturalWidth;y2=Number(y2)/1000*img.naturalHeight;
  let w=Math.max(1,x2-x1),h=Math.max(1,y2-y1);const pad=Math.max(w,h)*.45;
  const sx=Math.max(0,x1-pad),sy=Math.max(0,y1-pad),ex=Math.min(img.naturalWidth,x2+pad),ey=Math.min(img.naturalHeight,y2+pad);
  w=ex-sx;h=ey-sy;if(w<8||h<8)return '';
  const canvas=document.createElement('canvas');const max=768;const scale=Math.min(1,max/Math.max(w,h));canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  canvas.getContext('2d').drawImage(img,sx,sy,w,h,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.92);
}
async function testVision(){const ds=key('ds');if(!ds){openSettings();toast('先保存 DeepSeek API Key。','error');return}if(!state.image){toast('先上传一张图片。','error');return}$('visionDot').className='dot loading';$('visionStatus').textContent='分析中…';$('visionSummary').textContent='DeepSeek 正在读取这张图片。';$('visionSummary').classList.remove('muted');$('testVisionBtn').disabled=true;const t=performance.now();try{const out=await post('/api/deepseek','x-deepseek-api-key',ds,{action:'analyze',image:state.image});state.vision=out.data;state.visionRaw=out;state.faceCrop='';try{if(state.vision?.primary_face_box&&state.vision?.face_visibility==='clear')state.faceCrop=await cropPrimaryFace(state.image,state.vision.primary_face_box)}catch{}const m=out.meta||{},actual=m.actual_model||'(返回未标注)';$('visionDot').className='dot success';$('visionStatus').textContent='分析成功';$('visionTiming').textContent=`${((m.elapsed_ms??(performance.now()-t))/1000).toFixed(2)}s · HTTP ${m.http_status??200}`;$('visionSummary').textContent=`实际返回模型：${actual}。${state.vision.summary||'图片已被模型读取并返回结构化结果。'}`;const v=state.vision;$('visionFacts').innerHTML=[fact('人数',v.person_count??0),fact('人脸',v.face_count??0),fact('可见度',v.face_visibility||'unknown'),fact('手机挡脸',v.phone_covering_face?'是':'否'),fact('其他遮挡',v.occlusion?'是':'否'),fact('复杂场景',v.complex_scene?'是':'否')].join('');$('visionFacts').classList.remove('hidden');$('rawBtn').disabled=false;updateProtectionUI();toast('DeepSeek 视觉模型分析成功。','success')}catch(e){state.vision=null;state.visionRaw=e.payload||{error:e.message};state.faceCrop='';$('visionDot').className='dot error';$('visionStatus').textContent='分析失败';$('visionTiming').textContent=`HTTP ${e.status||'--'}`;$('visionSummary').textContent=e.message;$('rawBtn').disabled=false;updateProtectionUI();toast(e.message,'error')}finally{$('testVisionBtn').disabled=false}}
async function refreshAtlas(){const k=key('atlas');if(!k){$('atlasState').textContent='未保存 AtlasCloud Key';return}setText('atlasState','查询中…');try{const d=normalize(await post('/api/atlas','x-atlas-api-key',k,{action:'balance'}));const c=d.available?.currency||'usd';setText('atlasTotal',fmtMoney(d.available?.value,c));setText('atlasCash',fmtMoney(d.cash?.value,c));setText('atlasBonus',fmtMoney(d.bonus?.value,c));setText('atlasState','余额查询成功');$('atlasBalanceTop').querySelector('b').textContent=fmtMoney(d.available?.value,c)}catch(e){setText('atlasState',e.message);toast(e.message,'error')}}
async function refreshDeepseek(){const k=key('ds');if(!k){$('dsState').textContent='未保存 DeepSeek Key';return}setText('dsState','查询中…');try{const out=await post('/api/deepseek','x-deepseek-api-key',k,{action:'balance'});const d=out.data;const info=(d.balance_infos||[])[0];if(!info)throw new Error('余额接口没有返回 balance_infos。');const c=info.currency||'CNY';setText('dsTotal',fmtMoney(info.total_balance,c));setText('dsTopup',fmtMoney(info.topped_up_balance,c));setText('dsGrant',fmtMoney(info.granted_balance,c));setText('dsState',d.is_available?'可调用':'当前余额不足或不可用')}catch(e){setText('dsState',e.message);toast(e.message,'error')}}
function setText(id,t){$(id).textContent=t}
async function generate(){const k=key('atlas');if(!k){openSettings();toast('先保存 AtlasCloud API Key。','error');return}if(!state.image){toast('先上传一张原图。','error');return}const prompt=$('prompt').value.trim();if(!prompt){toast('写一下你想怎么修改图片。','error');return}if(state.busy)return;state.busy=true;$('generateBtn').disabled=true;$('progressWrap').classList.remove('hidden');setProgress(7,'正在提交任务');try{const refs=($('enhancedFace')?.checked&&state.faceCrop)?[state.image,state.faceCrop]:[state.image];const payload={model:MODEL,prompt:protectPrompt(prompt),images:refs,size:$('size').value,output_format:'png',thinking:$('thinking').checked?'enabled':'disabled',prompt_optimization_mode:'standard'};const created=normalize(await post('/api/atlas','x-atlas-api-key',k,{action:'generate',payload}));const id=created.id;if(!id)throw new Error('AtlasCloud 没有返回任务 ID。');setProgress(14,'任务已创建');const url=await poll(id,k);showResult(url);state.history=[{id,url,prompt,createdAt:new Date().toISOString()},...state.history.filter(x=>x.id!==id)].slice(0,12);saveHistory();renderHistory();setProgress(100,'处理完成');toast('图片处理完成。','success');refreshAtlas()}catch(e){setProgress(0,e.message);toast(e.message,'error')}finally{state.busy=false;$('generateBtn').disabled=false}}
async function poll(id,k){let count=0;for(;;){await new Promise(r=>setTimeout(r,2500));const d=normalize(await post('/api/atlas','x-atlas-api-key',k,{action:'prediction',id}));const st=String(d.status||'processing').toLowerCase();if(st==='completed'||st==='succeeded'){if(!d.outputs?.[0])throw new Error('任务完成但没有结果图片。');return d.outputs[0]}if(st==='failed')throw new Error(typeof d.error==='string'?d.error:'图片处理失败。');count++;setProgress(Math.min(92,17+count*3),st==='created'?'任务排队中':'Seedream 正在编辑图片')}}
function setProgress(v,txt){$('progress').value=v;$('progressPct').textContent=`${v}%`;$('progressText').textContent=txt}
function showResult(url){state.result=url;$('resultImg').src=url;$('resultImg').classList.remove('hidden');$('resultStage').querySelector('.empty-result')?.classList.add('hidden');$('downloadBtn').disabled=false}
async function download(){if(!state.result)return;try{const r=await fetch(state.result);if(!r.ok)throw 0;const b=await r.blob();const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=`seedream-${Date.now()}.png`;a.click();URL.revokeObjectURL(u)}catch{window.open(state.result,'_blank','noopener,noreferrer');toast('结果已在新窗口打开，手机可长按保存。')}}
function openSettings(){$('atlasKey').value=key('atlas');$('deepseekKey').value=key('ds');$('settingsModal').classList.remove('hidden')}
function closeSettings(){$('settingsModal').classList.add('hidden')}
function setupSettings(){$('settingsBtn').onclick=openSettings;$('closeSettings').onclick=closeSettings;$('settingsModal').addEventListener('click',e=>{if(e.target===$('settingsModal'))closeSettings()});document.querySelectorAll('[data-eye]').forEach(b=>b.onclick=()=>{const i=$(b.dataset.eye);i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'显示':'隐藏'});$('saveKeys').onclick=()=>{const a=$('atlasKey').value.trim(),d=$('deepseekKey').value.trim();a?localStorage.setItem(KEY_ATLAS,a):localStorage.removeItem(KEY_ATLAS);d?localStorage.setItem(KEY_DS,d):localStorage.removeItem(KEY_DS);closeSettings();toast('API Key 已保存在当前设备。','success');refreshAtlas();refreshDeepseek();if(d&&state.image&&$('personProtect').checked)testVision()};$('clearKeys').onclick=()=>{localStorage.removeItem(KEY_ATLAS);localStorage.removeItem(KEY_DS);$('atlasKey').value='';$('deepseekKey').value='';resetVision('填写 DeepSeek Key 后可测试视觉模型');setText('atlasTotal','--');setText('dsTotal','--');toast('已清除保存的 API Key。','success')}}
function setupProtection(){
  ['personProtect','keepIdentity','keepFaceStructure','enhancedFace'].forEach(id=>$(id)?.addEventListener('change',()=>{updateProtectionUI();updateSentContent()}));
  $('sentContentBtn')?.addEventListener('click',()=>{const box=$('sentContentBox');const open=box.classList.toggle('hidden')===false;$('sentContentBtn').classList.toggle('open',open);updateSentContent()});
  updateProtectionUI();
}
function init(){initSizes();setupPresets();setupUpload();setupSettings();setupProtection();renderHistory();$('testVisionBtn').onclick=testVision;$('rawBtn').onclick=()=>{const b=$('rawBox');b.classList.toggle('hidden');b.textContent=JSON.stringify(state.visionRaw,null,2)};$('refreshAtlas').onclick=refreshAtlas;$('refreshDeepseek').onclick=refreshDeepseek;$('atlasBalanceTop').onclick=refreshAtlas;$('generateBtn').onclick=generate;$('downloadBtn').onclick=download;$('clearHistory').onclick=()=>{state.history=[];saveHistory();renderHistory();toast('历史记录已清空。','success')};if(key('atlas'))refreshAtlas();if(key('ds'))refreshDeepseek();if(!key('atlas')&&!key('ds'))setTimeout(openSettings,250)}
init();

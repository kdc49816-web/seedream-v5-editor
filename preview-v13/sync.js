(() => {
'use strict';
const CLOUD='https://seedream-v5-editor.kdc425.chatgpt.site',GITHUB='https://kdc49816-web.github.io';
const hosted=location.hostname==='seedream-v5-editor.kdc425.chatgpt.site'||location.hostname==='localhost'||location.hostname==='127.0.0.1';
const $=s=>document.querySelector(s),api=()=>window.seedream;
let user=null,busy=false,again=false,timer,applying=false;
const note=text=>{$('#syncStatus').textContent=text};
const request=async(path,options={})=>{const r=await fetch('/api/studio/'+path,{...options,credentials:'same-origin'});const body=await r.json();if(!r.ok){const e=Error(body.error||'同步失败');e.status=r.status;throw e}return body};
function openDB(name){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{for(const s of ['history','album'])if(!r.result.objectStoreNames.contains(s))r.result.createObjectStore(s,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function records(name,items){const db=await openDB(name);try{return await new Promise((resolve,reject)=>{const tx=db.transaction('album',items?'readwrite':'readonly'),store=tx.objectStore('album');let output=[];if(items)items.forEach(x=>store.put(x));else{const r=store.getAll();r.onsuccess=()=>output=r.result}tx.oncomplete=()=>resolve(output);tx.onerror=tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
async function adoptGuest(id){if(localStorage.getItem('seedream-guest-migrated'))return;const old=await records('seedream-studio-db');await records('seedream-studio-db-'+id,old);localStorage.setItem('seedream-guest-migrated',id)}
function ui(){const active=!!user;$('#accountBtn').textContent=user?'相册账号':'登录';$('#accountTitle').textContent=user?user.username:'登录相册';$('#accountFields').classList.toggle('hidden',active);for(const id of ['loginBtn','registerBtn'])$('#'+id).classList.toggle('hidden',active);for(const id of ['logoutBtn','syncBtn'])$('#'+id).classList.toggle('hidden',!active)}
function schedule(){if(applying||!user)return;clearTimeout(timer);timer=setTimeout(sync,800)}
function deletedKey(){return 'seedream-deleted-'+(user?.id||localStorage.getItem('seedream-account-id')||'guest')}
const deletes=()=>{try{return JSON.parse(localStorage.getItem(deletedKey())||'[]')}catch{return []}};
const fingerprint=item=>JSON.stringify([item.name,item.prompt,item.userPrompt,item.review,item.order,item.createdAt,item.blob?.size]);
async function sync(){
 if(!hosted||!user)return;if(busy){again=true;return}busy=true;note('正在同步…');let pending=0,changed=false;
 try{
  for(const id of deletes()){await request('album/'+encodeURIComponent(id),{method:'DELETE'});localStorage.setItem(deletedKey(),JSON.stringify(deletes().filter(x=>x!==id)))}
  const remote=(await request('album')).items,byId=new Map(remote.map(x=>[x.id,x])),local=await api().dbAll('album');
  for(const item of local){
   const cloud=byId.get(item.id),dirty=item._syncedFingerprint!==fingerprint(item);
   if(cloud?.deleted){applying=true;await api().dbDelete('album',item.id);applying=false;changed=true;continue}
   if(cloud&&Number(cloud.revision)>Number(item._cloudRevision||0)&&item._cloudRevision){continue}
   if(!dirty&&cloud)continue;
   if(!item.blob){pending++;continue}
   const form=new FormData();form.append('image',item.blob,item.name||'image.png');form.append('metadata',JSON.stringify({...item,blob:undefined,url:undefined,revision:item._cloudRevision||0}));
   try{const saved=await request('album/'+encodeURIComponent(item.id),item._cloudRevision&&cloud?{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,blob:undefined,url:undefined,revision:item._cloudRevision})}:{method:'PUT',body:form});item._cloudRevision=saved.revision;item._syncedFingerprint=fingerprint(item);applying=true;const updated=await api().dbUpdate('album',item.id,current=>({...current,_cloudRevision:item._cloudRevision,_syncedFingerprint:item._syncedFingerprint}));if(updated)api().acceptSync(updated);applying=false;byId.delete(item.id)}catch(e){if(e.status!==409)throw e;pending++}
  }
  for(const remoteItem of byId.values()){
   if(remoteItem.deleted||deletes().includes(remoteItem.id))continue;const old=local.find(x=>x.id===remoteItem.id);if(old&&Number(old._cloudRevision)===Number(remoteItem.revision))continue;
   const r=await fetch('/api/studio/album/'+encodeURIComponent(remoteItem.id),{credentials:'same-origin'});if(!r.ok)throw Error('有图片暂时无法下载，请重试');const blob=await r.blob();
   const item={...remoteItem,blob,url:'',_cloudRevision:remoteItem.revision};delete item.revision;delete item.deleted;item._syncedFingerprint=fingerprint(item);applying=true;await api().dbPut('album',item);applying=false;changed=true;
  }
  if(changed)document.dispatchEvent(new Event('album-cloud-loaded'));note(pending?'还有 '+pending+' 张待保存或同步，可稍后重试':'相册已同步 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));
 }catch(e){note(e.message);if(e.status===401){user=null;ui()}}
 finally{applying=false;busy=false;if(again){again=false;schedule()}}
}
async function login(action){
 $('#loginBtn').disabled=$('#registerBtn').disabled=true;note('正在登录…');
 try{const next=await request('auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,username:$('#username').value,password:$('#password').value})});$('#password').value='';await adoptGuest(next.id);localStorage.setItem('seedream-account-id',next.id);location.reload()}catch(e){note(e.message)}finally{$('#loginBtn').disabled=$('#registerBtn').disabled=false}
}
let cloudWindow,importQueue=Promise.resolve();const importAcks=new Map();
$('#accountBtn').addEventListener('click',()=>{if(hosted){$('#accountModal').showModal();return}cloudWindow=window.open(CLOUD+'/studio/?import=1','seedream-cloud');if(!cloudWindow)api().toast('请允许打开登录窗口，或导出相册后在云端导入')});
$('#backupSettingsBtn').onclick=()=>{$('#apiModal').close();$('#accountModal').showModal()};
$('#closeAccount').onclick=()=>$('#accountModal').close();
$('#accountForm').onsubmit=e=>{e.preventDefault();login('login')};$('#registerBtn').onclick=()=>login('register');$('#syncBtn').onclick=sync;
$('#logoutBtn').onclick=async()=>{if(busy){note('正在同步，请稍后退出');return}try{await request('auth',{method:'DELETE'});localStorage.removeItem('seedream-account-id');location.reload()}catch(e){note(e.message)}};
document.addEventListener('album-local-write',schedule);document.addEventListener('album-review-changed',()=>{schedule()});
document.addEventListener('album-local-delete',e=>{if(applying)return;localStorage.setItem(deletedKey(),JSON.stringify([...new Set([...deletes(),e.detail.id])]));schedule()});
window.addEventListener('online',schedule);document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()});
$('#exportAlbum').onclick=async()=>{try{note('正在准备备份…');const items=await api().dbAll('album');const files=[];for(const item of items){let data='';if(item.blob)data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(item.blob)});files.push({...item,blob:undefined,data,_cloudRevision:undefined,_syncedFingerprint:undefined})}const blob=new Blob([JSON.stringify({format:'seedream-album-1',items:files})],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='seedream-album-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);note('备份已准备好')}catch(e){note(e.message)}};
$('#importAlbum').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;const data=JSON.parse(await file.text());if(data.format!=='seedream-album-1'||!Array.isArray(data.items))throw Error('不是有效的相册备份');const existing=new Set((await api().dbAll('album')).map(x=>x.id));for(const raw of data.items){if(!/^[a-zA-Z0-9._:-]{1,200}$/.test(raw.id)||existing.has(raw.id))continue;const item={...raw};if(typeof raw.data==='string'&&/^data:image\/(png|jpeg|webp|gif|avif|heic|heif|bmp|tiff);base64,/.test(raw.data)){item.blob=await(await fetch(raw.data)).blob();if(item.blob.size>40*1024*1024)throw Error('备份中有图片超过40MB')}else if(!raw.url)continue;delete item.data;delete item._cloudRevision;delete item._syncedFingerprint;await api().dbPut('album',item)}document.dispatchEvent(new Event('album-cloud-loaded'));note('备份已导入');schedule()}catch(e){note(e.message)}finally{e.target.value=''}};
// The old origin retains all originals. Transfer only on the user's login action,
// only between these two known origins, and never pass keys or passwords.
window.addEventListener('message',async e=>{
 if(!hosted&&e.origin===CLOUD&&e.source===cloudWindow&&e.data?.type==='seedream-import-ack'){importAcks.get(e.data.id)?.();importAcks.delete(e.data.id);return}
 if(!hosted&&e.origin===CLOUD&&e.source===cloudWindow&&e.data?.type==='seedream-import-ready'){
  try{const items=await api().dbAll('album');for(const item of items){await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{importAcks.delete(item.id);reject(Error('迁移超时'))},30000);importAcks.set(item.id,()=>{clearTimeout(timeout);resolve()});cloudWindow.postMessage({type:'seedream-import-item',item},CLOUD)})}cloudWindow.postMessage({type:'seedream-import-end'},CLOUD)}catch{api().toast('迁移未完成，可使用相册备份')}
 }
 if(hosted&&e.origin===GITHUB&&e.source===window.opener&&location.search.includes('import=1')){
  if(e.data?.type==='seedream-import-item'){importQueue=importQueue.then(async()=>{
   const item=e.data.item;if(!item||!/^[a-zA-Z0-9._:-]{1,200}$/.test(item.id))return;
   const existing=await api().dbAll('album');if(existing.some(x=>x.id===item.id)){window.opener.postMessage({type:'seedream-import-ack',id:item.id},GITHUB);return;}delete item._cloudRevision;delete item._syncedFingerprint;await api().dbPut('album',item);document.dispatchEvent(new Event('album-cloud-loaded'));window.opener.postMessage({type:'seedream-import-ack',id:item.id},GITHUB);schedule();
  }).catch(error=>note('迁移失败：'+error.message))}
  if(e.data?.type==='seedream-import-end'){await importQueue;api().toast('旧相册已迁入，原页面的图片仍保留');if(!user)$('#accountModal').showModal()}
 }
});
(async()=>{
 if(hosted){try{user=await request('auth');if(localStorage.getItem('seedream-account-id')!==user.id){await adoptGuest(user.id);localStorage.setItem('seedream-account-id',user.id);location.reload();return}ui();schedule()}catch{ui();if(localStorage.getItem('seedream-account-id'))note('登录已过期，本机相册仍然保留。请重新登录。')}
 if(location.search.includes('import=1')){if(window.opener)window.opener.postMessage({type:'seedream-import-ready'},GITHUB);else{$('#accountModal').showModal();note('登录后可导入旧版导出的相册备份。')}}
 }else{note('账号相册在云端打开；本机图片会一同迁移。');$('#accountTitle').textContent='本机相册';$('#accountFields').classList.add('hidden');$('#loginBtn').classList.add('hidden');$('#registerBtn').classList.add('hidden')}
})();
})();

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);
const VISION_MODEL = 'deepseek-v4-flash-vision-exp';

const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.ico':'image/x-icon'
};

function send(res, status, body, headers={}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers });
  res.end(data);
}

async function readJson(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 45 * 1024 * 1024) throw Object.assign(new Error('请求体超过 45MB。'), {status:413});
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求 JSON 格式不正确。'), {status:400}); }
}

async function readRemoteJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { return { error: { message: text || `HTTP ${response.status}` } }; }
}

function remoteError(data, status) {
  const err = data?.error;
  const msg = typeof err === 'string' ? err : err?.message || data?.message || data?.data?.error;
  if (status === 401) return 'API Key 无效，请检查后重新保存。';
  if (status === 402) return '余额不足，请充值后再试。';
  if (status === 403) return '这个 API Key 没有执行该操作的权限。';
  if (status === 429) return '请求太频繁了，稍等一会儿再试。';
  return msg || `请求失败（HTTP ${status}）`;
}

async function handleAtlas(req, res) {
  const key = String(req.headers['x-atlas-api-key'] || '').trim();
  if (!key) return send(res, 400, {error:'缺少 AtlasCloud API Key。'});
  const body = await readJson(req);
  const headers = {Authorization:`Bearer ${key}`};
  let url, options;
  if (body.action === 'balance') {
    url = 'https://api.atlascloud.ai/public/v1/balance';
    options = {headers};
  } else if (body.action === 'prediction') {
    if (!body.id) return send(res,400,{error:'缺少 prediction id。'});
    url = `https://api.atlascloud.ai/api/v1/model/prediction/${encodeURIComponent(body.id)}`;
    options = {headers};
  } else if (body.action === 'generate') {
    url = 'https://api.atlascloud.ai/api/v1/model/generateImage';
    options = {method:'POST', headers:{...headers,'Content-Type':'application/json'}, body:JSON.stringify(body.payload || {})};
  } else return send(res,400,{error:'未知 AtlasCloud 操作。'});

  try {
    const r = await fetch(url, options);
    const data = await readRemoteJson(r);
    if (!r.ok) return send(res, r.status, {error:remoteError(data,r.status), data});
    return send(res,200,data);
  } catch (e) { return send(res,502,{error:`AtlasCloud 网络请求失败：${e.message}`}); }
}

const ANALYZE_PROMPT = `你正在做图片安全与人物完整性分析。只分析图片本身，不改图、不扩写生成提示词。严格返回 JSON 对象，不要 Markdown。字段：has_person(boolean), person_count(number), face_count(number), clear_face_count(number), face_visibility("clear"|"partial"|"hidden"|"none"|"unknown"), occlusion(boolean), occlusion_description(string), phone_covering_face(boolean), complex_scene(boolean), primary_face_box(object|null，坐标范围0-1000，包含x1,y1,x2,y2), summary(string，简短中文)。重点判断：是否多人、手机/手/物体挡脸、脸是否完整可见、主体是否适合做身份保持型图片编辑。`;

async function handleDeepSeek(req, res) {
  const key = String(req.headers['x-deepseek-api-key'] || '').trim();
  if (!key) return send(res,400,{error:'缺少 DeepSeek API Key。'});
  const body = await readJson(req);
  const auth = {Authorization:`Bearer ${key}`};

  if (body.action === 'balance') {
    const started = Date.now();
    try {
      const r = await fetch('https://api.deepseek.com/user/balance', {headers:{...auth,Accept:'application/json'}});
      const data = await readRemoteJson(r);
      if (!r.ok) return send(res,r.status,{error:remoteError(data,r.status),data,meta:{http_status:r.status,elapsed_ms:Date.now()-started}});
      return send(res,200,{data,meta:{http_status:r.status,elapsed_ms:Date.now()-started}});
    } catch(e) { return send(res,502,{error:`DeepSeek 网络请求失败：${e.message}`}); }
  }

  if (body.action === 'analyze') {
    if (!body.image || typeof body.image !== 'string' || !body.image.startsWith('data:image/')) return send(res,400,{error:'请先上传有效图片。'});
    const started = Date.now();
    const payload = {
      model: VISION_MODEL,
      messages: [{ role:'user', content:[
        {type:'text', text:ANALYZE_PROMPT},
        {type:'image_url', image_url:{url:body.image, detail:'low'}}
      ]}],
      response_format:{type:'json_object'},
      thinking:{type:'disabled'},
      max_tokens:1200,
      temperature:0.1
    };
    try {
      const r = await fetch('https://api.deepseek.com/chat/completions', {method:'POST', headers:{...auth,'Content-Type':'application/json'}, body:JSON.stringify(payload)});
      const raw = await readRemoteJson(r);
      const elapsed = Date.now()-started;
      if (!r.ok) return send(res,r.status,{error:remoteError(raw,r.status),raw,meta:{requested_model:VISION_MODEL,http_status:r.status,elapsed_ms:elapsed}});
      const content = raw?.choices?.[0]?.message?.content ?? '';
      let parsed = null;
      try { parsed = typeof content === 'string' ? JSON.parse(content.replace(/^```json\s*|\s*```$/g,'')) : content; } catch {}
      if (!parsed || typeof parsed !== 'object') return send(res,502,{error:'DeepSeek 返回了内容，但不是可解析的 JSON 分析结果。',raw,meta:{requested_model:VISION_MODEL,actual_model:raw?.model||'',http_status:r.status,elapsed_ms:elapsed}});
      return send(res,200,{data:parsed,meta:{requested_model:VISION_MODEL,actual_model:raw?.model||'',http_status:r.status,elapsed_ms:elapsed,usage:raw?.usage||null},raw});
    } catch(e) { return send(res,502,{error:`DeepSeek 网络请求失败：${e.message}`,meta:{requested_model:VISION_MODEL,elapsed_ms:Date.now()-started}}); }
  }
  return send(res,400,{error:'未知 DeepSeek 操作。'});
}

function serveStatic(req,res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(publicDir)) return send(res,403,'Forbidden');
  fs.stat(file,(err,st)=>{
    if (err || !st.isFile()) return send(res,404,'Not found');
    res.writeHead(200, {'Content-Type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req,res)=>{
  try {
    if (req.method === 'POST' && req.url === '/api/atlas') return await handleAtlas(req,res);
    if (req.method === 'POST' && req.url === '/api/deepseek') return await handleDeepSeek(req,res);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req,res);
    return send(res,405,{error:'Method not allowed'});
  } catch(e) { return send(res,e.status||500,{error:e.message||'服务器错误'}); }
});
server.listen(port,'0.0.0.0',()=>console.log(`Seedream Studio: http://localhost:${port}`));

# Seedream v5.0 Pro Editor

手机端/桌面端自适应的 Seedream v5.0 Pro 图片编辑页面。

## 功能
- Seedream v5.0 Pro Edit 图片编辑
- AtlasCloud 余额查询
- 可选 DeepSeek 人物分析
- 生成记录持久化（IndexedDB，不再限制 12 条）
- 相册本地上传、多图上传、分页、删除、拖动排序、前后微调
- 生成结果加入相册
- 图片双击/双击触控放大和还原
- API Key 仅保存在浏览器 localStorage
- 白色界面 + 红色主要按钮
- iPhone / Android / 桌面响应式布局

## GitHub Pages
这是纯静态前端，可直接通过 GitHub Pages 发布。默认直接请求 AtlasCloud 与 DeepSeek API；若浏览器或服务端 CORS 策略阻止直接请求，可在“API 设置 > 高级设置”填写兼容代理地址。兼容代理应提供 `/api/atlas` 与 `/api/deepseek` 两个接口，与原页面的代理协议一致。

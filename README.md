# Seedream v5.0 Pro Editor · Enhanced

这是一版可维护的重建版本，保留 Seedream 单图编辑主流程，并新增：

- DeepSeek `deepseek-v4-flash-vision-exp` 图片实测：显示成功/失败、HTTP 状态、耗时、实际返回模型名、结构化识别结果和原始返回。
- DeepSeek 余额查询：总余额、充值余额、赠送余额、是否可调用。
- AtlasCloud 余额查询：可用、现金、赠送余额。
- AtlasCloud / DeepSeek 两个 API Key 浏览器本地保存，刷新页面后无需重复填写。
- 手机/平板/桌面响应式布局。
- 服务端只做代理，不保存 API Key。

## Windows 运行

1. 安装 Node.js 18 或更高版本。
2. 双击 `start-windows.bat`。
3. 浏览器打开 `http://localhost:3000`。

## 命令行运行

```bash
npm start
```

## 手机测试

同一 Wi‑Fi 下，电脑运行项目后，在 Windows 命令行执行 `ipconfig` 查看电脑 IPv4 地址，例如 `192.168.1.10`。手机浏览器访问：

`http://192.168.1.10:3000`

如果访问不到，检查 Windows 防火墙是否允许 Node.js 的“专用网络”访问。

要让手机在外网任何地方使用，需要把本项目部署到支持 Node.js 的托管平台；不要把 API Key 写进源码或服务器环境变量，本项目设计为用户在浏览器本地保存 Key。

## API 说明

AtlasCloud 使用：
- `GET https://api.atlascloud.ai/public/v1/balance`
- `POST https://api.atlascloud.ai/api/v1/model/generateImage`
- `GET https://api.atlascloud.ai/api/v1/model/prediction/{id}`

DeepSeek 使用：
- `GET https://api.deepseek.com/user/balance`
- `POST https://api.deepseek.com/chat/completions`
- 视觉模型：`deepseek-v4-flash-vision-exp`

> 视觉模型属于实验模型。页面的“测试视觉模型”会实际发送当前上传图片，并把服务端返回的模型名、耗时和原始响应显示出来，用于确认当前 Key/账户是否真的能调用。

# cf-worker-pan-pdf
这是一个基于 Cloudflare Workers 的轻量级百度网盘文件下载工具。无需服务器。

---

## ⚠️ 注意 / Note:

本项目主要用于小文件下载。

仅供学习和个人使用，请勿用于大规模分发或商业用途。

## ✨ 特性 / Features
- 🚀 Serverless: 零服务器成本，完全运行在 Cloudflare 边缘节点。

- ⚙️ 配置灵活: 支持通过环境变量配置 Cookie 池（JSON 数组格式）。

- 🛡️ 隐私安全: 代码开源，Cookie 存储在你的 Cloudflare 环境变量中。

## 🛠️ 部署指南 / Deployment
1.  准备工作
一个 Cloudflare 账号。

百度网盘账号的 Cookie (主要是 BDUSS 和 STOKEN)。

2.  创建 Worker
登录 Cloudflare Dashboard。

进入 Workers & Pages -> Create Application -> Create Worker。

命名你的 Worker（例如 baidu-downloader），点击 Deploy。

点击 `Edit code`，将本项目中的 worker.js 代码复制进去并保存。

3.  配置环境变量 (关键步骤)
本项目需要配置名为 `SERVER_DEFAULT_COOKIES` 的环境变量来连接百度网盘。

在 Worker 的设置页面，点击 `Settings -> Variables and Secrets`。

点击 Add 添加变量。

`Variable name`: 输入 `SERVER_DEFAULT_COOKIES`。

`Value`: 输入一个 JSON 格式的字符串数组。每个元素代表一个完整的 Cookie 字符串。

JSON 格式示例:

```JSON

[
  "BDUSS=你的BDUSS值; STOKEN=你的STOKEN值; ...",
  "BDUSS=备用账号BDUSS值; STOKEN=备用账号STOKEN值; ..."
]
```

## 如何获取 Cookie?

在浏览器登录百度网盘网页版。

按 F12 打开开发者工具，刷新页面。

在 Network 面板找到任意请求，查看 `Request Headers` 中的 Cookie 字段。

## 完成部署
配置完成后，点击 Deploy 确保最新配置生效。

## 📖 使用方法 / Usage
部署成功后，访问你的 Worker 域名即可使用。

## 🪳已知bug:

1. 有时候生成链接后，网盘中的文件会删除失败。
2. `{ “error_code”:31326, “error_msg”:“anti hotlinking” }` （但是我自己没复现出来）



## ⚠️ 免责声明 / Disclaimer
本项目仅供技术研究和教育目的使用。

使用者应对使用本项目产生的一切后果负责。

请勿使用本项目下载非法内容或侵犯版权的文件。

作者不对因使用本项目导致的百度网盘账号封禁或限制负责。

## 📄 License
MIT

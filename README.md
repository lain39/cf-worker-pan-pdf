# Cf-Worker-Pan-Pdf ⚡️

> 基于 Cloudflare Workers 的某度网盘高速预览服务 (Serverless 版)

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-orange?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

本项目是一个运行在 Cloudflare Workers 上的轻量级应用，使用某度网盘的 "PDF 预览" 机制，实现对 150MB 以下文件的免客户端高速预览。

## 📸 界面预览

![App Screenshot](https://github.com/user-attachments/assets/8b0f691a-1ad9-4cc4-911a-e2b2f017d42f)

## ✨ 特性

- **⚡️ Serverless 架构**：无需服务器，直接部署在 Cloudflare Workers 上。
- **🔄 智能账号轮询**：支持配置多个 Cookie，采用**随机轮询**策略。
- **🔐 OAuth 2.0 鉴权**：集成了 **Linux.do Connect** 登录。
- **⏰ 智能清理**：配合 Cron Triggers 定时清理网盘内的临时转存文件以及验证Cookie有效性。
  -  错峰清理：并发请求自动错峰。
  -  优先清理：可以配置 KV 记录清理时间以及账号有效性，优先清理最久未处理的账号。
- **📱 响应式 UI**：优雅的移动端与桌面端适配，支持批量解析、Aria2 推送。
- **🕵️‍♂️ 隐私保护**：透传客户端 User-Agent，伪装成浏览器正常预览行为。

## 📢 注意
- 不能用同账号的Cookie下载该账号分享的文件，因为自己不能转存自己的分享。

## 📥 下载与安装

您可以选择以下两种方式之一进行部署：

### 方式 A：源码部署 (推荐，适合开发者)
请参考下方的 [🛠️ 部署指南](#🛠️-部署指南) 完成完整部署。

### 方式 B：单文件部署
1. 前往 [**Releases 页面**](https://github.com/lain39/cf-worker-pan-pdf/releases) 下载最新的 `worker.js`。
2. 在 Cloudflare 后台新建 Worker，粘贴代码。
3. 手动配置环境变量（Cookie, Client ID 等）。

---

## 🛠️ 部署指南

### 前置要求

1.  拥有一个 [Cloudflare](https://dash.cloudflare.com/) 账号。
2.  本地安装 Node.js 环境。
3.  拥有至少一个某度账号。
4.  (可选) [Linux.do](https://connect.linux.do/) 开发者账号用于 OAuth 登录（如不需要可关闭鉴权）。

### 1. 克隆项目并安装依赖

下载代码并安装 Wrangler 等必要的依赖包。

```bash
git clone https://github.com/lain39/cf-worker-pan-pdf.git
cd cf-worker-pan-pdf
npm install
```

### 2. 登录 Cloudflare

在执行任何写操作之前，必须先授权 Wrangler 访问你的 Cloudflare 账号。执行后会弹出的浏览器窗口，点击 "Allow" 即可。

```bash
npx wrangler login
```

### 3. 创建 KV 命名空间 (如果需要该配置)

如果账号较多，KV 用于存储失效账号黑名单和清理历史，能大幅提升稳定性。
```bash
npx wrangler kv namespace create COOKIE_DB
```

运行后，终端会输出一个 id（例如 e0a1b2...）。请复制这个 ID。

### 4. 配置 Wrangler

本项目使用 `wrangler.jsonc` 进行配置。

1.  修改 `wrangler.jsonc` 中的 `ENABLE_AUTH` 来配置是否开启linux do connect鉴权。
2.  确认 `crons` 定时任务频率（默认每 2小时）。
3.  如果要启用 KV 来管理Cookie，请加入如下配置: 
```jsonc
//wrangler.jsonc
//如果不配置 KV，程序将自动降级为“无状态模式”（无黑名单记忆，随机清理）。
"kv_namespaces": [
  {
    "binding": "COOKIE_DB",
    "id": "你的_KV_ID_粘贴到这里"
  }
]
```

### 5. 设置敏感数据 (Secrets)

**这是最重要的一步**。请不要将敏感信息直接写在代码里，使用 Cloudflare Secrets 存储。

在项目根目录下运行以下命令：

```bash
# 1. 设置 Cookie 池 (JSON 数组字符串格式)
# 格式示例: ["BDUSS=xxx", "BDUSS=yyy"]
npx wrangler secret put SERVER_COOKIES

# (如果开启鉴权):

# 2. 设置 Session 签名密钥 (随机字符串，用于加密 session)
npx wrangler secret put SESSION_SECRET

# 3. 设置 Linux.do OAuth 密钥 
npx wrangler secret put LINUX_DO_CLIENT_ID
npx wrangler secret put LINUX_DO_CLIENT_SECRET
```

如果开启了KV来管理Cookie，可以用以下命令将Cookies传到Cloudflare KV：
```bash
# 先准备好cookies.json文件：["BDUSS=xxx", "BDUSS=yyy"...]
npx wrangler kv key put --binding=COOKIE_DB "server_cookies_pool" --path=cookies.json --remote
```
如果你在本地开发 (npm run dev) 也想用这组 Cookie，需要给预览环境也传一份：
```bash
npx wrangler kv key put --binding=COOKIE_DB "server_cookies_pool" --path=cookies.json --preview
```

### 6. 部署上线

```bash
npx wrangler deploy
```

部署成功后，Cloudflare 会返回一个访问域名（例如 `baidu-worker-pro.你的子域.workers.dev`）。

## ⚙️ 环境变量与配置说明

| 变量名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `SERVER_COOKIES` | Secret | **核心配置**。JSON 字符串数组，存放百度账号 Cookie。例如 `["Cookie1", "Cookie2"]`。 |
| `SESSION_SECRET` | Secret | 用于签名登录 Session 的密钥，建议生成一串长随机字符。 |
| `ENABLE_AUTH` | Config | 是否开启登录鉴权。在 `wrangler.jsonc` 中设为 `true` 或 `false`。 |
| `LINUX_DO_CLIENT_ID` | Secret | Linux.do Connect 的 Client ID。 |
| `LINUX_DO_CLIENT_SECRET` | Secret | Linux.do Connect 的 Client Secret。 |


## 🧑‍💻 本地开发

```bash
# 启动本地开发服务器
npx wrangler dev

# 注意：本地开发时，你需要创建一个 .dev.vars 文件来模拟 Secrets
# 格式: KEY=VALUE
```

## 🐛 已知BUG

1. `{ "error_code":31326, "error_msg":"anti hotlinking" }`，原因未知，暂时无解（我自己还没复现出这个bug）。
2. `{“error_code”:31362, "error_msg": "sign error"}` **尝试重新解析**

## ⚠️ 免责声明

1.  本项目仅供学习和技术研究使用，**请勿用于非法用途**。
2.  本项目利用了百度网盘的预览接口，可能违反其服务条款。使用本项目产生的任何后果（包括但不限于账号被封禁、SVIP 权益受损）由使用者自行承担。
3.  作者不对任何下载内容负责，请遵守当地法律法规。

## 📄 License

MIT License
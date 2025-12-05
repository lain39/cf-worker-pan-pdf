<div align="center">
  <a href="https://github.com/lain39/cf-worker-pan-pdf" title="cf-worker-pan-pdf's Github repository.">
    <img src="https://github.com/user-attachments/assets/12b8cef5-5442-47de-b96e-ca750c076fc5" height="120" width="auto"/>
  </a>
  <p align="center">
    <a href="https://github.com/lain39/cf-worker-pan-pdf/releases">
      <img src="https://img.shields.io/github/v/release/lain39/cf-worker-pan-pdf" alt="release">
    </a>
    <a href="https://github.com/lain39/cf-worker-pan-pdf/blob/master/LICENSE">
      <img src="https://img.shields.io/github/license/lain39/cf-worker-pan-pdf" alt="license">
    </a>
    <a href="https://workers.cloudflare.com/">
      <img src="https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-orange?logo=cloudflare&logoColor=white" alt="Deploy to Cloudflare Workers">
    </a>    
  </p>
  <img src="https://github.com/user-attachments/assets/8b0f691a-1ad9-4cc4-911a-e2b2f017d42f" width="650" height="auto"/>
</div>

# Cf-Worker-Pan-Pdf ⚡️
> 基于 Cloudflare Workers 的某度网盘高速预览服务 (Serverless 版)

本项目是一个运行在 Cloudflare Workers 上的轻量级应用，使用某度网盘的 "PDF 预览" 机制，实现对 150MB 以下文件的免客户端高速预览。

⚠️ **Attention:** 本项目不提供任何下载服务

## ✨ 特性

- **⚡️ Serverless 架构**：无需服务器，直接部署在 Cloudflare Workers 上。
- **🔄 智能账号轮询**：支持配置多个 Cookie，采用**随机轮询**策略。
- **🔐 多重鉴权支持**：

  - SSO 登录：支持 Linux.do Connect 一键登录（可选配置）。

  - Access Token：支持手动配置访问令牌 (Bearer Token)，方便 API 调用或免 SSO 使用。
- **⏰ 智能清理**：配合 Cron Triggers 定时清理网盘内的临时转存文件以及验证Cookie有效性。
  -  错峰清理：并发请求自动错峰。
  -  优先清理：可以配置 KV 记录清理时间以及账号有效性，优先清理最久未处理的账号。
- **📱 响应式 UI**：优雅的移动端与桌面端适配，支持批量解析、Aria2 推送。

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
4.  (可选) [Linux.do](https://connect.linux.do/) 账号用于 SSO 登录。

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

KV 用于存储失效账号黑名单、清理历史以及Cookie 池，如果账号较多，能提升稳定性并支持大量账号。
```bash
npx wrangler kv namespace create COOKIE_DB
```

运行后，终端会输出一个 id（例如 `e0a1b2...`）。请复制这个 ID。

### 4. 配置 Wrangler

本项目使用 `wrangler.jsonc` 进行配置。

1.  `ENABLE_AUTH`: 设置为 `true` 将开启 API 鉴权保护（必须登录或提供 Token 才能使用），设置为 `false` 则完全公开。
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

请不要将敏感信息直接写在代码里，使用 Cloudflare Secrets 存储。

在项目根目录下运行以下命令：
#### 5.1 配置 Cookie 池 (二选一)

**方案 A: 使用环境变量 (简单，适合少量账号)**

```bash
# 直接设置 Secret
# 格式: JSON 字符串数组 ["BDUSS=xxx", "BDUSS=yyy"]
npx wrangler secret put SERVER_COOKIES
```

**方案 B: 使用 KV 存储 (如果启用，支持大量账号)**

```bash
# 1. 准备 cookies.json 文件，内容为 JSON 字符串数组
# 格式: ["BDUSS=xxx", "BDUSS=yyy"]
# 文件名示例: cookies.json

# 2. 上传到 Cloudflare KV
npx wrangler kv key put --binding=COOKIE_DB "server_cookies_pool" --path=cookies.json --remote

# 3. (可选) 如果要在本地开发环境 (npm run dev) 使用：
npx wrangler kv key put --binding=COOKIE_DB "server_cookies_pool" --path=cookies.json --preview
```

#### 5.2 配置鉴权 (可选)
```bash
# 1. 设置 Access Token (用于手动授权/API调用)
# 设置后，可在网页设置中填入此 Token 进行授权，无需 SSO
npx wrangler secret put ACCESS_TOKEN

# 2. 设置 Linux.do SSO (如果需要 SSO 登录)
# 如果不设置这两个 Secrets，SSO 登录按钮将自动隐藏
npx wrangler secret put LINUX_DO_CLIENT_ID
npx wrangler secret put LINUX_DO_CLIENT_SECRET

# 3. 设置 Session 签名密钥 (如果 SSO 登录则必须设置)
# 生成一个随机字符串即可
npx wrangler secret put SESSION_SECRET
```

### 6. 部署上线

```bash
npx wrangler deploy
```

部署成功后，Cloudflare 会返回一个访问域名（例如 `cf-worker-pan-pdf.你的子域.workers.dev`）。

## ⚙️ 环境变量与配置说明

| 变量名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `SERVER_COOKIES` | Secret | **可选**。JSON 字符串数组。如果使用了 KV (`server_cookies_pool`)，则无需配置此项。 |
| `ENABLE_AUTH` | Config | **功能开关**。是否开启 API 鉴权保护。`true` = 必须授权才能解析；`false` = 公开访问。 |
| `ACCESS_TOKEN` | Secret | **可选**。自定义访问令牌。设置后可通过 Header `Authorization: Bearer <token>` 或在网页设置中输入该 Token 进行授权。 |
| `SESSION_SECRET` | Secret | **可选**。用于签名登录 Session 的密钥，开启 `ENABLE_AUTH` 时必须设置。 |
| `LINUX_DO_CLIENT_ID` | Secret | **可选**。Linux.do Connect 的 Client ID。配置后网页将显示 "Linux.do 登录" 按钮。 |
| `LINUX_DO_CLIENT_SECRET` | Secret | **可选**。同上。Linux.do Connect 的 Client Secret。 |


## 🧑‍💻 本地开发

```bash
# 启动本地开发服务器
npx wrangler dev

# 注意：本地开发时，你需要创建一个 .dev.vars 文件来模拟 Secrets
# 格式: KEY=VALUE
```

## ⚠️ 免责声明

1.  本项目仅供学习和技术研究使用，**请勿用于非法用途**。
2.  本项目利用了百度网盘的预览接口，可能违反其服务条款。使用本项目产生的任何后果（包括但不限于账号被封禁、SVIP 权益受损）由使用者自行承担。
3.  作者不对任何下载内容负责，请遵守当地法律法规。

## 📄 License

MIT License

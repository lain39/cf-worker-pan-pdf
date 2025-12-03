/**
 * BaiduDisk Logic Module
 */

const DEFAULT_UA = "netdisk";
const DEFAULT_PDF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function handleList(body) {
  const { link, dir } = body;
  if (!link) throw new Error("Link is required");
  const { surl, pwd } = getShareInfo(link);

  const res = await BaiduDiskClient.getSharedList(surl, pwd, dir);
  return { success: true, data: res.data };
}

export async function handleDownload(body, clientIP, env, ctx, userAgent) {
  const { fs_ids, share_data, cookie } = body;
  if (!fs_ids || !share_data) throw new Error("Missing parameters");

  let client = null;
  let isUserCookie = false;
  let validCookieFound = false;

  // 1. 优先尝试用户传入的自定义 Cookie
  if (cookie && cookie.trim().length > 0 && cookie.includes("BDUSS")) {
    client = new BaiduDiskClient(cookie, clientIP);
    if (await client.init()) {
      isUserCookie = true;
      validCookieFound = true;
    }
  }

  // 2. 如果没有自定义 Cookie，则从服务器池中获取
  if (!validCookieFound) {
    const serverCookies = getServerCookies(env);
    if (serverCookies.length === 0) throw new Error("无可用 Cookie，请联系管理员。");

    // 随机打乱 Cookie 顺序，实现随机轮询
    // Fisher-Yates Shuffle 算法，保证每个 Cookie 都有机会被选中，且只试一次
    const shuffledCookies = shuffleArray(serverCookies);

    for (const sCookie of shuffledCookies) {
      const tempClient = new BaiduDiskClient(sCookie, clientIP);
      // 尝试初始化
      if (await tempClient.init()) {
        client = tempClient;
        validCookieFound = true;
        // 找到一个可用的就立即停止，避免浪费资源
        break;
      } else {
        // 仅在开发或调试模式下输出，避免日志爆炸
        console.warn("Cookie check failed for one account, trying next...");
      }
    }
  }

  if (!validCookieFound || !client) throw new Error("所有 Cookie 均失效，无法执行操作。");

  // --- 业务执行 ---
  const transferDir = `/netdisk/${crypto.randomUUID()}`;
  const errors = [];
  const validFiles = [];

  try {
    // 3. 创建目录 & 转存
    await client.createDir(transferDir);

    try {
      await client.transferFiles(fs_ids, share_data.shareid, share_data.uk, share_data.sekey, transferDir);
    } catch (e) {
      // 失败重试逻辑：先清理可能存在的残留目录，再重试
      await client.deleteFiles(["/netdisk"]);
      await client.createDir(transferDir);
      await client.transferFiles(fs_ids, share_data.shareid, share_data.uk, share_data.sekey, transferDir);
    }

    // 4. 递归获取文件
    const localFiles = [];
    await recursiveListFiles(client, transferDir, localFiles);
    if (localFiles.length === 0) throw new Error("No files found after transfer");

    const filesToProcess = localFiles.map(f => f.path);
    const pathInfoMap = {};

    localFiles.forEach(f => {
      let relative = f.path;
      if (f.path.startsWith(transferDir)) relative = f.path.substring(transferDir.length + 1);
      pathInfoMap[f.path] = { size: f.size, filename: f.server_filename, relativePath: relative };
    });

    // 5. 改名处理 (PDF重命名)
    const newPaths = [];
    for (const path of filesToProcess) {
      const info = pathInfoMap[path];
      // 限制 150MB
      if (info.size > 150 * 1024 * 1024) {
        errors.push(`Skipped ${info.filename}: Size > 150MB`);
        continue;
      }

      const newPath = path + ".pdf";
      try {
        const renamed = await client.renameFile(path, info.filename + ".pdf");
        if (renamed) {
          newPaths.push(newPath);
          pathInfoMap[newPath] = info;
        } else {
          errors.push(`Rename failed for ${info.filename}`);
        }
      } catch (e) {
        errors.push(`Rename error for ${info.filename}: ${e.message}`);
      }
    }

    // 6. 等待同步 (3秒)
    await new Promise(r => setTimeout(r, 3000));

    // 7. 获取链接
    const targetUA = userAgent || DEFAULT_PDF_UA;

    for (const path of newPaths) {
      const info = pathInfoMap[path];
      try {
        const dlink = await client.getSmallFileLink(path, targetUA);
        validFiles.push({
          path: path.slice(0, -4),
          dlink: dlink,
          size: info.size,
          filename: info.filename,
          relativePath: info.relativePath
        });
      } catch (e) {
        errors.push(`Failed to get link for ${info.filename}: ${e.message}`);
      }
    }

    // 服务端Cookie完全依赖 Cron 任务进行兜底清理，用户端下载完后清理
    if (isUserCookie) {
      ctx.waitUntil((async () => {
        // 等待 30 秒
        await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        try {
          // console.log(`Cleaning up user directory: ${transferDir}`);
          await client.deleteFiles([transferDir]);
        } catch (err) {
          console.error(`Failed to clean user directory ${transferDir}:`, err);
        }
      })());
    }

  } catch (e) {
    // 发生严重异常时立即尝试清理
    try { await client.deleteFiles([transferDir]); } catch (err) { }
    throw e;
  }

  return { success: true, files: validFiles, errors: errors };
}

// Cron 清理任务
export async function handleCleanDir(env) {
  const serverCookies = getServerCookies(env);
  if (serverCookies.length === 0) return "No cookies configured";

  // 清理任务也用shuffleArray，避免总是消耗第一个账号
  const shuffledCookies = shuffleArray(serverCookies);

  let client = null;
  for (const cookie of shuffledCookies) {
    const c = new BaiduDiskClient(cookie);
    if (await c.init()) {
      client = c;
      break;
    }
  }
  if (!client) return "No valid cookies found";

  try {
    console.log("Starting scheduled cleanup of /netdisk");
    await client.deleteFiles(["/netdisk"]);
    return "Cleanup success";
  } catch (e) {
    return `Cleanup result: ${e.message}`;
  }
}

export async function checkHealth(env) {
  const serverCookies = getServerCookies(env);
  const results = [];
  // 健康检查仍然需要按顺序检查所有 Cookie
  for (const cookie of serverCookies) {
    const client = new BaiduDiskClient(cookie);
    const alive = await client.init();
    // 隐去敏感信息
    const mask = cookie.substring(0, 10) + "...";
    results.push({ mask, alive });
  }
  return results;
}

// --- Helper Functions ---

// 解析环境变量中的 Cookie 数组
function getServerCookies(env) {
  try {
    if (env.SERVER_COOKIES) {
      const parsed = JSON.parse(env.SERVER_COOKIES);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error("Failed to parse SERVER_COOKIES", e);
  }
  return [];
}

// Fisher-Yates 随机打乱数组
function shuffleArray(array) {
  const arr = [...array]; // 创建副本，不修改原数组
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getShareInfo(link) {
  let surl = "", pwd = "";
  let m = link.match(/pan\.baidu\.com\/s\/([^\?&]+)/);
  if (m) surl = m[1];
  if (!surl) { m = link.match(/surl=([^&]+)/); if (m) surl = '1' + m[1]; }
  m = link.match(/pwd=([^&#]+)/);
  if (m) pwd = m[1];
  if (!surl) throw new Error("Invalid Link");
  return { surl, pwd };
}

async function recursiveListFiles(client, dirPath, resultList) {
  if (resultList.length > 500) return;
  const items = await client.listFiles(dirPath);
  for (const item of items) {
    if (item.isdir == 1) {
      await recursiveListFiles(client, item.path, resultList);
    } else {
      resultList.push(item);
    }
  }
}

// --- Class Definition ---
export class BaiduDiskClient {
  constructor(cookie, clientIP) {
    this.cookie = cookie || "";
    this.clientIP = clientIP || "121.11.121.11";
    this.bdstoken = "";
    this.commonHeaders = {
      "User-Agent": DEFAULT_UA,
      "Cookie": this.cookie,
      "Referer": "https://pan.baidu.com/",
      "X-Forwarded-For": this.clientIP,
      "X-BS-Client-IP": this.clientIP,
      "X-Real-IP": this.clientIP
    };
  }

  updateCookies(setCookieArray) {
    if (!setCookieArray || !Array.isArray(setCookieArray) || setCookieArray.length === 0) return;

    const cookieMap = new Map();
    // 1. 解析旧 Cookie
    this.cookie.split(';').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx > -1) {
        const k = pair.substring(0, idx).trim();
        const v = pair.substring(idx + 1).trim();
        cookieMap.set(k, v);
      }
    });

    let hasChange = false;
    // 2. 遍历新的 Set-Cookie 数组
    for (const cookieStr of setCookieArray) {
      const firstPart = cookieStr.split(';')[0];
      const idx = firstPart.indexOf('=');
      if (idx > -1) {
        const k = firstPart.substring(0, idx).trim();
        const v = firstPart.substring(idx + 1).trim();

        if (k === '' || k.toLowerCase() === 'path' || k.toLowerCase() === 'domain') continue;

        if (cookieMap.get(k) !== v) {
          cookieMap.set(k, v);
          hasChange = true;
        }
      }
    }

    // 3. 如果有更新，保存并持久化
    if (hasChange) {
      const newCookieStr = Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

      this.commonHeaders["Cookie"] = newCookieStr;
    }
  }

  async fetchJson(url, options = {}, shouldupdateCookies = false) {
    const headers = { ...this.commonHeaders, ...options.headers };
    const resp = await fetch(url, { ...options, headers });
    if (shouldupdateCookies) this.updateCookies(resp.headers.getSetCookie());
    const data = await resp.json();
    return data;
  }

  async init() {
    const api = "https://pan.baidu.com/api/gettemplatevariable?clienttype=12&app_id=web=1&fields=[%22bdstoken%22,%22token%22,%22uk%22,%22isdocuser%22,%22servertime%22]";
    try {
      const data = await this.fetchJson(api, undefined, true);
      if (data.errno === 0 && data.result) {
        this.bdstoken = data.result.bdstoken;
        // 更新STOKEN
        const pcsUrls = [
          'https://pcs.baidu.com/rest/2.0/pcs/file?method=plantcookie&type=ett',
          'https://pcs.baidu.com/rest/2.0/pcs/file?method=plantcookie&type=stoken&source=pcs',
        ]
        for (let api of pcsUrls) {
          let resp = await fetch(api, { headers: this.commonHeaders });
          this.updateCookies(resp.headers.getSetCookie());
          await resp.body.cancel();
        }

        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  static async getSharedList(surl, pwd, dir = null) {
    const api = "https://pan.baidu.com/share/wxlist?channel=weixin&version=2.2.3&clienttype=25&web=1&qq-pf-to=pcqq.c2c";
    const formData = new FormData();
    formData.append("shorturl", surl);
    formData.append("pwd", pwd);

    if (dir) {
      formData.append("root", "0");
      formData.append("dir", dir);
    } else {
      formData.append("root", "1");
    }
    formData.append("page", "1");
    formData.append("number", "1000");
    formData.append("order", "time");

    const headers = { "User-Agent": "pan.baidu.com", "Cookie": "XFI=a5670f2f-f8ea-321f-0e65-2aa7030459eb; XFCS=945BEA7DFA30AC8B92389217A688C31B247D394739411C7F697F23C4660EB72F;" };

    const resp = await fetch(api, { method: "POST", body: formData, headers: headers });
    const data = await resp.json();
    if (data.errno !== 0) throw new Error(`List error: ${data.errno}`);
    return data;
  }

  async createDir(path) {
    const api = `https://pan.baidu.com/api/create?a=commit&clienttype=0&app_id=250528&web=1&bdstoken=${this.bdstoken}`;
    const formData = new FormData();
    formData.append("path", path);
    formData.append("isdir", "1");
    formData.append("block_list", "[]");
    const data = await this.fetchJson(api, { method: "POST", body: formData });
    if (data.errno !== 0) throw new Error(`Create dir failed: ${data.errno}`);
    return data.path;
  }

  async transferFiles(fsids, shareid, uk, sekey, destPath) {
    const api = `https://pan.baidu.com/share/transfer?shareid=${shareid}&from=${uk}&sekey=${sekey}&ondup=newcopy&async=1&channel=chunlei&web=1&app_id=250528&clienttype=0&bdstoken=${this.bdstoken}`;
    const formData = new FormData();
    formData.append("fsidlist", `[${fsids.join(',')}]`);
    formData.append("path", destPath);
    const data = await this.fetchJson(api, { method: "POST", body: formData });
    if (data.errno !== 0) throw new Error(`Transfer failed: ${data.errno} - ${data.show_msg || ''}`);
    return data;
  }

  async listFiles(dir) {
    const api = `https://pan.baidu.com/api/list?clienttype=0&app_id=250528&web=1&order=name&desc=0&dir=${encodeURIComponent(dir)}&num=1000&page=1`;
    const data = await this.fetchJson(api);
    if (data.errno !== 0) return [];
    return data.list || [];
  }

  async renameFile(path, newName) {
    const api = `https://pan.baidu.com/api/filemanager?opera=rename&async=2&onnest=fail&channel=chunlei&web=1&app_id=250528&clienttype=0&bdstoken=${this.bdstoken}`;
    const formData = new FormData();
    formData.append("filelist", JSON.stringify([{ path, newname: newName }]));
    const data = await this.fetchJson(api, { method: "POST", body: formData });
    return data.errno === 0;
  }

  async deleteFiles(paths) {
    const api = `https://pan.baidu.com/api/filemanager?opera=delete&async=2&onnest=fail&channel=chunlei&web=1&app_id=250528&clienttype=0&bdstoken=${this.bdstoken}`;
    const formData = new FormData();
    formData.append("filelist", JSON.stringify(paths));
    await this.fetchJson(api, { method: "POST", body: formData });
  }

  async getSmallFileLink(path, customUA) {
    const logid = btoa(crypto.randomUUID());
    const api = `https://pan.baidu.com/api/locatedownload?clienttype=0&app_id=250528&web=1&channel=chunlei&logid=${logid}&path=${encodeURIComponent(path)}&origin=pdf&use=1`;
    const headers = { ...this.commonHeaders, "User-Agent": customUA };
    const resp = await fetch(api, { headers });
    const data = await resp.json();
    if (data.errno === 0) return data.dlink;
    throw new Error(`Errno ${data.errno}`);
  }
}
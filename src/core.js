/**
 * BaiduDisk Logic Module
 */

const DEFAULT_UA = "netdisk";
const DEFAULT_PDF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// KV 键名常量
const KV_BLOCK_KEY = "blocked_cookies";      // 黑名单 Key
const KV_CLEAN_HISTORY_KEY = "clean_history"; // 清理历史 Key
const KV_COOKIE_POOL_KEY = "server_cookies_pool"; // Cookie 池 Key

// 配置常量
const CLEAN_BATCH_SIZE = 5; 
const STAGGER_MS = 1000;    

// --- API Handles ---

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
    // 异步获取 Cookie 池 (支持 KV)
    const serverCookies = await getCookiePool(env);
    
    if (serverCookies.length === 0) throw new Error("无可用 Cookie，请联系管理员 (请检查 KV 或 Secret 配置)。");

    // 获取 KV 中的黑名单
    const blockedList = await getKvValue(env, KV_BLOCK_KEY, []);
    
    // 过滤掉黑名单中的 Cookie
    let availableCookies = serverCookies.filter(c => !blockedList.includes(c));

    // 兜底策略
    if (availableCookies.length === 0) {
        console.warn("All cookies are blocked. Retrying with full list...");
        availableCookies = serverCookies;
    }

    // 随机打乱
    const shuffledCookies = shuffleArray(availableCookies);

    for (const sCookie of shuffledCookies) {
      const tempClient = new BaiduDiskClient(sCookie, clientIP);
      
      if (await tempClient.init()) {
        client = tempClient;
        validCookieFound = true;
        break;
      } else {
        console.warn(`Cookie invalid, adding to blocklist...`);
        ctx.waitUntil(addBlockedCookieToKV(env, sCookie));
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
      // 失败重试逻辑：先删再存
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

    // 6. 等待同步
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

    if (isUserCookie) {
      ctx.waitUntil((async () => {
        await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        try { await client.deleteFiles([transferDir]); } catch (err) {}
      })());
    }

  } catch (e) {
    try { await client.deleteFiles([transferDir]); } catch (err) { }
    throw e;
  }

  return { success: true, files: validFiles, errors: errors };
}

export async function handleCleanDir(env) {
  // 改为异步获取
  const serverCookies = await getCookiePool(env);
  if (serverCookies.length === 0) return "No cookies configured";

  let targetCookies = [];
  const kvEnabled = !!env.COOKIE_DB;

  if (kvEnabled) {
      // LRU 策略
      const history = await getKvValue(env, KV_CLEAN_HISTORY_KEY, {});
      const getCookieId = (c) => c.substring(0, 50);
      const sortedCookies = [...serverCookies].sort((a, b) => {
          const timeA = history[getCookieId(a)] || 0;
          const timeB = history[getCookieId(b)] || 0;
          return timeA - timeB; 
      });
      targetCookies = sortedCookies.slice(0, CLEAN_BATCH_SIZE);
  } else {
      targetCookies = shuffleArray(serverCookies).slice(0, CLEAN_BATCH_SIZE);
  }

  console.log(`Starting batched cleanup. Targets: ${targetCookies.length}, Total: ${serverCookies.length}`);

  const results = [];
  const successCookies = [];

  const tasks = targetCookies.map(async (cookie, index) => {
      if (index > 0) await new Promise(r => setTimeout(r, index * STAGGER_MS));
      try {
          const client = new BaiduDiskClient(cookie);
          await client.init(); 
          if (!client.bdstoken) return { status: 'skipped' };
          await client.deleteFiles(["/netdisk"]);
          successCookies.push(cookie);
          return { status: 'success' };
      } catch (e) {
          return { status: 'failed', msg: e.message };
      }
  });

  const runRes = await Promise.allSettled(tasks);
  runRes.forEach(r => {
      if (r.status === 'fulfilled') results.push(r.value.status);
      else results.push('error');
  });

  if (kvEnabled && successCookies.length > 0) {
      try {
          const history = await getKvValue(env, KV_CLEAN_HISTORY_KEY, {});
          const now = Date.now();
          const getCookieId = (c) => c.substring(0, 50);
          successCookies.forEach(c => {
              history[getCookieId(c)] = now;
          });
          const activeIds = new Set(serverCookies.map(getCookieId));
          const cleanHistory = {};
          for (let k in history) {
              if (activeIds.has(k)) cleanHistory[k] = history[k];
          }
          await env.COOKIE_DB.put(KV_CLEAN_HISTORY_KEY, JSON.stringify(cleanHistory));
      } catch (e) {}
  }

  return `Batch Cleanup Done. Results: ${JSON.stringify(results)}`;
}

export async function checkHealth(env) {
  // 改为异步获取
  const serverCookies = await getCookiePool(env);
  const results = [];
  const currentBlockedList = [];
  const kvEnabled = !!env.COOKIE_DB;

  console.log(`Starting Health Check. KV Enabled: ${kvEnabled}. Pool Size: ${serverCookies.length}`);

  const checkPromises = serverCookies.map(async (cookie, index) => {
      if (index > 0) await new Promise(r => setTimeout(r, index * 200));
      const client = new BaiduDiskClient(cookie);
      const alive = await client.init();
      return { cookie, alive };
  });

  const checkResults = await Promise.all(checkPromises);

  for (const res of checkResults) {
      if (!res.alive) currentBlockedList.push(res.cookie);
      results.push({ mask: res.cookie.substring(0, 10) + "...", alive: res.alive });
  }

  if (kvEnabled) {
      console.log(`Updating KV blocklist. Count: ${currentBlockedList.length}`);
      await env.COOKIE_DB.put(KV_BLOCK_KEY, JSON.stringify(currentBlockedList));
  }
  
  return results;
}

// --- Helper Functions ---

// 获取 Cookie 池 (KV 优先 -> Secret 降级)
async function getCookiePool(env) {
    // 1. 尝试从 KV 读取
    if (env.COOKIE_DB) {
        try {
            const kvList = await env.COOKIE_DB.get(KV_COOKIE_POOL_KEY, { type: "json" });
            if (Array.isArray(kvList) && kvList.length > 0) {
                return kvList;
            }
        } catch(e) {
            console.warn("Failed to read cookie pool from KV:", e);
        }
    }

    // 2. 降级：尝试从环境变量/Secret 读取
    if (env.SERVER_COOKIES) {
        try {
            const parsed = JSON.parse(env.SERVER_COOKIES);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            console.error("Failed to parse SERVER_COOKIES env", e);
        }
    }

    return [];
}

async function getKvValue(env, key, defaultValue) {
    if (!env.COOKIE_DB) return defaultValue;
    try {
        const val = await env.COOKIE_DB.get(key, { type: "json" });
        return val === null ? defaultValue : val;
    } catch (e) {
        return defaultValue;
    }
}

async function addBlockedCookieToKV(env, cookie) {
    if (!env.COOKIE_DB) return;
    try {
        const list = await getKvValue(env, KV_BLOCK_KEY, []);
        if (!list.includes(cookie)) {
            list.push(cookie);
            await env.COOKIE_DB.put(KV_BLOCK_KEY, JSON.stringify(list));
        }
    } catch (e) {}
}

function shuffleArray(array) {
  const arr = [...array]; 
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getShareInfo(link) {
  const text = link.trim();
  let surl = "", pwd = "";
  let m = text.match(/(?:^|\s)(?:https?:\/\/)?(?:pan|yun)\.baidu\.com\/s\/([\w\-]+)/);
  if (m) { surl = m[1]; } 
  else {
      m = text.match(/(?:^|\s)(?:https?:\/\/)?(?:pan|yun)\.baidu\.com\/share\/init\?.*surl=([\w\-]+)/); 
      if (m) surl = '1' + m[1];
  }
  m = text.match(/[?&]pwd=([a-zA-Z0-9]{4})\b/);
  if (!m) m = text.match(/(?:pwd|码|code)[\s:：=]+([a-zA-Z0-9]{4})\b/i);
  if (m) pwd = m[1];
  if (!surl) throw new Error("无效的百度网盘链接 (Invalid Link)");
  return { surl, pwd };
}

async function recursiveListFiles(client, dirPath, resultList) {
  if (resultList.length > 500) return;
  const items = await client.listFiles(dirPath);
  for (const item of items) {
    if (item.isdir == 1) await recursiveListFiles(client, item.path, resultList);
    else resultList.push(item);
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
    this.cookie.split(';').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx > -1) cookieMap.set(pair.substring(0, idx).trim(), pair.substring(idx + 1).trim());
    });
    let hasChange = false;
    for (const cookieStr of setCookieArray) {
      const firstPart = cookieStr.split(';')[0];
      const idx = firstPart.indexOf('=');
      if (idx > -1) {
        const k = firstPart.substring(0, idx).trim();
        const v = firstPart.substring(idx + 1).trim();
        if (k === '' || k.toLowerCase() === 'path' || k.toLowerCase() === 'domain') continue;
        if (cookieMap.get(k) !== v) { cookieMap.set(k, v); hasChange = true; }
      }
    }
    if (hasChange) {
      this.commonHeaders["Cookie"] = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }
  }

  async fetchJson(url, options = {}, shouldUpdateCookies = false) {
    const headers = { ...this.commonHeaders, ...options.headers };
    const resp = await fetch(url, { ...options, headers });
    if (shouldUpdateCookies) this.updateCookies(resp.headers.getSetCookie());
    const data = await resp.json();
    return data;
  }

  async init() {
    const api = "https://pan.baidu.com/api/gettemplatevariable?clienttype=12&app_id=web=1&fields=[%22bdstoken%22,%22token%22,%22uk%22,%22isdocuser%22,%22servertime%22]";
    try {
      const data = await this.fetchJson(api, undefined, true);
      if (data.errno === 0 && data.result) {
        this.bdstoken = data.result.bdstoken;
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
    } catch (e) { return false; }
  }

  static async getSharedList(surl, pwd, dir = null) {
    const api = "https://pan.baidu.com/share/wxlist?channel=weixin&version=2.2.3&clienttype=25&web=1&qq-pf-to=pcqq.c2c";
    const formData = new FormData();
    formData.append("shorturl", surl);
    formData.append("pwd", pwd);
    formData.append("root", dir ? "0" : "1");
    if(dir) formData.append("dir", dir);
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
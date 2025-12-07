/**
 * BaiduDisk Logic Module
 */

const DEFAULT_UA = "netdisk";
const DEFAULT_PDF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// KV 键名常量
const KV_BLOCK_KEY = "blocked_cookies";
const KV_CLEAN_HISTORY_KEY = "clean_history";
const KV_COOKIE_POOL_KEY = "server_cookies_pool";

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
  const { files, share_data, cookie } = body;
  
  if (!files || !Array.isArray(files) || !share_data) throw new Error("Missing parameters: files array required");

  // 1. 建立原始信息映射表: fs_id -> fileInfo
  const fsIdMap = new Map(); 
  const targetFsIds = [];
  
  files.forEach(f => {
    const fid = String(f.fs_id);
    fsIdMap.set(fid, f);
    targetFsIds.push(fid);
  });

  let client = null;
  let isUserCookie = false;
  let validCookieFound = false;

  // 2. 优先尝试用户传入的自定义 Cookie
  if (cookie && cookie.trim().length > 0 && cookie.includes("BDUSS")) {
    client = new BaiduDiskClient(cookie, clientIP);
    if (await client.init()) {
      isUserCookie = true;
      validCookieFound = true;
    }
  }

  // 3. 如果没有自定义 Cookie，则从服务器池中获取
  if (!validCookieFound) {
    const serverCookies = await getCookiePool(env);

    if (serverCookies.length === 0) throw new Error("无可用 Cookie，请联系管理员 (请检查 KV 或 Secret 配置)。");

    // 获取黑名单 ID 列表
    const blockedIds = await getKvValue(env, KV_BLOCK_KEY, []);

    // 计算所有服务器 Cookie 的 ID 以便比对
    const cookieCandidates = await Promise.all(serverCookies.map(async c => ({
      cookie: c,
      id: await getCookieId(c)
    })));

    let availableCookies = cookieCandidates
      .filter(item => !blockedIds.includes(item.id))
      .map(item => item.cookie);

    if (availableCookies.length === 0) {
      console.warn("All cookies are blocked. Retrying with full list...");
      availableCookies = serverCookies;
    }

    const shuffledCookies = shuffleArray(availableCookies);

    for (const sCookie of shuffledCookies) {
      const tempClient = new BaiduDiskClient(sCookie, clientIP);
      if (await tempClient.init()) {
        client = tempClient;
        validCookieFound = true;
        break;
      } else {
        console.warn(`Cookie invalid, adding to blocklist...`);
        // 异步写入 KV 黑名单 (存 ID)
        ctx.waitUntil(addBlockedCookieToKV(env, sCookie));
      }
    }
  }

  if (!validCookieFound || !client) throw new Error("所有 Cookie 均失效，无法执行操作。");

  // --- 业务执行 ---
  // 每个批次都会创建一个独立的临时目录，处理完即焚
  const transferDir = `/netdisk/${crypto.randomUUID()}`;
  const errors = [];
  const validFiles = [];

  try {
    // 4. 创建目录 & 转存
    await client.createDir(transferDir);

    let transferResult = null;
    try {
      transferResult = await client.transferFiles(targetFsIds, share_data.shareid, share_data.uk, share_data.sekey, transferDir);
    } catch (e) {
      console.warn("First transfer attempt failed, retrying...", e.message);
      await client.createDir(transferDir);
      await new Promise(r => setTimeout(r, 500));  // 等待创建生效
      transferResult = await client.transferFiles(targetFsIds, share_data.shareid, share_data.uk, share_data.sekey, transferDir);
    }

    // 5. 建立 [转存后完整路径] -> [原始文件信息] 的精确映射
    // transferResult.extra.list = [{ from_fs_id: 123, to: "/path/file(1).pdf", ... }]
    const tempPathToOriginalMap = new Map();
    if (transferResult && transferResult.extra && Array.isArray(transferResult.extra.list)) {
      transferResult.extra.list.forEach(item => {
        if (item.to && item.from_fs_id) {
          const fid = String(item.from_fs_id);
          const originalInfo = fsIdMap.get(fid);
          if (originalInfo) {
            // Key: 临时目录下的完整路径, Value: 原始文件对象(含 relativePath)
            tempPathToOriginalMap.set(item.to, originalInfo);
          }
        }
      });
    }

    // 6. 递归获取文件
    const localFiles = [];
    await recursiveListFiles(client, transferDir, localFiles);
    if (localFiles.length === 0) throw new Error("No files found after transfer");

    // 7. 准备重命名处理
    const renameList = [];
    const filesToProcess = [];

    for (const f of localFiles) {
      // 通过当前文件的完整路径 (f.path) 找回原始信息
      const originalInfo = tempPathToOriginalMap.get(f.path);
      
      // 如果找不到映射，说明这个文件不是我们这批次请求的（极小概率），或者映射逻辑出错
      if (!originalInfo) {
        errors.push(`Failed to map file back to source: ${f.path}`);
        continue;
      }

      // 使用原始 relativePath 进行日志记录和返回
      const displayPath = originalInfo.relativePath;

      if (f.size > 150 * 1024 * 1024) {
        errors.push(`Skipped ${displayPath}: Size > 150MB`);
        continue;
      }

      const newName = f.server_filename + ".pdf";
      renameList.push({ path: f.path, newname: newName });
      
      filesToProcess.push({
        currentPath: f.path,
        newPath: f.path + ".pdf",
        size: f.size,
        filename: f.server_filename,
        relativePath: originalInfo.relativePath 
      });
    }

    // 8. 执行批量重命名 (PDF后缀)
    if (renameList.length > 0) {
      try {
        const renameSuccess = await client.renameBatch(renameList);
        if (!renameSuccess) {
          throw new Error("Batch rename failed");
        }
      } catch (e) {
        throw new Error(`Renaming failed: ${e.message}`);
      }
    }

    // 9. 等待同步
    await new Promise(r => setTimeout(r, 1500));

    // 10. 获取链接
    const targetUA = userAgent || DEFAULT_PDF_UA;

    for (const item of filesToProcess) {
      try {
        const dlink = await client.getSmallFileLink(item.newPath, targetUA);
        validFiles.push({
          path: item.newPath.slice(0, -4),
          dlink: dlink,
          size: item.size,
          filename: item.filename,
          relativePath: item.relativePath // 主键
        });
      } catch (e) {
        errors.push(`Failed to get link for ${item.relativePath}: ${e.message}`);
      }
    }

    // 清理临时目录
    if (isUserCookie) {
      ctx.waitUntil((async () => {
        await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        try { await client.deleteFiles([transferDir]); } catch (err) { }
      })());
    }

  } catch (e) {
    try { await client.deleteFiles([transferDir]); } catch (err) { }
    throw e;
  }

  return { success: true, files: validFiles, errors: errors };
}

export async function handleCleanDir(env) {
  const serverCookies = await getCookiePool(env);
  if (serverCookies.length === 0) return "No cookies configured";

  let targetCookies = [];
  const kvEnabled = !!env.COOKIE_DB;

  if (kvEnabled) {
    const history = await getKvValue(env, KV_CLEAN_HISTORY_KEY, {});

    // 使用 hash 计算 ID
    const cookieWithIds = await Promise.all(serverCookies.map(async c => ({
      cookie: c,
      id: await getCookieId(c)
    })));

    const sortedCookies = cookieWithIds.sort((a, b) => {
      const timeA = history[a.id] || 0;
      const timeB = history[b.id] || 0;
      return timeA - timeB;
    });
    targetCookies = sortedCookies.slice(0, CLEAN_BATCH_SIZE);
  } else {
    targetCookies = shuffleArray(serverCookies).slice(0, CLEAN_BATCH_SIZE).map(c => ({ cookie: c, id: null }));
  }

  const results = [];
  const successItems = [];

  const tasks = targetCookies.map(async (item, index) => {
    // 这里的 stagger 仍有必要，避免并发突发
    if (index > 0) await new Promise(r => setTimeout(r, index * STAGGER_MS));
    try {
      const client = new BaiduDiskClient(item.cookie);

      // 如果 init 失败，说明 cookie 已死，加入黑名单
      const alive = await client.init();

      if (!alive || !client.bdstoken) {
        await addBlockedCookieToKV(env, item.cookie);
        return { status: 'blocked_dead_cookie' };
      }

      await client.deleteFiles(["/netdisk"]);
      if (item.id) successItems.push(item.id);
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

  if (kvEnabled && successItems.length > 0) {
    try {
      // Read
      const history = await getKvValue(env, KV_CLEAN_HISTORY_KEY, {});
      const now = Date.now();

      // Update memory object
      successItems.forEach(id => {
        history[id] = now;
      });

      // Filter / Cleanup old keys
      const activeIds = new Set(await Promise.all(serverCookies.map(getCookieId)));
      const cleanHistory = {};
      for (let k in history) {
        if (activeIds.has(k)) cleanHistory[k] = history[k];
      }

      // Write
      await env.COOKIE_DB.put(KV_CLEAN_HISTORY_KEY, JSON.stringify(cleanHistory));
    } catch (e) { }
  }

  return `Batch Cleanup Done. Results: ${JSON.stringify(results)}`;
}

// --- Helper Functions ---

// SHA-256 Hash 生成 Cookie ID
async function getCookieId(cookie) {
  if (!cookie) return "empty";
  const msgBuffer = new TextEncoder().encode(cookie);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  // 截取前 12 位 16 进制字符作为 ID
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 12);
}

async function getCookiePool(env) {
  if (env.COOKIE_DB) {
    try {
      const kvList = await env.COOKIE_DB.get(KV_COOKIE_POOL_KEY, { type: "json" });
      if (Array.isArray(kvList) && kvList.length > 0) {
        return kvList;
      }
    } catch (e) { }
  }

  if (env.SERVER_COOKIES) {
    try {
      const parsed = JSON.parse(env.SERVER_COOKIES);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) { }
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
  const id = await getCookieId(cookie);

  // Read
  let list = await getKvValue(env, KV_BLOCK_KEY, []);
  if (!Array.isArray(list)) list = [];

  // Check & Write
  if (!list.includes(id)) {
    list.push(id);
    // 限制一下列表长度，防止无限增长
    if (list.length > 500) list.shift();
    await env.COOKIE_DB.put(KV_BLOCK_KEY, JSON.stringify(list));
  }
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
    this.clientIP = clientIP || `121.11.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`; // 随便写一个国内ip
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
    if (dir) formData.append("dir", dir);
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

  async renameBatch(renameList) {
    if (!renameList || renameList.length === 0) return true;
    const api = `https://pan.baidu.com/api/filemanager?opera=rename&async=2&onnest=fail&channel=chunlei&web=1&app_id=250528&clienttype=0&bdstoken=${this.bdstoken}`;
    const formData = new FormData();
    formData.append("filelist", JSON.stringify(renameList));
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
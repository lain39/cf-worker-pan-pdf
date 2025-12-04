/**
 * BaiduDisk Logic Module
 */

const DEFAULT_UA = "netdisk";
const DEFAULT_PDF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// KV 键名常量
const KV_BLOCK_KEY = "blocked_cookies";      // 失效Cookie Key
const KV_CLEAN_HISTORY_KEY = "clean_history"; // 清理历史 Key (记录上次清理时间)

// 配置常量
const CLEAN_BATCH_SIZE = 5; // 每次 Cron 任务清理的账号数量
const STAGGER_MS = 1000;    // 错峰启动间隔 (毫秒)

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
    const serverCookies = getServerCookies(env);
    if (serverCookies.length === 0) throw new Error("无可用 Cookie，请联系管理员。");

    // 获取 KV 中的黑名单 (如果 KV 未开启，返回空数组)
    const blockedList = await getKvValue(env, KV_BLOCK_KEY, []);
    
    // 过滤掉黑名单中的 Cookie
    let availableCookies = serverCookies.filter(c => !blockedList.includes(c));

    // 兜底策略：如果全军覆没，尝试全量复活
    if (availableCookies.length === 0) {
        console.warn("All cookies are blocked. Retrying with full list...");
        availableCookies = serverCookies;
    }

    // 随机打乱，负载均衡
    const shuffledCookies = shuffleArray(availableCookies);

    for (const sCookie of shuffledCookies) {
      const tempClient = new BaiduDiskClient(sCookie, clientIP);
      
      if (await tempClient.init()) {
        client = tempClient;
        validCookieFound = true;
        break;
      } else {
        // 发现坏 Cookie，尝试加入 KV 黑名单
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

/**
 * 1. 如果有 KV：优先清理最久没清理过的 (LRU)
 * 2. 如果无 KV：随机清理一批 (Random)
 */
export async function handleCleanDir(env) {
  const serverCookies = getServerCookies(env);
  if (serverCookies.length === 0) return "No cookies configured";

  let targetCookies = [];
  const kvEnabled = !!env.COOKIE_DB;

  if (kvEnabled) {
      // --- 模式 A: 基于 KV 的 LRU 策略 ---
      console.log("KV Detected. Using LRU cleanup strategy.");
      
      // 读取清理历史: { "cookie_part": timestamp, ... }
      const history = await getKvValue(env, KV_CLEAN_HISTORY_KEY, {});
      
      // 排序：从未清理过的 (timestamp 0) > 清理时间最早的 > 清理时间最近的
      // 需要一个稳定的 ID 来标识 Cookie，这里取前 50 个字符作为 ID
      const getCookieId = (c) => c.substring(0, 50);

      const sortedCookies = [...serverCookies].sort((a, b) => {
          const timeA = history[getCookieId(a)] || 0;
          const timeB = history[getCookieId(b)] || 0;
          return timeA - timeB; // 升序：小的在前 (0 或 老时间)
      });

      // 选取 Top N
      targetCookies = sortedCookies.slice(0, CLEAN_BATCH_SIZE);
  } else {
      // --- 模式 B: 随机降级策略 ---
      console.log("No KV Detected. Using Random cleanup strategy.");
      // 随机打乱并取前 N 个
      targetCookies = shuffleArray(serverCookies).slice(0, CLEAN_BATCH_SIZE);
  }

  console.log(`Starting batched cleanup. Targets: ${targetCookies.length}, Total: ${serverCookies.length}`);

  // 执行并发清理 (带错峰)
  const results = [];
  const successCookies = [];

  // 并发请求映射
  const tasks = targetCookies.map(async (cookie, index) => {
      // 错峰启动
      if (index > 0) await new Promise(r => setTimeout(r, index * STAGGER_MS));

      try {
          const client = new BaiduDiskClient(cookie);
          // 简单的鉴权检查，避免无效 Cookie 浪费时间
          await client.init(); 
          if (!client.bdstoken) return { status: 'skipped' };

          await client.deleteFiles(["/netdisk"]);
          
          // 记录成功的 Cookie 用于后续更新 KV
          successCookies.push(cookie);
          return { status: 'success' };
      } catch (e) {
          return { status: 'failed', msg: e.message };
      }
  });

  const runRes = await Promise.allSettled(tasks);
  
  // 统计结果
  runRes.forEach(r => {
      if (r.status === 'fulfilled') results.push(r.value.status);
      else results.push('error');
  });

  // 如果开启了 KV，更新清理时间记录
  if (kvEnabled && successCookies.length > 0) {
      try {
          // 重新读取一次 KV (防止并发覆盖)
          const history = await getKvValue(env, KV_CLEAN_HISTORY_KEY, {});
          const now = Date.now();
          const getCookieId = (c) => c.substring(0, 50);

          // 更新成功的账号时间
          successCookies.forEach(c => {
              history[getCookieId(c)] = now;
          });

          // 简单的垃圾回收：移除 history 中已经不在 serverCookies 里的旧账号
          const activeIds = new Set(serverCookies.map(getCookieId));
          const cleanHistory = {};
          for (let k in history) {
              if (activeIds.has(k)) cleanHistory[k] = history[k];
          }

          // 写回 KV
          await env.COOKIE_DB.put(KV_CLEAN_HISTORY_KEY, JSON.stringify(cleanHistory));
          console.log(`Updated cleanup history for ${successCookies.length} accounts.`);
      } catch (e) {
          console.error("Failed to update cleanup history KV:", e);
      }
  }

  return `Batch Cleanup Done. Results: ${JSON.stringify(results)}`;
}

// 定时健康检查任务 (KV 可选)
export async function checkHealth(env) {
  const serverCookies = getServerCookies(env);
  const results = [];
  const currentBlockedList = [];
  const kvEnabled = !!env.COOKIE_DB;

  console.log(`Starting Health Check. KV Enabled: ${kvEnabled}`);

  const checkPromises = serverCookies.map(async (cookie, index) => {
      // 错峰检测，防止并发过高
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

// --- KV Helper Functions ---

// 通用 KV 读取函数，自带异常处理
async function getKvValue(env, key, defaultValue) {
    if (!env.COOKIE_DB) return defaultValue;
    try {
        const val = await env.COOKIE_DB.get(key, { type: "json" });
        return val === null ? defaultValue : val;
    } catch (e) {
        console.warn(`KV Read Error [${key}]:`, e);
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
    } catch (e) {
        console.warn("KV Write Error:", e);
    }
}

// --- Standard Helper Functions ---

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
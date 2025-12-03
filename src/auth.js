// Linux.do OAuth2 配置
// 使用 HMAC-SHA256 签名防止 Cookie 篡改

export async function handleAuth(request, env, url) {
  if (url.pathname === "/auth/callback") {
    const code = url.searchParams.get("code");
    if (!code) return new Response("Missing code", { status: 400 });

    try {
      // 1. 用 code 换取 access_token
      const tokenResp = await fetch("https://connect.linux.do/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "Authorization": `Basic ${btoa(`${env.LINUX_DO_CLIENT_ID}:${env.LINUX_DO_CLIENT_SECRET}`)}`
        },
        body: new URLSearchParams({
          client_id: env.LINUX_DO_CLIENT_ID,
          client_secret: env.LINUX_DO_CLIENT_SECRET,
          grant_type: "authorization_code",
          code: code,
          redirect_uri: `${url.origin}/auth/callback`
        }).toString()
      });

      const tokenData = await tokenResp.json();
      console.log(tokenData)
      if (tokenData.error) return new Response(tokenData.error_description || "Token Error", { status: 400 });

      // 2. 获取用户信息
      const userResp = await fetch("https://connect.linux.do/api/user", {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`
        }
      });
      const userData = await userResp.json();

      // 3. 生成签名 Session
      const secret = env.SESSION_SECRET;

      const sessionObj = {
        id: userData.id,
        username: userData.username,
        name: userData.name,
        exp: Date.now() + 86400 * 1000 // 24小时过期
      };

      const rawSession = JSON.stringify(sessionObj);
      const signature = await sign(rawSession, secret);
      const sessionValue = btoa(rawSession) + "." + signature; // 格式: payload.signature

      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          // HttpOnly: 禁止 JS 读取; Secure: 仅 HTTPS; SameSite=Lax: 防止 CSRF
          "Set-Cookie": `SESSION_AUTH=${sessionValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        }
      });
    } catch (e) {
      return new Response("Auth Failed: " + e.message, { status: 500 });
    }
  }
  return new Response("Auth Handler Not Found", { status: 404 });
}

export async function verifySession(request, env) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  const cookies = parseCookies(cookieHeader);
  const sessionAuth = cookies["SESSION_AUTH"];
  if (!sessionAuth) return null;

  try {
    // 解析格式: payloadBase64.signature
    const parts = sessionAuth.split('.');
    if (parts.length !== 2) return null;

    const [payloadB64, signature] = parts;
    const rawSession = atob(payloadB64);

    // 验证签名
    const secret = env.SESSION_SECRET;
    const expectedSignature = await sign(rawSession, secret);

    if (signature !== expectedSignature) {
      console.warn("Invalid Session Signature");
      return null;
    }

    const data = JSON.parse(rawSession);
    if (Date.now() > data.exp) return null; // 过期

    return data;
  } catch (e) {
    return null;
  }
}

// --- HMAC-SHA256 签名工具函数 ---
async function sign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(data)
  );
  // 将二进制签名转换为 Hex 字符串，方便在 Cookie 中传输
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseCookies(str) {
  return str.split(';').reduce((acc, v) => {
    const [key, val] = v.trim().split('=').map(decodeURIComponent);
    acc[key] = val;
    return acc;
  }, {});
}
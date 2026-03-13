// worker.js

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 从环境变量获取配置 (请在 Cloudflare 控制台 Variables 中设置)
    // 根据指令：将用户名、密码、管理路径设置为变量
    const adminUser = env.ADMIN_USER || "admin";
    const adminPass = env.ADMIN_PASS || "admin123";
    const adminPath = env.ADMIN_PATH || "/admin";

    // ---------- 图形验证码 (SVG 方案) ----------
    if (request.method === 'GET' && url.pathname === '/captcha') {
      return generateCaptchaResponse(env);
    }

    // ---------- 创建短链 ----------
    if (request.method === 'POST' && url.pathname === '/shorten') {
      try {
        const { originalUrl, customSlug, expireInDays, captcha, captchaToken } = await request.json();

        // 验证码校验逻辑
        if (!captcha || !captchaToken)
          return new Response(JSON.stringify({ error: '需要验证码' }), { status: 400 });

        const saved = await env.CAPTCHAS_KV.get(captchaToken);
        if (!saved || saved.toLowerCase() !== captcha.toLowerCase())
          return new Response(JSON.stringify({ error: '验证码错误' }), { status: 400 });

        // 验证码用完即毁
        await env.CAPTCHAS_KV.delete(captchaToken);

        if (!originalUrl || !/^https?:\/\//.test(originalUrl))
          return new Response(JSON.stringify({ error: '无效的 URL (必须以 http/https 开头)' }), { status: 400 });

        const slug = customSlug || generateSlug();
        const exists = await env.LINKS_KV.get(slug);
        if (exists) return new Response(JSON.stringify({ error: '短链已存在' }), { status: 409 });

        const createdAt = Date.now();
        const expireAt = expireInDays ? createdAt + expireInDays * 24 * 60 * 60 * 1000 : null;
        
        const data = { originalUrl, createdAt, expireAt, clicks: 0 };
        await env.LINKS_KV.put(slug, JSON.stringify(data));

        return new Response(JSON.stringify({ shortUrl: `${url.origin}/${slug}` }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "服务器错误: " + err.message }), { status: 500 });
      }
    }

    // ---------- 管理后台 ----------
    if (url.pathname.startsWith(adminPath)) {
      // 1. 身份验证 (Basic Auth)
      const auth = request.headers.get('Authorization');
      if (!auth) {
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="Shortener Admin"' }
        });
      }

      try {
        const base64Str = auth.split(' ')[1];
        const decoded = atob(base64Str);
        const [u, p] = decoded.split(':');
        if (u !== adminUser || p !== adminPass) {
          return new Response('鉴权失败：用户名或密码错误', { status: 403 });
        }
      } catch (e) {
        return new Response('鉴权解析错误', { status: 400 });
      }

      // 2. 处理删除逻辑
      if (request.method === 'DELETE') {
        const delSlug = url.searchParams.get('slug');
        if (delSlug) {
          await env.LINKS_KV.delete(delSlug);
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('缺少 slug', { status: 400 });
      }

      // 3. 获取列表并构建页面
      const list = await env.LINKS_KV.list();
      let rows = '';
      for (const key of list.keys) {
        const val = await env.LINKS_KV.get(key.name);
        if (!val) continue;
        
        const d = JSON.parse(val);
        const expireStr = d.expireAt 
          ? new Date(d.expireAt).toLocaleString('zh-CN', { hour12: false }) 
          : '<span style="color: #28a745; font-weight:bold;">永久有效</span>';

        rows += `
          <tr>
            <td><code>${key.name}</code></td>
            <td class="url-cell" title="${d.originalUrl}">${d.originalUrl}</td>
            <td style="text-align:center;">${d.clicks || 0}</td>
            <td>${expireStr}</td>
            <td><button class="del-btn" onclick="deleteLink('${key.name}')">删除</button></td>
          </tr>`;
      }

      const adminHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>短链管理后台</title>
        <style>
          body { font-family: sans-serif; background: #f0f2f5; padding: 20px; color: #333; }
          .container { max-width: 1000px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
          h2 { border-bottom: 2px solid #eee; padding-bottom: 10px; color: #007bff; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
          th { background: #fafafa; color: #666; }
          .url-cell { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .del-btn { background: #ff4d4f; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
          .del-btn:hover { background: #ff7875; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>📊 短链管理后台</h2>
          <table>
            <thead>
              <tr>
                <th>Slug (短链路径)</th>
                <th>原始 URL</th>
                <th style="text-align:center;">点击量</th>
                <th>有效期至</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="5" style="text-align:center;">暂无短链数据</td></tr>'}
            </tbody>
          </table>
        </div>
        <script>
          async function deleteLink(slug) {
            if (confirm('确定要彻底删除短链 "' + slug + '" 吗？')) {
              try {
                const res = await fetch('${adminPath}?slug=' + slug, { method: 'DELETE' });
                if (res.ok) {
                  location.reload();
                } else {
                  alert('删除失败');
                }
              } catch (e) {
                alert('网络错误');
              }
            }
          }
        </script>
      </body>
      </html>`;
      return new Response(adminHtml, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    }

    // ---------- 查询短链信息 ----------
    if (request.method === 'GET' && url.pathname.startsWith('/info/')) {
      const slug = url.pathname.replace('/info/', '');
      const value = await env.LINKS_KV.get(slug);
      if (!value) return new Response('Not Found', { status: 404 });

      const data = JSON.parse(value);
      const now = Date.now();
      const remainingDays = data.expireAt ? Math.max(0, Math.ceil((data.expireAt - now) / (24 * 60 * 60 * 1000))) : null;

      return new Response(
        JSON.stringify({
          originalUrl: data.originalUrl,
          createdAt: new Date(data.createdAt).toISOString(),
          expireAt: data.expireAt ? new Date(data.expireAt).toISOString() : null,
          remainingDays,
          clicks: data.clicks,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ---------- 短链跳转逻辑 ----------
    const slug = url.pathname.slice(1);
    if (slug && !['captcha', 'shorten', 'info'].some(p => url.pathname.startsWith('/' + p))) {
      const value = await env.LINKS_KV.get(slug);
      if (value) {
        const data = JSON.parse(value);
        if (data.expireAt && Date.now() > data.expireAt) {
          return new Response('该短链接已过期', { status: 410 });
        }
        data.clicks = (data.clicks || 0) + 1;
        env.LINKS_KV.put(slug, JSON.stringify(data)).catch(() => {});
        return Response.redirect(data.originalUrl, 302);
      }
    }

    // ---------- 根路径 ----------
    if (url.pathname === '/') {
      return new Response(getHomeHtml(adminPath), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    }

    return new Response('页面不存在', { status: 404 });
  }
};

// ----------------- 工具函数 -----------------

function generateSlug(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let res = '';
  for (let i = 0; i < length; i++) res += chars[Math.floor(Math.random() * chars.length)];
  return res;
}

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function generateCaptchaResponse(env) {
  const code = Math.random().toString(36).substring(2, 7).toUpperCase();
  const token = crypto.randomUUID();
  await env.CAPTCHAS_KV.put(token, code, { expirationTtl: 300 });
  const width = 150, height = 50;
  let lines = '';
  for (let i = 0; i < 4; i++) {
    lines += `<line x1="${random(0,width)}" y1="${random(0,height)}" x2="${random(0,width)}" y2="${random(0,height)}" stroke="rgba(0,0,0,0.1)" />`;
  }
  let textElements = '';
  for (let i = 0; i < code.length; i++) {
    const x = 20 + i * 25;
    const y = 35;
    const rotate = random(-15, 15);
    const color = `rgb(${random(0,100)},${random(0,100)},${random(0,100)})`;
    textElements += `<text x="${x}" y="${y}" font-family="Arial" font-size="28" font-weight="bold" fill="${color}" transform="rotate(${rotate}, ${x}, ${y})">${code[i]}</text>`;
  }
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f8f9fa" />${lines}${textElements}</svg>`.trim();
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'X-Captcha-Token': token, 'Cache-Control': 'no-cache' } });
}

// 首页 HTML (已增加复制功能)
function getHomeHtml(adminPath) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>极简短链</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #f4f7f6; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.05); width: 100%; max-width: 400px; }
    h2 { margin: 0 0 1.5rem; text-align: center; color: #333; }
    label { display: block; margin-bottom: 5px; font-size: 14px; color: #666; }
    input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
    .captcha-container { display: flex; gap: 10px; margin-bottom: 15px; }
    #captchaImg { flex: 0 0 150px; height: 50px; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; background: #eee; overflow: hidden; }
    button { width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; }
    button:hover { background: #0056b3; }
    #result { margin-top: 20px; padding: 15px; border-radius: 6px; display: none; word-break: break-all; }
    .success { background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; }
    .error { background: #ffebee; color: #c62828; border: 1px solid #ffcdd2; }
    .copy-btn { margin-top: 10px; background: #28a745; padding: 8px; font-size: 14px; }
    .copy-btn:hover { background: #218838; }
    footer { margin-top: 20px; text-align: center; font-size: 12px; color: #aaa; }
    footer a { color: #aaa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🔗 极简短链</h2>
    <label>原始 URL</label>
    <input type="text" id="url" placeholder="https://example.com/very-long-link">
    
    <label>有效期 (天，留空为永久)</label>
    <input type="number" id="days" placeholder="例如: 7" min="1">
    
    <label>验证码</label>
    <div class="captcha-container">
      <input type="text" id="captcha" placeholder="结果" style="margin-bottom:0">
      <div id="captchaImg" title="点击刷新"></div>
    </div>
    
    <button id="btn">立即生成</button>
    <div id="result"></div>
    <footer><a href="${adminPath}">后台管理</a></footer>
  </div>

  <script>
    let token = '';
    let currentShortUrl = '';
    const imgBox = document.getElementById('captchaImg');
    const resBox = document.getElementById('result');

    async function refreshCaptcha() {
      const res = await fetch('/captcha?t=' + Date.now());
      token = res.headers.get('X-Captcha-Token');
      imgBox.innerHTML = await res.text();
    }

    imgBox.onclick = refreshCaptcha;
    refreshCaptcha();

    // 复制功能函数
    async function copyToClipboard(text, btn) {
      try {
        await navigator.clipboard.writeText(text);
        const oldText = btn.innerText;
        btn.innerText = '✅ 已复制！';
        btn.style.background = '#155724';
        setTimeout(() => {
          btn.innerText = oldText;
          btn.style.background = '#28a745';
        }, 2000);
      } catch (err) {
        alert('复制失败，请手动复制');
      }
    }

    document.getElementById('btn').onclick = async () => {
      const url = document.getElementById('url').value;
      const days = document.getElementById('days').value;
      const captcha = document.getElementById('captcha').value;

      resBox.style.display = 'none';
      if(!url) return alert('请输入URL');

      const response = await fetch('/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalUrl: url,
          expireInDays: parseInt(days) || null,
          captcha: captcha,
          captchaToken: token
        })
      });

      const data = await response.json();
      resBox.style.display = 'block';
      if(response.ok) {
        currentShortUrl = data.shortUrl;
        resBox.className = 'success';
        resBox.innerHTML = \`
          ✨ 生成成功：<br>
          <strong id="shortUrlText">\${data.shortUrl}</strong><br>
          <button class="copy-btn" onclick="copyToClipboard('\${data.shortUrl}', this)">点击复制短链</button>
        \`;
      } else {
        resBox.className = 'error';
        resBox.innerText = '❌ ' + (data.error || '生成失败');
        refreshCaptcha();
      }
    };
  </script>
</body>
</html>`;
}
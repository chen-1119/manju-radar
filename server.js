import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isSea } from 'node:sea';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildQuery, cleanQuery, matchesKind, normalizeIndexResult, normalizeResult, searchLinks, uniqueResults } from './search.js';
import { quarkShareInput } from './transfer.js';
import { baiduShareInput, baiduTransferResult } from './baidu.js';
import { selectTrending } from './trending.js';

const root = isSea() ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataDir = path.join(process.env.LOCALAPPDATA || root, 'ManjuRadar');
const configPath = path.join(dataDir, 'config.local.json');
let port = Number(process.env.PORT || 4177);
const runFile = promisify(execFile);
const quarkDir = path.join(dataDir, 'quark');
const quarkEnv = { ...process.env, QUARK_CONFIG_DIR: quarkDir };
const quarkCli = path.join(root, '.venv', 'Scripts', 'quarkpan.exe');
const quarkPython = path.join(root, '.venv', 'Scripts', 'python.exe');
const packedQuarkCli = path.join(root, 'components', 'quarkpan.exe');
const packedQuarkLogin = path.join(root, 'components', 'quark-login.exe');
const qrPath = path.join(quarkDir, 'login-qr.png');
const baiduDir = path.join(dataDir, 'baidu');
const baiduConfig = path.join(baiduDir, 'config.json');
const baiduPendingPath = path.join(baiduDir, 'pending.json');
const baiduCandidates = [
  process.env.BDPAN_BIN,
  path.join(root, '.cache', 'bdpan', 'bdpan.exe'),
  path.join(dataDir, 'components', 'bdpan', 'bdpan.exe'),
].filter(Boolean);
const baiduPending = new Map();
let loginState = 'idle';
let loginProcess = null;
const activeTransfers = new Set();
let savedKey = '';

try {
  savedKey = JSON.parse(readFileSync(configPath, 'utf8')).braveApiKey || '';
} catch { /* First run has no local configuration. */ }
try {
  const entries = JSON.parse(readFileSync(baiduPendingPath, 'utf8'));
  for (const [key, entry] of Object.entries(entries)) {
    if (entry && Date.now() - Number(entry.createdAt) < 7 * 86400000) baiduPending.set(key, entry);
  }
} catch { /* No pending transfers yet. */ }

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function localRequest(req) {
  const host = req.headers.host || '';
  const allowedHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  const origin = req.headers.origin;
  return allowedHost && (!origin || origin === `http://${host}`);
}

async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 4096) throw new Error('提交内容过长');
  }
  return JSON.parse(data);
}

async function quarkReady() {
  return Boolean(await quarkPaths());
}

async function quarkPaths() {
  try { await fs.access(packedQuarkCli); await fs.access(packedQuarkLogin);
    return { cli: packedQuarkCli, login: packedQuarkLogin, args: [] };
  } catch { /* Development installation may use a Python virtual environment. */ }
  try { await fs.access(quarkCli); await fs.access(quarkPython);
    return { cli: quarkCli, login: quarkPython, args: [path.join(root, 'quark_login.py')] };
  } catch { return null; }
}

async function baiduCliPath() {
  for (const candidate of baiduCandidates) {
    try { await fs.access(candidate); return candidate; } catch { /* Try next path. */ }
  }
  return null;
}

function baiduArgs(args) {
  return [...args, '--config-path', baiduConfig, '--json', '--no-check-update',
    '--agentname', 'ManjuRadar', '--session-input', '本机用户操作网盘', '--session-id', randomUUID()];
}

async function runBaidu(args, { stdin = '', timeout = 30000 } = {}) {
  const cli = await baiduCliPath();
  if (!cli) throw new Error('component-missing');
  await fs.mkdir(baiduDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(cli, baiduArgs(args), { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (part) => { stdout += part; if (stdout.length > 1024 * 1024) child.kill(); });
    child.stderr.on('data', (part) => { stderr += part; if (stderr.length > 1024 * 1024) child.kill(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout);
        if (code !== 0 || (parsed.code !== undefined && parsed.code !== 0)) return reject(new Error('bdpan-error'));
        resolve(parsed);
      } catch { reject(new Error('bdpan-error')); }
    });
    child.stdin.end(stdin);
  });
}

async function baiduLoggedIn() {
  if (!(await baiduCliPath())) return false;
  try {
    const state = await runBaidu(['whoami'], { timeout: 12000 });
    return state.authenticated === true && state.has_valid_token === true;
  } catch { return false; }
}

async function saveBaiduPending() {
  await fs.mkdir(baiduDir, { recursive: true });
  await fs.writeFile(baiduPendingPath, JSON.stringify(Object.fromEntries(baiduPending)), { mode: 0o600 });
}

async function quarkLoggedIn() {
  const paths = await quarkPaths();
  if (!paths) return false;
  try {
    await runFile(paths.cli, ['auth', 'status'], { env: quarkEnv, timeout: 12000, windowsHide: true });
    return true;
  } catch { return false; }
}

function startQuarkLogin(paths) {
  loginState = 'waiting';
  loginProcess = spawn(paths.login, paths.args, {
    cwd: root,
    env: quarkEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  loginProcess.stdout.on('data', (chunk) => {
    if (chunk.toString().includes('QR_READY')) loginState = 'qr';
  });
  loginProcess.stderr.on('data', () => { /* Keep account details out of HTTP responses. */ });
  loginProcess.on('error', () => { loginState = 'error'; loginProcess = null; });
  loginProcess.on('exit', (code) => {
    loginState = code === 0 ? 'complete' : 'error';
    loginProcess = null;
  });
}

async function braveSearch(query, freshness, apiKey) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '12');
  url.searchParams.set('country', 'CN');
  url.searchParams.set('search_lang', 'zh');
  url.searchParams.set('ui_lang', 'zh-CN');
  url.searchParams.set('result_filter', 'web');
  url.searchParams.set('text_decorations', 'false');
  if (freshness !== 'all') url.searchParams.set('freshness', freshness);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('搜索密钥无效或无权限');
    if (response.status === 429) throw new Error('搜索额度或频率已达到上限');
    throw new Error(`搜索服务返回 ${response.status}`);
  }
  return response.json();
}

async function indexedSearch(keyword, platform, kind, freshness) {
  const url = new URL('https://www.pansousuo.com/api/search');
  url.searchParams.set('q', keyword);
  url.searchParams.set('pan', platform);
  url.searchParams.set('sort', 'latest');
  const response = await fetch(url, { signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error(`公开索引返回 ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.items)) throw new Error('公开索引结果格式有误');
  const limit = { pd: 1, pw: 7, pm: 31 }[freshness];
  const cutoff = limit ? Date.now() - limit * 86400000 : 0;
  return uniqueResults(data.items
    .map((raw) => normalizeIndexResult(raw, platform))
    .filter(Boolean)
    .filter((result) => matchesKind(result, kind))
    .filter((result) => !cutoff || (result.publishedAt && Date.parse(result.publishedAt) >= cutoff)));
}

async function trendingSearch() {
  const platforms = ['baidu', 'quark'];
  const settled = await Promise.allSettled(platforms.map(async (platform) => {
    const url = new URL('https://www.pansousuo.com/api/search');
    url.searchParams.set('q', 'AI漫剧');
    url.searchParams.set('pan', platform);
    url.searchParams.set('sort', 'hot');
    const response = await fetch(url, { signal: AbortSignal.timeout(18000) });
    if (!response.ok) throw new Error(`公开索引返回 ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error('公开索引结果格式有误');
    return data.items.map((raw) => normalizeIndexResult(raw, platform)).filter(Boolean);
  }));
  const errors = {};
  const results = [];
  settled.forEach((entry, index) => {
    if (entry.status === 'fulfilled') results.push(...entry.value);
    else errors[platforms[index]] = entry.reason?.message || '暂时无法读取';
  });
  return { items: selectTrending(results), errors, refreshedAt: new Date().toISOString() };
}

async function searchAll(keyword, kind, freshness, apiKey) {
  const platforms = ['baidu', 'quark'];
  const settled = await Promise.allSettled(platforms.map(async (platform) => {
    let indexError;
    try {
      const indexed = await indexedSearch(keyword, platform, kind, freshness);
      if (indexed.length || !apiKey) return indexed;
    } catch (error) {
      indexError = error;
      if (!apiKey) throw error;
    }
    try {
      const data = await braveSearch(buildQuery(keyword, platform, kind), freshness, apiKey);
      return uniqueResults((data.web?.results || [])
        .map((raw) => normalizeResult(raw, platform))
        .filter(Boolean));
    } catch (error) {
      throw indexError || error;
    }
  }));
  const results = {};
  const errors = {};
  settled.forEach((entry, index) => {
    const platform = platforms[index];
    if (entry.status === 'fulfilled') results[platform] = entry.value;
    else {
      results[platform] = [];
      errors[platform] = entry.reason?.message || '搜索暂时失败';
    }
  });
  return { results, errors, searchedAt: new Date().toISOString() };
}

const server = http.createServer(async (req, res) => {
  if (!localRequest(req)) return json(res, 403, { error: '仅允许本机访问' });
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/status' && req.method === 'GET') {
    return json(res, 200, { app: 'manju-radar', configured: Boolean(process.env.BRAVE_SEARCH_API_KEY || savedKey), indexed: true });
  }

  if (url.pathname === '/api/quark/status' && req.method === 'GET') {
    return json(res, 200, {
      installed: await quarkReady(),
      loggedIn: await quarkLoggedIn(),
      loginState,
    });
  }

  if (url.pathname === '/api/quark/login' && req.method === 'POST') {
    const paths = await quarkPaths();
    if (!paths) return json(res, 503, { error: '夸克转存组件尚未安装，请查看使用说明' });
    if (loginProcess) return json(res, 200, { loginState });
    try {
      await fs.mkdir(quarkDir, { recursive: true });
      await fs.rm(qrPath, { force: true });
      startQuarkLogin(paths);
      return json(res, 200, { loginState });
    } catch {
      return json(res, 500, { error: '无法启动夸克扫码登录' });
    }
  }

  if (url.pathname === '/api/quark/qr' && req.method === 'GET') {
    if (loginState !== 'qr') return json(res, 404, { error: '二维码尚未就绪' });
    try {
      const image = await fs.readFile(qrPath);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(image);
    } catch { return json(res, 404, { error: '二维码尚未就绪' }); }
  }

  if (url.pathname === '/api/quark/transfer' && req.method === 'POST') {
    if (!(await quarkLoggedIn())) return json(res, 401, { error: '请先扫码登录夸克网盘' });
    let input;
    try { input = await readJson(req); }
    catch { return json(res, 400, { error: '转存信息格式有误' }); }
    const share = quarkShareInput(input.shareUrl, input.accessCode);
    if (!share) return json(res, 400, { error: '仅支持有效的夸克网盘分享链接' });
    if (activeTransfers.has(share)) return json(res, 409, { error: '该资源正在转存，请稍候' });
    activeTransfers.add(share);
    try {
      const paths = await quarkPaths();
      const result = await runFile(paths.cli, ['save', share, '--folder', '/AI漫剧', '--save-all', '--wait', '--timeout', '90'], {
        cwd: root, env: quarkEnv, timeout: 115000, maxBuffer: 1024 * 1024, windowsHide: true,
      });
      if (!result.stdout.includes('转存成功')) throw new Error('no-success');
      return json(res, 200, { saved: true, folder: '/AI漫剧' });
    } catch {
      return json(res, 502, { error: '转存未完成。请检查分享链接、提取码或网盘空间后重试。' });
    } finally { activeTransfers.delete(share); }
  }

  if (url.pathname === '/api/baidu/status' && req.method === 'GET') {
    return json(res, 200, { installed: Boolean(await baiduCliPath()), loggedIn: await baiduLoggedIn() });
  }

  if (url.pathname === '/api/baidu/auth-url' && req.method === 'POST') {
    if (!(await baiduCliPath())) return json(res, 503, { error: '请先安装百度转存组件' });
    try {
      const result = await runBaidu(['login', '--get-auth-url', '--accept-disclaimer']);
      const authUrl = new URL(result.data?.auth_url);
      if (authUrl.protocol !== 'https:' || authUrl.hostname !== 'openapi.baidu.com') throw new Error('invalid-auth-url');
      return json(res, 200, { authUrl: authUrl.href });
    } catch { return json(res, 502, { error: '暂时无法取得百度官方授权链接，请稍后重试' }); }
  }

  if (url.pathname === '/api/baidu/login' && req.method === 'POST') {
    if (!(await baiduCliPath())) return json(res, 503, { error: '请先安装百度转存组件' });
    let input;
    try { input = await readJson(req); } catch { return json(res, 400, { error: '授权码格式有误' }); }
    const code = String(input.code || '').trim();
    if (!/^[A-Za-z0-9._-]{8,512}$/.test(code)) return json(res, 400, { error: '请输入百度授权页面显示的完整授权码' });
    try {
      await runBaidu(['login', '--set-code-stdin', '--accept-disclaimer'], { stdin: `${code}\n`, timeout: 45000 });
      if (!(await baiduLoggedIn())) throw new Error('not-logged-in');
      return json(res, 200, { loggedIn: true });
    } catch { return json(res, 401, { error: '百度授权未完成。请重新获取链接，并复制新的授权码。' }); }
  }

  if (url.pathname === '/api/baidu/transfer' && req.method === 'POST') {
    if (!(await baiduLoggedIn())) return json(res, 401, { error: '请先授权登录百度网盘' });
    let input;
    try { input = await readJson(req); } catch { return json(res, 400, { error: '转存信息格式有误' }); }
    const share = baiduShareInput(input.shareUrl, input.accessCode);
    if (!share) return json(res, 400, { error: '仅支持有效的百度网盘分享链接' });
    const key = createHash('sha256').update(`${share.url}#${share.code}`).digest('hex');
    const pending = baiduPending.get(key);
    if (pending) return json(res, 202, { status: 'submitted', ...pending, existing: true });
    if (activeTransfers.has(key)) return json(res, 409, { error: '该资源正在转存，请稍候' });
    activeTransfers.add(key);
    try {
      const args = ['transfer', share.url, '-d', 'AI漫剧/'];
      if (share.code) args.push('-p', share.code);
      const raw = await runBaidu(args, { timeout: 120000 });
      const result = baiduTransferResult(raw);
      if (result.kind === 'submitted') {
        const entry = { taskId: result.taskId, folder: result.folder, createdAt: Date.now() };
        baiduPending.set(key, entry);
        await saveBaiduPending().catch(() => {});
        return json(res, 202, { status: 'submitted', ...entry });
      }
      if (result.kind !== 'saved') throw new Error('unconfirmed-transfer');
      return json(res, 200, { status: 'saved', files: result.files });
    } catch {
      return json(res, 502, { error: '转存未确认完成。请先到百度网盘核对，再决定是否重试。' });
    } finally { activeTransfers.delete(key); }
  }

  if (url.pathname === '/api/config' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const key = String(body.braveApiKey || '').trim();
      if (key.length < 12 || key.length > 300 || /\s/.test(key)) {
        return json(res, 400, { error: '请输入有效的 Brave Search API 密钥' });
      }
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(configPath, JSON.stringify({ braveApiKey: key }), { encoding: 'utf8', mode: 0o600 });
      savedKey = key;
      return json(res, 200, { configured: true });
    } catch (error) {
      return json(res, 400, { error: error.message || '保存失败' });
    }
  }

  if (url.pathname === '/api/search' && req.method === 'GET') {
    const keyword = cleanQuery(url.searchParams.get('q'));
    const kind = url.searchParams.get('kind') || 'works';
    const freshness = url.searchParams.get('freshness') || 'all';
    if (!keyword) return json(res, 400, { error: '请输入搜索关键词' });
    if (!['works', 'making', 'all'].includes(kind) || !['all', 'pd', 'pw', 'pm'].includes(freshness)) {
      return json(res, 400, { error: '搜索选项无效' });
    }
    const externalLinks = searchLinks(keyword, kind);
    const apiKey = process.env.BRAVE_SEARCH_API_KEY || savedKey;
    const data = await searchAll(keyword, kind, freshness, apiKey);
    return json(res, 200, { mode: 'integrated', externalLinks, ...data });
  }

  if (url.pathname === '/api/trending' && req.method === 'GET') {
    const data = await trendingSearch();
    return json(res, Object.keys(data.errors).length === 2 ? 502 : 200, data);
  }

  if (req.method !== 'GET') return json(res, 405, { error: '不支持此操作' });
  const routes = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
  const file = routes[url.pathname];
  if (!file) return json(res, 404, { error: '页面不存在' });
  try {
    const filePath = path.join(publicDir, file);
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'",
    });
    res.end(content);
  } catch {
    json(res, 500, { error: '页面读取失败' });
  }
});

let fallbackUsed = false;
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && isSea() && !process.env.PORT && !fallbackUsed) {
    fallbackUsed = true;
    server.listen(0, '127.0.0.1');
  } else {
    console.error(`漫剧雷达启动失败：${error.message}`);
    process.exitCode = 1;
  }
});
server.on('listening', () => {
  port = server.address().port;
  console.log(`漫剧雷达已启动：http://127.0.0.1:${port}`);
  if (isSea() && !process.argv.includes('--no-browser')) {
    const browser = spawn('explorer.exe', [`http://127.0.0.1:${port}/`], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.error('浏览器未能自动打开，请手动访问上方地址。'));
  }
});
server.listen(port, '127.0.0.1');

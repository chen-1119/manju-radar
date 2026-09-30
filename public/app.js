const $ = (selector) => document.querySelector(selector);
const form = $('#search-form');
const searchButton = $('.search-button');
const status = $('#search-status');
const modeNote = $('#mode-note');
const connectionLabel = $('#connection-label');
let quarkLoggedIn = false;
let baiduLoggedIn = false;
let quarkPoll = null;
let qrShown = false;

async function refreshQuarkStatus() {
  try {
    const response = await fetch('/api/quark/status');
    const data = await response.json();
    quarkLoggedIn = data.loggedIn;
    const active = ['waiting', 'qr'].includes(data.loginState);
    $('#quark-auth-label').textContent = !data.installed ? '转存组件未安装' : data.loggedIn ? '已登录夸克网盘' : active ? '等待扫码登录' : '尚未登录夸克网盘';
    $('.drive-state-dot').classList.toggle('online', data.loggedIn);
    $('#quark-login-button').disabled = active;
    $('#quark-login-button').firstChild.textContent = data.loggedIn ? '重新扫码登录 ' : '扫码登录夸克网盘 ';
    if (data.loginState === 'qr' && !qrShown) {
      $('#quark-qr').src = `/api/quark/qr?t=${Date.now()}`;
      $('#quark-qr-wrap').hidden = false;
      $('#quark-auth-message').textContent = '扫码并在夸克 App 中确认登录。';
      qrShown = true;
    }
    if (data.loggedIn || data.loginState === 'error') {
      $('#quark-qr-wrap').hidden = true;
      qrShown = false;
      if (data.loggedIn) $('#quark-auth-message').textContent = '现在可以在夸克搜索结果中点击“一键转存”。';
      else $('#quark-auth-message').textContent = '扫码未完成或已过期，请重新扫码。';
    }
    if (!data.installed) $('#quark-auth-message').textContent = '请先双击“安装夸克转存组件.cmd”。';
    if (active && !quarkPoll) quarkPoll = setInterval(refreshQuarkStatus, 2500);
    if (!active && quarkPoll) { clearInterval(quarkPoll); quarkPoll = null; }
    document.querySelectorAll('.quark-transfer-button:not([data-busy])').forEach((button) => {
      button.textContent = quarkLoggedIn ? '一键转存' : '登录后转存';
    });
  } catch {
    $('#quark-auth-label').textContent = '登录状态暂时无法读取';
  }
}

$('#quark-login-button').addEventListener('click', async () => {
  const button = $('#quark-login-button');
  button.disabled = true;
  $('#quark-auth-message').textContent = '正在获取登录二维码…';
  try {
    const response = await fetch('/api/quark/login', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '登录无法启动');
    await refreshQuarkStatus();
  } catch (error) {
    button.disabled = false;
    $('#quark-auth-message').textContent = error.message || '登录无法启动';
  }
});

async function refreshBaiduStatus() {
  try {
    const response = await fetch('/api/baidu/status');
    const data = await response.json();
    baiduLoggedIn = data.loggedIn;
    $('#baidu-auth-label').textContent = !data.installed ? '转存组件未安装' : data.loggedIn ? '已授权百度网盘' : '尚未授权百度网盘';
    $('#baidu-state-dot').classList.toggle('online', data.loggedIn);
    $('#baidu-auth-button').disabled = !data.installed;
    $('#baidu-auth-button').firstChild.textContent = data.loggedIn ? '重新获取百度授权链接 ' : '同意并获取百度授权链接 ';
    $('#baidu-auth-message').textContent = !data.installed
      ? '请先双击“安装百度转存组件.cmd”。'
      : data.loggedIn ? '现在可以在百度结果中点击“一键转存”。' : '先获取授权链接，登录后把授权码填回本机页面。';
    document.querySelectorAll('.baidu-transfer-button:not([data-busy])').forEach((button) => {
      button.textContent = baiduLoggedIn ? '一键转存' : '授权后转存';
    });
  } catch { $('#baidu-auth-label').textContent = '授权状态暂时无法读取'; }
}

$('#baidu-auth-button').addEventListener('click', async () => {
  const button = $('#baidu-auth-button');
  button.disabled = true;
  $('#baidu-auth-message').textContent = '正在取得百度官方授权链接…';
  try {
    const response = await fetch('/api/baidu/auth-url', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '无法取得授权链接');
    $('#baidu-auth-link').href = data.authUrl;
    $('#baidu-auth-link').hidden = false;
    $('#baidu-code-form').hidden = false;
    $('#baidu-auth-message').textContent = '打开官方页面完成登录，再把授权码粘贴到下方。';
  } catch (error) { $('#baidu-auth-message').textContent = error.message || '无法取得授权链接'; }
  finally { button.disabled = false; }
});

$('#baidu-code-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#baidu-code-form button');
  button.disabled = true;
  $('#baidu-auth-message').textContent = '正在验证授权码…';
  try {
    const response = await fetch('/api/baidu/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: $('#baidu-code').value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '授权未完成');
    $('#baidu-code').value = '';
    $('#baidu-code-form').hidden = true;
    $('#baidu-auth-link').hidden = true;
    await refreshBaiduStatus();
  } catch (error) { $('#baidu-auth-message').textContent = error.message || '授权未完成'; }
  finally { button.disabled = false; }
});

async function getStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    connectionLabel.textContent = data.configured ? '索引 + 网页搜索已就绪' : '双平台索引已就绪';
  } catch {
    connectionLabel.textContent = '服务连接失败';
  }
}

function showEmpty(platform, title, message) {
  const holder = $(`#${platform}-results`);
  holder.replaceChildren();
  const box = document.createElement('div');
  box.className = 'empty-state';
  const symbol = document.createElement('span');
  symbol.className = 'empty-symbol';
  symbol.textContent = '⌕';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const text = document.createElement('p');
  text.textContent = message;
  box.append(symbol, strong, text);
  holder.append(box);
  $(`#${platform}-count`).textContent = '0';
}

function createResultCard(result) {
  const card = document.createElement('article');
  card.className = 'result-card';
  const meta = document.createElement('div');
  meta.className = 'result-meta';
  const tag = document.createElement('span');
  tag.className = result.direct ? 'tag direct-tag' : 'tag';
  tag.textContent = result.direct ? '网盘直达' : '来源网页';
  const age = document.createElement('span');
  age.textContent = result.age || '';
  meta.append(tag, age);

  const title = document.createElement('h4');
  const link = document.createElement('a');
  link.href = result.shareUrl || result.sourceUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = result.title;
  title.append(link);

  const description = document.createElement('p');
  description.className = 'result-description';
  description.textContent = result.description || (result.direct ? '点击标题打开网盘分享。' : '打开来源页面查看资源详情。');

  if (result.accessCode) {
    const code = document.createElement('p');
    code.className = 'access-code';
    code.textContent = `提取码：${result.accessCode}`;
    card.append(meta, title, description, code);
  } else card.append(meta, title, description);

  const bottom = document.createElement('div');
  bottom.className = 'result-bottom';
  const domain = document.createElement('span');
  domain.textContent = result.sourceName || new URL(result.sourceUrl).hostname;
  const actions = document.createElement('div');
  actions.className = 'result-actions';
  if (result.direct && ['quark', 'baidu'].includes(result.platform)) {
    const isBaidu = result.platform === 'baidu';
    const transfer = document.createElement('button');
    transfer.type = 'button';
    transfer.className = isBaidu ? 'baidu-transfer-button' : 'quark-transfer-button';
    transfer.textContent = isBaidu ? (baiduLoggedIn ? '一键转存' : '授权后转存') : (quarkLoggedIn ? '一键转存' : '登录后转存');
    transfer.addEventListener('click', async () => {
      if (!(isBaidu ? baiduLoggedIn : quarkLoggedIn)) {
        $(isBaidu ? '#baidu-login-section' : '#quark-login-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      transfer.disabled = true;
      transfer.dataset.busy = 'true';
      transfer.textContent = '转存中…';
      let message = card.querySelector('.transfer-status');
      if (!message) {
        message = document.createElement('p');
        message.className = 'transfer-status';
        message.setAttribute('role', 'status');
        card.append(message);
      }
      message.textContent = isBaidu ? '正在提交到百度网盘，请稍候…' : '正在保存到夸克网盘 /AI漫剧，请稍候…';
      try {
        const response = await fetch(isBaidu ? '/api/baidu/transfer' : '/api/quark/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shareUrl: result.shareUrl, accessCode: result.accessCode || '' }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '转存失败');
        if (isBaidu && data.status === 'submitted') {
          transfer.textContent = '任务已提交';
          message.textContent = `转存任务已提交${data.taskId ? `（任务号 ${data.taskId}）` : ''}。请稍后在百度网盘“我的应用数据 / bdpan / AI漫剧”核对，不要重复提交。`;
        } else if (isBaidu && data.status === 'saved') {
          transfer.textContent = '已转存';
          const paths = data.files.slice(0, 5).map((file) => file.path || file.name).join('；');
          message.textContent = `已保存到百度网盘：${paths}${data.files.length > 5 ? `；等 ${data.files.length} 项` : ''}`;
        } else {
          transfer.textContent = '已转存';
          message.textContent = '已保存到夸克网盘 /AI漫剧。';
        }
      } catch (error) {
        message.textContent = error.message || '转存失败';
        transfer.disabled = false;
        delete transfer.dataset.busy;
        transfer.textContent = '重试转存';
      }
    });
    actions.append(transfer);
  }
  const source = document.createElement('a');
  source.href = result.shareUrl || result.sourceUrl;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.textContent = result.direct ? '查看分享 ↗' : '查看来源 ↗';
  actions.append(source);
  bottom.append(domain, actions);
  card.append(bottom);
  return card;
}

async function loadHot() {
  const button = $('#hot-refresh');
  const holder = $('#hot-results');
  const hotStatus = $('#hot-status');
  button.disabled = true;
  hotStatus.textContent = '正在更新热门内容…';
  try {
    const response = await fetch('/api/trending');
    const data = await response.json();
    if (!response.ok) throw new Error('热门内容暂时无法加载，请稍后重试。');
    const items = data.items || [];
    if (items.length) {
      holder.replaceChildren(...items.map((result) => {
        const card = createResultCard(result);
        card.classList.add('hot-card');
        card.querySelector('.tag').textContent = result.platform === 'baidu' ? '百度网盘' : '夸克网盘';
        return card;
      }));
      const time = new Date(data.refreshedAt).toLocaleString('zh-CN', { hour12: false });
      const partial = Object.keys(data.errors || {}).length ? ' · 部分平台暂时不可用' : '';
      hotStatus.textContent = `更新于 ${time} · 共 ${items.length} 条${partial}`;
    } else {
      const empty = document.createElement('div');
      empty.className = 'hot-empty';
      empty.textContent = '最近 31 天暂无匹配的热门内容。可以在下方输入作品名搜索。';
      holder.replaceChildren(empty);
      hotStatus.textContent = '暂无近期热门内容';
    }
  } catch (error) {
    const empty = document.createElement('div');
    empty.className = 'hot-empty';
    empty.textContent = error.message || '热门内容暂时无法加载，请稍后重试。';
    holder.replaceChildren(empty);
    hotStatus.textContent = '加载失败';
  } finally { button.disabled = false; }
}

$('#hot-refresh').addEventListener('click', loadHot);

function setExternalLinks(links) {
  for (const platform of ['baidu', 'quark']) {
    const anchor = $(`#${platform}-external`);
    if (links?.[platform]) {
      anchor.href = links[platform];
      anchor.hidden = false;
    } else anchor.hidden = true;
  }
}

function renderResults(data) {
  setExternalLinks(data.externalLinks);
  if (data.mode === 'external') {
    modeNote.hidden = false;
    modeNote.textContent = '当前使用免配置模式。点击每栏的“网页搜索”可查看实时搜索结果；设置密钥后，结果会直接显示在这里。';
    status.textContent = '已生成双平台实时搜索入口';
    for (const platform of ['baidu', 'quark']) {
      showEmpty(platform, '已准备好网页搜索', '点击右上角“网页搜索”，查看此平台的最新公开网页结果。');
    }
    return;
  }

  modeNote.hidden = false;
  modeNote.textContent = '百度授权、夸克扫码登录后，两个平台的直达分享都可一键转存。公开索引可能延迟，分享链接有效性尚未验证。';
  const time = new Date(data.searchedAt).toLocaleString('zh-CN', { hour12: false });
  status.textContent = `查询于 ${time}`;
  for (const platform of ['baidu', 'quark']) {
    if (data.errors?.[platform]) {
      showEmpty(platform, '搜索暂时失败', data.errors[platform]);
      continue;
    }
    const results = data.results?.[platform] || [];
    $(`#${platform}-count`).textContent = String(results.length);
    if (!results.length) {
      showEmpty(platform, '没有找到匹配结果', '试试缩短关键词、放宽时间范围，或打开网页搜索。');
      continue;
    }
    $(`#${platform}-results`).replaceChildren(...results.map(createResultCard));
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const keyword = $('#keyword').value.trim();
  if (!keyword) return;
  const kind = form.elements.kind.value;
  const freshness = $('#freshness').value;
  const params = new URLSearchParams({ q: keyword, kind, freshness });
  searchButton.disabled = true;
  searchButton.querySelector('span').textContent = '搜索中…';
  status.textContent = '正在查询公开网页索引…';
  modeNote.hidden = true;
  try {
    const response = await fetch(`/api/search?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '搜索失败');
    renderResults(data);
    $('.results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    status.textContent = error.message || '搜索失败，请稍后重试';
  } finally {
    searchButton.disabled = false;
    searchButton.querySelector('span').textContent = '开始搜索';
  }
});

document.querySelectorAll('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    $('#keyword').value = button.dataset.example;
    if (button.dataset.kind) form.elements.kind.value = button.dataset.kind;
    $('#keyword').focus();
  });
});

$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = $('#api-key').value.trim();
  const message = $('#settings-status');
  message.textContent = '正在保存…';
  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ braveApiKey: key }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '保存失败');
    $('#api-key').value = '';
    message.textContent = '已保存在本机。索引没有结果时会补充公开网页搜索。';
    connectionLabel.textContent = '索引 + 网页搜索已就绪';
    $('#settings-details').open = false;
  } catch (error) {
    message.textContent = error.message || '保存失败';
  }
});

getStatus();
refreshBaiduStatus();
refreshQuarkStatus();
loadHot();

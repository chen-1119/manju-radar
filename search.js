export const PLATFORMS = {
  baidu: { name: '百度网盘', hint: '百度网盘 分享' },
  quark: { name: '夸克网盘', hint: '夸克网盘 分享' },
};

const KIND_HINTS = {
  works: 'AI漫剧',
  making: 'AI漫剧 制作 教程 素材',
  all: 'AI漫剧',
};

export function cleanQuery(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

export function buildQuery(keyword, platform, kind = 'works') {
  const topic = cleanQuery(keyword);
  if (!topic) throw new Error('请输入搜索关键词');
  if (!PLATFORMS[platform]) throw new Error('未知网盘');
  if (!KIND_HINTS[kind]) throw new Error('未知资源类型');
  return `${topic} ${KIND_HINTS[kind]} ${PLATFORMS[platform].hint}`;
}

export function searchLinks(keyword, kind = 'works') {
  return Object.fromEntries(Object.keys(PLATFORMS).map((platform) => {
    const query = buildQuery(keyword, platform, kind);
    return [platform, `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`];
  }));
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function directShareUrl(text, platform) {
  const pattern = platform === 'baidu'
    ? /https?:\/\/pan\.baidu\.com\/s\/[\w-]+/i
    : /https?:\/\/pan\.quark\.cn\/s\/[\w-]+/i;
  return safeHttpUrl(text.match(pattern)?.[0]);
}

export function normalizeResult(raw, platform) {
  const sourceUrl = safeHttpUrl(raw?.url);
  if (!sourceUrl) return null;
  const title = cleanText(raw.title) || sourceUrl;
  const description = cleanText(raw.description);
  const shareUrl = directShareUrl(`${sourceUrl} ${description}`, platform);
  return {
    title,
    description,
    sourceUrl,
    shareUrl,
    direct: Boolean(shareUrl),
    platform,
    age: cleanText(raw.age),
    sourceName: '公开网页',
  };
}

export function normalizeIndexResult(raw, platform) {
  if (raw?.pan !== platform) return null;
  const shareUrl = safeHttpUrl(raw.share_url);
  if (!shareUrl) return null;
  const url = new URL(shareUrl);
  const hostname = platform === 'baidu' ? 'pan.baidu.com' : 'pan.quark.cn';
  if (url.hostname !== hostname || !url.pathname.startsWith('/s/')) return null;
  const date = new Date(raw.published_at || raw.created_at || '');
  const age = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN');
  return {
    title: cleanText(raw.title) || shareUrl,
    description: cleanText(raw.description),
    sourceUrl: shareUrl,
    shareUrl,
    direct: true,
    platform,
    age,
    publishedAt: age ? date.toISOString() : null,
    heat: Math.max(0, Number(raw.heat) || 0),
    sourceName: '盘搜索公开索引',
    accessCode: cleanText(raw.access_code),
  };
}

const makingWords = /教程|素材|教学|课程|工具|提示词|工作流|创作|制作|手册|训练营|进阶课|大师课|变现课/;

export function matchesKind(result, kind) {
  if (kind === 'all') return true;
  const making = makingWords.test(result.title);
  return kind === 'making' ? making : !making;
}

export function uniqueResults(results) {
  const seen = new Set();
  return results.filter((result) => {
    const key = result.shareUrl || result.sourceUrl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

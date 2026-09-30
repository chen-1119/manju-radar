import { buildQuery, matchesKind, normalizeAggregateResult, normalizeIndexResult, normalizeResult, uniqueResults } from './search.js';

async function indexedSearch(keyword, platform, kind, freshness, page, fetcher) {
  const url = new URL('https://www.pansousuo.com/api/search');
  url.searchParams.set('q', keyword);
  url.searchParams.set('pan', platform);
  url.searchParams.set('sort', 'latest');
  url.searchParams.set('p', String(page));
  const response = await fetcher(url, { signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error(`公开索引返回 ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.items)) throw new Error('公开索引结果格式有误');
  const limit = { pd: 1, pw: 7, pm: 31 }[freshness];
  const cutoff = limit ? Date.now() - limit * 86400000 : 0;
  const items = data.items.map((raw) => normalizeIndexResult(raw, platform))
    .filter(Boolean)
    .filter((result) => matchesKind(result, kind))
    .filter((result) => !cutoff || (result.publishedAt && Date.parse(result.publishedAt) >= cutoff));
  return { items, hasMore: page < Number(data.totalPages || 1) };
}

async function aggregateSearch(keyword, fetcher, endpoint) {
  const url = new URL('/api/search', endpoint);
  url.searchParams.set('kw', keyword);
  url.searchParams.set('res', 'merge');
  url.searchParams.set('src', 'all');
  url.searchParams.set('cloud_types', 'baidu,quark');
  const response = await fetcher(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`聚合来源返回 ${response.status}`);
  const body = await response.json();
  const data = body.data || body;
  if (body.code && body.code !== 200) throw new Error('聚合来源返回错误');
  if (!data.merged_by_type || typeof data.merged_by_type !== 'object') throw new Error('聚合来源结果格式有误');
  return data.merged_by_type;
}

async function webSearch(keyword, platform, kind, freshness, apiKey, fetcher) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', buildQuery(keyword, platform, kind));
  url.searchParams.set('count', '12');
  url.searchParams.set('country', 'CN');
  url.searchParams.set('search_lang', 'zh');
  url.searchParams.set('ui_lang', 'zh-CN');
  url.searchParams.set('result_filter', 'web');
  url.searchParams.set('text_decorations', 'false');
  if (freshness !== 'all') url.searchParams.set('freshness', freshness);
  const response = await fetcher(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('搜索密钥无效或无权限');
    if (response.status === 429) throw new Error('搜索额度或频率已达到上限');
    throw new Error(`网页搜索返回 ${response.status}`);
  }
  const data = await response.json();
  return (data.web?.results || []).map((raw) => normalizeResult(raw, platform))
    .filter(Boolean).filter((result) => matchesKind(result, kind));
}

export async function searchAll(keyword, kind = 'all', freshness = 'all', apiKey = '', {
  fetcher = fetch, page = 1, includePanSou = true, pansouUrl = 'https://so.252035.xyz',
} = {}) {
  const results = {};
  const errors = {};
  const warnings = {};
  const pagination = {};
  const aggregated = page === 1 && includePanSou ? aggregateSearch(keyword, fetcher, pansouUrl) : null;
  await Promise.all(['baidu', 'quark'].map(async (platform) => {
    const sources = [{ name: '公开索引', request: indexedSearch(keyword, platform, kind, freshness, page, fetcher) }];
    if (aggregated) sources.push({ name: 'PanSou 聚合', request: aggregated.then((data) => {
      const cutoff = ({ pd: 1, pw: 7, pm: 31 }[freshness] || 0) * 86400000;
      return { items: (data[platform] || []).map((raw) => normalizeAggregateResult(raw, platform))
        .filter(Boolean).filter((result) => matchesKind(result, kind))
        .filter((result) => !cutoff || (result.publishedAt && Date.parse(result.publishedAt) >= Date.now() - cutoff)) };
    }) });
    if (page === 1 && apiKey) sources.push({ name: '网页搜索', request: webSearch(keyword, platform, kind, freshness, apiKey, fetcher).then((items) => ({ items })) });
    const settled = await Promise.allSettled(sources.map((source) => source.request));
    const found = [];
    const failures = [];
    let available = 0;
    settled.forEach((entry, index) => {
      if (entry.status === 'fulfilled') {
        available += 1; found.push(...entry.value.items);
        if (index === 0) pagination[platform] = { hasMore: entry.value.hasMore, nextPage: page + 1 };
      }
      else failures.push(`${sources[index].name}：${entry.reason?.message || '暂时无法读取'}`);
    });
    results[platform] = uniqueResults(found);
    pagination[platform] ||= { hasMore: false, nextPage: page + 1 };
    if (!available) errors[platform] = failures.join('；');
    else if (failures.length) warnings[platform] = failures;
  }));
  return { results, errors, warnings, pagination, searchedAt: new Date().toISOString() };
}

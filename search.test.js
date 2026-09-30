import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, cleanQuery, matchesKind, normalizeIndexResult, normalizeResult, searchLinks, uniqueResults } from './search.js';

test('builds separate platform queries and live search URLs', () => {
  assert.equal(cleanQuery('  古风   漫剧  '), '古风 漫剧');
  assert.match(buildQuery('古风漫剧', 'baidu'), /百度网盘 分享/);
  assert.match(buildQuery('古风漫剧', 'quark'), /夸克网盘 分享/);
  const links = searchLinks('古风漫剧');
  assert.match(decodeURIComponent(links.baidu), /百度网盘/);
  assert.match(decodeURIComponent(links.quark), /夸克网盘/);
});

test('normalizes results and rejects unsafe result URLs', () => {
  assert.equal(normalizeResult({ url: 'javascript:alert(1)', title: 'bad' }, 'baidu'), null);
  const result = normalizeResult({
    url: 'https://example.org/post',
    title: '<b>示例作品</b>',
    description: '分享地址 https://pan.quark.cn/s/abc123 提取码 1234',
  }, 'quark');
  assert.equal(result.title, '示例作品');
  assert.equal(result.shareUrl, 'https://pan.quark.cn/s/abc123');
  assert.equal(result.direct, true);
});

test('deduplicates repeated share links', () => {
  const results = [
    { sourceUrl: 'https://one.example', shareUrl: 'https://pan.baidu.com/s/abc' },
    { sourceUrl: 'https://two.example', shareUrl: 'https://pan.baidu.com/s/abc' },
  ];
  assert.equal(uniqueResults(results).length, 1);
});

test('accepts only matching official netdisk links from index and filters resource types', () => {
  const raw = {
    pan: 'quark',
    title: 'AI漫剧制作教学手册',
    share_url: 'https://pan.quark.cn/s/abc123',
    published_at: '2026-09-23T12:08:49+08:00',
  };
  const result = normalizeIndexResult(raw, 'quark');
  assert.equal(result.shareUrl, raw.share_url);
  assert.equal(matchesKind(result, 'making'), true);
  assert.equal(matchesKind(result, 'works'), false);
  assert.equal(normalizeIndexResult({ ...raw, share_url: 'https://evil.example/s/abc123' }, 'quark'), null);
});

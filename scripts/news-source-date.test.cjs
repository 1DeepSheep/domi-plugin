const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DomiRepository } = require("./domi-repo.cjs");
const { parseNewsDate, publicIp, fetchPublicHtml, extractPublishedDate, verifyNewsSourceDate, assertNewsSourceDate } = require("./news-source-date.cjs");
const { mockPublicSource } = require("./test-helpers/news-source-fetch.cjs");

const url = "https://news.example.com/articles/one";
const meta = date => `<html><head><meta property="article:published_time" content="${date}"></head><body>示例报道</body></html>`;
const article = epoch => `<section class="content"><div class="article-main"><h1>示例公司融资</h1><div class="article-detail"><div class="info" data-article-publish-time="${epoch}"></div></div></div></section>`;
const jsonld = data => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const publisherUrl = "https://www.36kr.com/p/1000000000000001";
const publisherState = (itemId, publishTime) => `<script>window.initialState=${JSON.stringify({
  articleDetail: { articleDetailData: { data: { itemId, publishTime, widgetTitle: "匿名报道" } },
    articleRecommendData: { nextItem: { itemId: "1000000000000002", publishTime: Date.parse("2026-10-29T12:00:00+08:00") } } }
})};</script>`;
const event = (extra = {}) => ({ eventId: "evt_anonymous", title: "示例公司融资", publishedAt: "2025-10-23", url, summary: "历史融资事件。", ...extra });

function repositoryFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-news-date-"));
  const repository = new DomiRepository({ backend: "local", databasePath: path.join(root, "repository.sqlite3"), libraryDir: path.join(root, "library") });
  t.after(() => { repository.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return repository;
}

test("publication dates require real full-year dates and never default to now", () => {
  for (const value of [undefined, null, "", "10/23", "10月23日", "2026-02-29", "2025-13-01", "2025-10-23T12:00", "2025-10-23T24:00:00Z", "2025-10-23T00:00:00+14:30", "1792713600000"]) {
    assert.throws(() => parseNewsDate(value), { code: "DOMI_NEWS_DATE_UNVERIFIED" });
  }
  assert.equal(parseNewsDate("2024-02-29").day, "2024-02-29");
  assert.equal(parseNewsDate("2025-10-23T09:00:00+08:00").epoch, Date.parse("2025-10-23T01:00:00Z"));
});

test("only main-article publication evidence is accepted, never update or recommendation dates", () => {
  for (const html of [
    '<head><meta property="article:modified_time" content="2026-10-23"></head>',
    '<head><meta property="article:published_time" content="10月23日"></head>',
    '<body><aside><meta itemprop="datePublished" content="2026-10-23"></aside></body>',
    '<div class="recommend"><div class="info" data-article-publish-time="1761205727"></div></div>',
    jsonld({ "@type": "NewsArticle", url: "https://news.example.com/other", datePublished: "2026-10-23" }),
    `<!-- ${jsonld({ "@type": "NewsArticle", url, datePublished: "2026-10-23" })} -->`,
    jsonld({ "@type": "ItemList", itemListElement: [{ "@type": "NewsArticle", url, datePublished: "2026-10-23" }] }),
    jsonld({ "@type": "NewsArticle", url, dateModified: "2026-10-23", related: { "@type": "NewsArticle", url, datePublished: "2026-10-23" } })
  ]) assert.throws(() => extractPublishedDate(html, [url]), { code: "DOMI_NEWS_DATE_UNVERIFIED" });
  assert.equal(extractPublishedDate(jsonld({ "@graph": [{ "@type": "NewsArticle", mainEntityOfPage: { "@id": url }, datePublished: "2025-10-23" }] }), [url]).day, "2025-10-23");
  assert.equal(extractPublishedDate(article(1761205727), [url]).day, "2025-10-23");
  assert.throws(() => extractPublishedDate(article(1761205727) + article(1792713600), [url]), { code: "DOMI_NEWS_DATE_UNVERIFIED" });
});

test("equivalent offset timestamps and publisher epoch dates agree across UTC midnight", async () => {
  const html = meta("2025-10-23T00:15:00+08:00") + jsonld({ "@type": "NewsArticle", url, datePublished: "2025-10-22T16:15:00Z" });
  assert.equal(extractPublishedDate(html, [url]).day, "2025-10-23");
  const mock = mockPublicSource(html);
  const input = event({ publishedAt: "2025-10-22T16:15:00Z" });
  assert.ok(await verifyNewsSourceDate(input, null, mock.options));
  const epoch = Date.parse("2025-10-23T00:15:00+08:00") / 1000;
  assert.equal(extractPublishedDate(article(epoch), ["https://m.jiemian.com/article/100001.html"]).day, "2025-10-23");
  assert.throws(() => extractPublishedDate(meta("2025-10-23") + jsonld({ "@type": "NewsArticle", url, datePublished: "2026-10-23" }), [url]), /冲突/);
});

test("dynamic publisher meta needs URL-bound article evidence instead of a render-time date", () => {
  const dynamicMeta = meta("2026-10-29T10:25:12+08:00");
  const epoch = Date.parse("2026-10-24T18:50:23.717+08:00");
  const stateScript = publisherState("1000000000000001", epoch);
  const assignment = stateScript.replace(/^<script>|<\/script>$/g, "");
  for (const html of [dynamicMeta, '<head><meta itemprop="datePublished" content="2026-10-29"></head>',
    dynamicMeta + publisherState("1000000000000002", epoch),
    dynamicMeta + `<!-- ${publisherState("1000000000000001", epoch)} -->`,
    dynamicMeta + '<script>window.initialState={articleDetail:readCurrentDate()};</script>',
    dynamicMeta + `<script>/*\n${assignment}\n*/</script>`,
    dynamicMeta + '<script>const example = `\n' + assignment + '\n`;</script>',
    dynamicMeta + stateScript.replace('<script>', '<script type="application/json">'),
    dynamicMeta + stateScript.replace('<script>', '<script src="https://scripts.example.com/runtime.js">'),
    dynamicMeta + stateScript.replace('<script>', '<script src>'),
    dynamicMeta + `<script>${assignment}window.initialState.articleDetail.articleDetailData.data.publishTime=Date.now();</script>`]) {
    assert.throws(() => extractPublishedDate(html, [publisherUrl]), { code: "DOMI_NEWS_DATE_UNVERIFIED" });
  }
  const verified = extractPublishedDate(dynamicMeta + publisherState("1000000000000001", epoch), [publisherUrl]);
  assert.equal(verified.day, "2026-10-24");
  assert.equal(verified.epoch, epoch);
  assert.equal(verified.offset, 480);
  assert.equal(verified.method, "36kr:article-state:publishTime");
  const withGateway = stateScript.replace('<script>', '<script async>window.__GATEWAY_SIGN__="anonymous";');
  assert.equal(extractPublishedDate(dynamicMeta + withGateway, [publisherUrl]).day, "2026-10-24");
  assert.equal(extractPublishedDate(dynamicMeta + jsonld({ "@type": "NewsArticle", url: publisherUrl,
    datePublished: "2026-10-24T18:50:00+08:00" }), [publisherUrl]).day, "2026-10-24");
  assert.throws(() => extractPublishedDate(dynamicMeta + publisherState("1000000000000001", epoch)
    + jsonld({ "@type": "NewsArticle", url: publisherUrl, datePublished: "2026-10-25" }), [publisherUrl]), /冲突/);
  // The fetched page, not a redirect's original domain, determines the publisher-specific rule.
  assert.equal(extractPublishedDate(dynamicMeta, [publisherUrl, url]).day, "2026-10-29");
  assert.throws(() => extractPublishedDate(dynamicMeta, [url, publisherUrl]), { code: "DOMI_NEWS_DATE_UNVERIFIED" });
});

test("bound publisher state prevents dynamic dates from writing rows or Markdown", async t => {
  const repository = repositoryFixture(t);
  const html = meta("2026-10-29T10:25:12+08:00")
    + publisherState("1000000000000001", Date.parse("2026-10-24T18:50:23.717+08:00"));
  const input = event({ url: publisherUrl, publishedAt: "2026-10-29" });
  await assert.rejects(verifyNewsSourceDate(input, null, mockPublicSource(html).options), { code: "DOMI_NEWS_DATE_MISMATCH" });
  assert.equal(repository.listNews().length, 0);
  assert.deepEqual(fs.readdirSync(path.join(repository.libraryDir, "2.行业动态")), []);
  const corrected = { ...input, publishedAt: "2026-10-24" };
  const receipt = await verifyNewsSourceDate(corrected, null, mockPublicSource(html).options);
  const saved = repository.upsertNews(corrected, { dateReceipt: receipt });
  assert.equal(saved.storageReceipt.publicationDateEvidence.method, "36kr:article-state:publishTime");
  assert.equal(saved.event.publishedAt, Date.parse(corrected.publishedAt));
});

test("independent source year mismatch and forged receipts never write a row or Markdown", async t => {
  const repository = repositoryFixture(t);
  const input = event({ publishedAt: "2026-10-23" });
  await assert.rejects(verifyNewsSourceDate(input, null, mockPublicSource(article(1761205727)).options), { code: "DOMI_NEWS_DATE_MISMATCH" });
  assert.throws(() => repository.upsertNews(input, { dateReceipt: { verified: true, publishedAt: input.publishedAt } }), { code: "DOMI_NEWS_DATE_UNVERIFIED" });
  assert.throws(() => repository.upsertNews(event({ publishedAt: undefined })), { code: "DOMI_NEWS_DATE_UNVERIFIED" });
  assert.equal(repository.listNews().length, 0);
  assert.deepEqual(fs.readdirSync(path.join(repository.libraryDir, "2.行业动态")), []);
});

test("valid receipts are URL/date bound, retained as audit evidence, and same-date edits preserve createdAt", async t => {
  const repository = repositoryFixture(t);
  const input = event();
  const mock = mockPublicSource(meta("2025-10-23"));
  const receipt = await verifyNewsSourceDate(input, null, mock.options);
  assert.throws(() => assertNewsSourceDate({ ...input, url: `${url}/other` }, null, receipt), /必须通过/);
  assert.throws(() => assertNewsSourceDate({ ...input, publishedAt: "2026-10-23" }, null, receipt), /必须通过/);
  const saved = repository.upsertNews(input, { dateReceipt: receipt });
  assert.equal(saved.storageReceipt.publicationDateEvidence.rawPublishedDate, "2025-10-23");
  assert.match(saved.storageReceipt.publicationDateEvidence.evidenceId, /^news_date_/);
  repository.database.exec("UPDATE news_events SET created_at=123, updated_at=456");
  const updatedInput = { ...saved.event, summary: "补充信息。" };
  assert.equal(await verifyNewsSourceDate(updatedInput, saved.event, { lookup() { throw new Error("same-date edit must not fetch"); } }), null);
  repository.upsertNews(updatedInput);
  const row = repository.database.prepare("SELECT * FROM news_events WHERE event_id=?").get(input.eventId);
  assert.equal(row.created_at, 123);
  assert.ok(row.updated_at > 456);
  assert.equal(row.published_at, Date.parse("2025-10-23"));
  const evidence = JSON.parse(repository.database.prepare("SELECT evidence_json FROM news_source_date_evidence WHERE event_id=?").get(input.eventId).evidence_json);
  assert.equal(evidence.rawPublishedDate, "2025-10-23");
  assert.equal(evidence.url, url);
  assert.match(evidence.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(evidence.verifiedAt > 0);
  assert.equal(evidence.html, undefined);
  assert.throws(() => repository.upsertNews({ ...updatedInput, url: `${url}/other` }), /必须通过/);
  assert.equal(mock.calls.length, 1);
});

test("legacy rows without date evidence remain readable and editable without date changes", t => {
  const repository = repositoryFixture(t);
  repository.database.prepare("INSERT INTO news_events (event_id,title,published_at,url,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("evt_legacy", "旧记录", Date.parse("2025-10-23"), url, 123, 456);
  const legacy = repository.getNews("evt_legacy");
  assert.equal(repository.listNews().length, 1);
  repository.upsertNews({ ...legacy, summary: "只编辑摘要。" });
  assert.equal(repository.getNews("evt_legacy").summary, "只编辑摘要。");
  assert.equal(repository.database.prepare("SELECT count(*) AS n FROM news_source_date_evidence").get().n, 0);
});

test("changing an offset cannot bypass verification by keeping the old literal calendar date", () => {
  const existing = event({ publishedAt: Date.parse("2025-12-31T12:00:00Z") });
  const input = event({ publishedAt: "2025-12-31T23:30:00-12:00" });
  assert.throws(() => assertNewsSourceDate(input, existing), /必须通过/);
});

test("private, loopback, credential and non-HTTP URLs fail before requesting", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.100.100.200", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001::1", "2001:db8::1", "2002:7f00:1::"]) assert.equal(publicIp(address), false, address);
  assert.equal(publicIp("2606:4700:4700::1111"), true);
  assert.equal(publicIp("2001:4860:4860::8888"), true);
  for (const target of ["http://127.0.0.1/", "http://2130706433/", "http://0x7f000001/", "http://[::1]/", "http://localhost/", "http://private.local/", "https://user:secret@example.com/", "file:///tmp/article", "ftp://news.example.com/"]) {
    const mock = mockPublicSource(meta("2025-10-23"));
    await assert.rejects(fetchPublicHtml(target, mock.options));
    assert.equal(mock.calls.length, 0, target);
  }
  const mock = mockPublicSource(meta("2025-10-23"));
  await assert.rejects(fetchPublicHtml(url, { ...mock.options, lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }] }), /私有网络/);
  assert.equal(mock.calls.length, 0);
});

test("redirects revalidate destinations and requests pin DNS without credentials", async () => {
  const mock = mockPublicSource({ status: 302, headers: { location: "http://127.0.0.1/private" } });
  await assert.rejects(fetchPublicHtml("http://news.example.com/", mock.options), /私有网络/);
  assert.equal(mock.calls.length, 1);
  const dnsRedirect = mockPublicSource({ status: 302, headers: { location: "https://private.example.com/" } });
  await assert.rejects(fetchPublicHtml(url, { ...dnsRedirect.options, lookup: async host => [{ address: host.startsWith("private") ? "10.0.0.1" : "93.184.216.34", family: 4 }] }), /私有网络/);
  assert.equal(dnsRedirect.calls.length, 1);
  const success = mockPublicSource(meta("2025-10-23"));
  await fetchPublicHtml(url, success.options);
  const settings = success.calls[0].settings;
  assert.equal(settings.headers.cookie, undefined);
  assert.equal(settings.headers.authorization, undefined);
  assert.equal(settings.agent, false);
  await new Promise((resolve, reject) => settings.lookup("ignored.invalid", { all: true }, (error, addresses) => {
    if (error) return reject(error);
    assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]); resolve();
  }));
  const loop = mockPublicSource({ status: 302, headers: { location: url } });
  await assert.rejects(fetchPublicHtml(url, loop.options), /重定向/);
  assert.equal(loop.calls.length, 5);
});

test("source fetching enforces body size, request timeout, and DNS timeout", async () => {
  await assert.rejects(fetchPublicHtml(url, { ...mockPublicSource("x".repeat(100)).options, maxBytes: 20 }), /大小限制/);
  await assert.rejects(fetchPublicHtml(url, { ...mockPublicSource({ hang: true }).options, timeoutMs: 15 }), /超时/);
  await assert.rejects(fetchPublicHtml(url, { ...mockPublicSource("").options, lookup: () => new Promise(() => {}), timeoutMs: 15 }), /超时/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertPublicEpisodeUrl,
  downloadPublicEpisode,
  extractPublicEpisode,
} = require("./xiaoyuzhou-public.js");

const episodeUrl = "https://www.xiaoyuzhoufm.com/episode/example123";

test("extracts a free direct audio URL from public PodcastEpisode JSON-LD", () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="备用标题">
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "PodcastEpisode",
      name: "AI 芯片行业访谈",
      description: "公开单集简介",
      datePublished: "2026-08-07T08:00:00+08:00",
      duration: "PT42M",
      isAccessibleForFree: true,
      partOfSeries: { "@type": "PodcastSeries", name: "测试播客" },
      associatedMedia: {
        "@type": "MediaObject",
        contentUrl: "https://cdn.example.com/audio/episode.m4a?public=1",
        encodingFormat: "audio/mp4",
      },
    })}</script>
  </head></html>`;
  const result = extractPublicEpisode(html, episodeUrl);
  assert.equal(result.title, "AI 芯片行业访谈");
  assert.equal(result.podcastName, "测试播客");
  assert.equal(result.audio.url, "https://cdn.example.com/audio/episode.m4a?public=1");
  assert.match(result.audio.source, /json-ld/);
});

test("uses only an embedded public enclosure or og:audio fallback", () => {
  const enclosureHtml = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { episode: { enclosure: { url: "https://cdn.example.com/public/episode.mp3", type: "audio/mpeg" } } } },
  })}</script>`;
  assert.equal(extractPublicEpisode(enclosureHtml, episodeUrl).audio.source, "embedded-json:enclosure");

  const ogHtml = '<meta property="og:audio" content="https://cdn.example.com/public/episode.m4a"><meta property="og:audio:type" content="audio/mp4">';
  assert.equal(extractPublicEpisode(ogHtml, episodeUrl).audio.source, "og:audio");
});

test("rejects non-episode URLs, paid episodes and HLS-only pages", () => {
  assert.throws(() => assertPublicEpisodeUrl("https://example.com/episode/abc"), /XIAOYUZHOU_INVALID_URL/);
  assert.throws(() => assertPublicEpisodeUrl("https://www.xiaoyuzhoufm.com/podcast/abc"), /XIAOYUZHOU_INVALID_URL/);

  const paid = `<script type="application/ld+json">${JSON.stringify({
    "@type": "PodcastEpisode",
    isAccessibleForFree: false,
    associatedMedia: { contentUrl: "https://cdn.example.com/audio/paid.m4a", encodingFormat: "audio/mp4" },
  })}</script>`;
  assert.throws(() => extractPublicEpisode(paid, episodeUrl), /XIAOYUZHOU_RESTRICTED_EPISODE/);

  const hls = '<meta property="og:audio" content="https://cdn.example.com/audio/stream.m3u8"><meta property="og:audio:type" content="audio/mpeg">';
  assert.throws(() => extractPublicEpisode(hls, episodeUrl), /XIAOYUZHOU_PUBLIC_AUDIO_UNAVAILABLE/);
});

test("downloads public audio without cookies and keeps a private local file", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "domi-xiaoyuzhou-test-"));
  const outputPath = path.join(sandbox, "episode.m4a");
  const calls = [];
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "PodcastEpisode",
    name: "公开测试单集",
    isAccessibleForFree: true,
    associatedMedia: { contentUrl: "https://cdn.example.com/audio/test.m4a", encodingFormat: "audio/mp4" },
  })}</script>`;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("xiaoyuzhoufm.com")) {
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response(Buffer.from("test-audio"), {
      status: 200,
      headers: { "content-type": "audio/mp4", "content-length": "10" },
    });
  };

  const result = await downloadPublicEpisode(episodeUrl, outputPath, { fetchImpl, maxBytes: 1024 });
  assert.equal(result.bytes, 10);
  assert.equal(fs.readFileSync(outputPath, "utf8"), "test-audio");
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.credentials, "omit");
    assert.equal(Object.keys(call.options.headers).some((key) => key.toLowerCase() === "cookie"), false);
  }
});

test("rejects a streaming manifest even when the server labels it as audio", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "domi-xiaoyuzhou-hls-test-"));
  const outputPath = path.join(sandbox, "episode.m4a");
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "PodcastEpisode",
    name: "伪装直链的播放列表",
    isAccessibleForFree: true,
    associatedMedia: { contentUrl: "https://cdn.example.com/audio/public-stream", encodingFormat: "audio/mp4" },
  })}</script>`;
  const fetchImpl = async (url) => {
    if (String(url).includes("xiaoyuzhoufm.com")) {
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response("#EXTM3U\n#EXT-X-VERSION:3\n", {
      status: 200,
      headers: { "content-type": "audio/mp4" },
    });
  };

  await assert.rejects(
    downloadPublicEpisode(episodeUrl, outputPath, { fetchImpl, maxBytes: 1024 }),
    /XIAOYUZHOU_RESTRICTED_AUDIO/,
  );
  assert.equal(fs.existsSync(outputPath), false);
  assert.equal(fs.existsSync(`${outputPath}.part`), false);
});

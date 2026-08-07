#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

const XIAOYUZHOU_HOSTS = new Set(["xiaoyuzhoufm.com", "www.xiaoyuzhoufm.com"]);
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DIRECT_AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".mp4",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
]);
const STREAM_PLAYLIST_EXTENSIONS = new Set([".m3u", ".m3u8", ".mpd"]);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hexadecimal) => String.fromCodePoint(parseInt(hexadecimal, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function assertPublicEpisodeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("XIAOYUZHOU_INVALID_URL", "需要有效的小宇宙公开单集 URL");
  }
  if (url.protocol !== "https:" || !XIAOYUZHOU_HOSTS.has(url.hostname.toLowerCase())) {
    fail("XIAOYUZHOU_INVALID_URL", "只接受 xiaoyuzhoufm.com 的 HTTPS 公开单集页面");
  }
  if (!/^\/episode\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    fail("XIAOYUZHOU_INVALID_URL", "只接受 /episode/<id> 格式的公开单集页面");
  }
  url.hash = "";
  return url;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function walkJson(value, visitor, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visitor, seen);
    return;
  }
  for (const child of Object.values(value)) walkJson(child, visitor, seen);
}

function jsonTypeIncludes(value, expected) {
  const types = Array.isArray(value) ? value : [value];
  return types.some((entry) => String(entry || "").toLowerCase() === expected.toLowerCase());
}

function collectUrlCandidate(target, value, source, mimeType = "") {
  const raw = typeof value === "string" ? value : value?.url || value?.contentUrl;
  if (!raw) return;
  let url;
  try {
    url = new URL(decodeHtml(raw));
  } catch {
    return;
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) return;
  target.push({ url: url.toString(), source, mimeType: String(mimeType || value?.encodingFormat || "") });
}

function extractEmbeddedJson(html) {
  const documents = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const attributes = parseAttributes(match[1]);
    const type = String(attributes.type || "").toLowerCase();
    const id = String(attributes.id || "").toLowerCase();
    if (type !== "application/ld+json" && type !== "application/json" && id !== "__next_data__") continue;
    const parsed = safeJsonParse(decodeHtml(match[2]).trim());
    if (parsed) documents.push({ value: parsed, source: type === "application/ld+json" ? "json-ld" : "embedded-json" });
  }
  return documents;
}

function extractOpenGraph(html) {
  const values = new Map();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key = String(attributes.property || attributes.name || "").toLowerCase();
    if (!key || attributes.content == null) continue;
    if (!values.has(key)) values.set(key, attributes.content);
  }
  return values;
}

function booleanValue(value) {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return null;
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  return null;
}

function isDirectAudioCandidate(candidate) {
  const mime = String(candidate.mimeType || "").split(";")[0].trim().toLowerCase();
  if (mime.includes("mpegurl") || mime.includes("dash") || mime.includes("drm")) return false;
  let extension = "";
  try {
    extension = path.extname(new URL(candidate.url).pathname).toLowerCase();
  } catch {
    return false;
  }
  if (STREAM_PLAYLIST_EXTENSIONS.has(extension)) return false;
  return mime.startsWith("audio/") || DIRECT_AUDIO_EXTENSIONS.has(extension);
}

function looksLikeStreamingManifest(buffer) {
  const prefix = buffer.subarray(0, 1024).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  return prefix.startsWith("#EXTM3U") || /^<\?xml[\s\S]{0,400}<MPD\b/i.test(prefix) || /^<MPD\b/i.test(prefix);
}

function extractPublicEpisode(html, episodeUrl) {
  const pageUrl = assertPublicEpisodeUrl(episodeUrl);
  const graph = extractOpenGraph(html);
  const candidates = [];
  let episode = null;
  let freeStatus = null;

  for (const document of extractEmbeddedJson(html)) {
    walkJson(document.value, (object) => {
      if (!episode && jsonTypeIncludes(object["@type"], "PodcastEpisode")) episode = object;
      const currentFree = booleanValue(object.isAccessibleForFree);
      if (currentFree === false) freeStatus = false;
      else if (currentFree === true && freeStatus == null) freeStatus = true;

      collectUrlCandidate(candidates, object.associatedMedia, `${document.source}:associatedMedia`);
      collectUrlCandidate(candidates, object.encoding, `${document.source}:encoding`);
      collectUrlCandidate(candidates, object.audio, `${document.source}:audio`);
      collectUrlCandidate(candidates, object.enclosure, `${document.source}:enclosure`);
      if (object.enclosure && typeof object.enclosure === "object") {
        collectUrlCandidate(
          candidates,
          object.enclosure.url || object.enclosure.contentUrl,
          `${document.source}:enclosure`,
          object.enclosure.type || object.enclosure.encodingFormat,
        );
      }
    });
  }

  const ogAudioType = graph.get("og:audio:type") || "";
  for (const key of ["og:audio", "og:audio:url", "og:audio:secure_url"]) {
    collectUrlCandidate(candidates, graph.get(key), key, ogAudioType);
  }

  if (freeStatus === false) {
    fail("XIAOYUZHOU_RESTRICTED_EPISODE", "付费或受限单集不允许自动下载");
  }

  const directCandidates = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!isDirectAudioCandidate(candidate) || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    directCandidates.push(candidate);
  }
  if (!directCandidates.length) {
    fail(
      "XIAOYUZHOU_PUBLIC_AUDIO_UNAVAILABLE",
      "公开页面没有可直接下载的 MP3/M4A 等音频地址；不会尝试私有 API、登录 Cookie、HLS 或 DRM",
    );
  }

  const series = episode?.partOfSeries;
  const podcastName = Array.isArray(series) ? series[0]?.name : series?.name;
  return {
    provider: "xiaoyuzhou-public-page",
    episodeId: pageUrl.pathname.split("/").filter(Boolean).pop(),
    episodeUrl: pageUrl.toString(),
    title: episode?.name || episode?.headline || graph.get("og:title") || "",
    description: episode?.description || graph.get("og:description") || "",
    podcastName: podcastName || "",
    publishedAt: episode?.datePublished || graph.get("article:published_time") || "",
    duration: episode?.duration || graph.get("music:duration") || "",
    isAccessibleForFree: freeStatus !== false,
    audio: directCandidates[0],
  };
}

async function fetchPublicEpisode(episodeUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") fail("XIAOYUZHOU_RUNTIME_ERROR", "当前 Node 运行时不支持 fetch");
  const pageUrl = assertPublicEpisodeUrl(episodeUrl);
  const response = await fetchImpl(pageUrl, {
    method: "GET",
    redirect: "follow",
    credentials: "omit",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "domi-public-podcast-reader/1.0",
    },
    signal: options.signal,
  });
  if (!response.ok) {
    fail("XIAOYUZHOU_PAGE_UNAVAILABLE", `公开单集页面读取失败（HTTP ${response.status}）`);
  }
  if (response.url) assertPublicEpisodeUrl(response.url);
  return extractPublicEpisode(await response.text(), pageUrl);
}

function parsePositiveInteger(value, fallback) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail("XIAOYUZHOU_INVALID_ARGUMENT", "maxBytes 必须是正整数");
  return number;
}

async function downloadPublicEpisode(episodeUrl, outputPath, options = {}) {
  if (!path.isAbsolute(outputPath)) {
    fail("XIAOYUZHOU_INVALID_ARGUMENT", "下载目标必须是绝对路径");
  }
  const metadata = await fetchPublicEpisode(episodeUrl, options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const maxBytes = parsePositiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
  const partialPath = `${outputPath}.part`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const partialBytes = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
  const headers = {
    accept: "audio/*,application/octet-stream",
    "user-agent": "domi-public-podcast-reader/1.0",
  };
  if (partialBytes > 0) headers.range = `bytes=${partialBytes}-`;

  const response = await fetchImpl(metadata.audio.url, {
    method: "GET",
    redirect: "follow",
    credentials: "omit",
    headers,
    signal: options.signal,
  });
  if (![200, 206].includes(response.status) || !response.body) {
    fail("XIAOYUZHOU_AUDIO_UNAVAILABLE", `公开音频下载失败（HTTP ${response.status}）`);
  }
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (contentType.includes("mpegurl") || contentType.includes("dash") || contentType.includes("drm")) {
    fail("XIAOYUZHOU_RESTRICTED_AUDIO", "不下载 HLS、DASH 或 DRM 音频");
  }
  if (contentType && !contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
    fail("XIAOYUZHOU_INVALID_AUDIO", `公开地址返回了非音频内容（${contentType}）`);
  }

  let append = partialBytes > 0 && response.status === 206;
  if (append) {
    const contentRange = String(response.headers.get("content-range") || "");
    append = contentRange.startsWith(`bytes ${partialBytes}-`);
  }
  const baseBytes = append ? partialBytes : 0;
  const responseBytes = Number(response.headers.get("content-length") || 0);
  if (responseBytes > 0 && baseBytes + responseBytes > maxBytes) {
    fail("XIAOYUZHOU_AUDIO_TOO_LARGE", `音频超过允许的 ${maxBytes} 字节`);
  }

  const limiter = async function* (source) {
    let total = baseBytes;
    let inspectedPrefix = append;
    let prefix = Buffer.alloc(0);
    for await (const chunk of source) {
      total += chunk.length;
      if (total > maxBytes) fail("XIAOYUZHOU_AUDIO_TOO_LARGE", `音频超过允许的 ${maxBytes} 字节`);
      if (!inspectedPrefix) {
        prefix = Buffer.concat([prefix, chunk]).subarray(0, 1024);
        if (looksLikeStreamingManifest(prefix)) {
          fail("XIAOYUZHOU_RESTRICTED_AUDIO", "公开地址返回了 HLS 或 DASH 播放列表，不会抓流");
        }
        if (prefix.length >= 128) inspectedPrefix = true;
      }
      yield chunk;
    }
  };
  const target = fs.createWriteStream(partialPath, {
    flags: append ? "a" : "w",
    mode: 0o600,
  });
  try {
    await pipeline(Readable.fromWeb(response.body), limiter, target);
  } catch (error) {
    target.destroy();
    if (
      new Set([
        "XIAOYUZHOU_AUDIO_TOO_LARGE",
        "XIAOYUZHOU_INVALID_AUDIO",
        "XIAOYUZHOU_RESTRICTED_AUDIO",
      ]).has(error?.code)
    ) {
      fs.rmSync(partialPath, { force: true });
    }
    throw error;
  }
  fs.chmodSync(partialPath, 0o600);
  fs.renameSync(partialPath, outputPath);
  fs.chmodSync(outputPath, 0o600);
  return {
    ok: true,
    provider: metadata.provider,
    episodeId: metadata.episodeId,
    episodeUrl: metadata.episodeUrl,
    title: metadata.title,
    description: metadata.description,
    podcastName: metadata.podcastName,
    publishedAt: metadata.publishedAt,
    duration: metadata.duration,
    audioSource: metadata.audio.source,
    audioMimeType: metadata.audio.mimeType,
    outputPath,
    bytes: fs.statSync(outputPath).size,
  };
}

function optionValue(args, optionName) {
  const index = args.indexOf(optionName);
  if (index < 0) return null;
  if (!args[index + 1]) fail("XIAOYUZHOU_INVALID_ARGUMENT", `${optionName} 缺少值`);
  return args[index + 1];
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  let result;
  if (command === "parse") {
    if (!args[0] || !args[1]) fail("XIAOYUZHOU_USAGE", "parse <htmlFile> <episodeUrl>");
    result = extractPublicEpisode(fs.readFileSync(path.resolve(args[0]), "utf8"), args[1]);
  } else if (command === "resolve") {
    if (!args[0]) fail("XIAOYUZHOU_USAGE", "resolve <episodeUrl>");
    result = await fetchPublicEpisode(args[0]);
  } else if (command === "download") {
    if (!args[0] || !args[1]) fail("XIAOYUZHOU_USAGE", "download <episodeUrl> <absoluteOutputPath> [--max-bytes N]");
    result = await downloadPublicEpisode(args[0], args[1], {
      maxBytes: optionValue(args, "--max-bytes"),
    });
  } else {
    fail("XIAOYUZHOU_USAGE", "命令：parse、resolve、download");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertPublicEpisodeUrl,
  downloadPublicEpisode,
  extractPublicEpisode,
  fetchPublicEpisode,
  isDirectAudioCandidate,
  looksLikeStreamingManifest,
  parseAttributes,
};

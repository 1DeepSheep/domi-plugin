const crypto = require("node:crypto");
const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const receipts = new WeakMap();
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;

function dateError(message, code = "DOMI_NEWS_DATE_UNVERIFIED") {
  return Object.assign(new Error(message), { code });
}

function parseNewsDate(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const epoch = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(epoch);
    if (Number.isFinite(date.getTime())) return { epoch, day: date.toISOString().slice(0, 10), offset: 0, dateOnly: false };
  }
  if (typeof value !== "string") throw dateError("新闻发布时间必须是包含完整年份的有效日期，不能用抓取时间代替。");
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/);
  if (!match) throw dateError("新闻发布时间必须包含完整年月日；具体时间必须带时区，不能根据当前年份补全。");
  const [, y, m, d, h, minute, second, , zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day
    || (h !== undefined && (Number(h) > 23 || Number(minute) > 59 || Number(second || 0) > 59))) {
    throw dateError("新闻发布时间不是有效的日历日期。");
  }
  let offset = 0;
  if (zone && zone !== "Z") {
    const hour = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
    if (hour > 14 || minutes > 59 || (hour === 14 && minutes !== 0)) throw dateError("新闻发布时间的时区无效。");
    offset = (zone[0] === "-" ? -1 : 1) * (hour * 60 + minutes);
  }
  const epoch = Date.parse(value.trim());
  if (!Number.isFinite(epoch)) throw dateError("新闻发布时间无效。");
  return { epoch, day: `${y}-${m}-${d}`, offset, dateOnly: h === undefined };
}

function normalizedUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw dateError("新闻原文必须提供完整的公开 HTTP(S) URL。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw dateError("新闻原文只允许不带凭据的公开 HTTP(S) URL。");
  }
  url.hash = "";
  return url;
}

function publicIp(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (version !== 6) return false;
  // Only global unicast; exclude documentation and special-purpose transition ranges.
  const first = parseInt(address.split(":")[0], 16);
  const second = parseInt(address.split(":")[1] || "0", 16);
  return first >= 0x2000 && first < 0x3fff
    && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8))
    && first !== 0x2002;
}

function remaining(deadline) {
  const left = deadline - Date.now();
  if (left <= 0) throw dateError("核验新闻原文发布时间超时；该条新闻未写入。");
  return left;
}

async function withinDeadline(promise, deadline) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(dateError("核验新闻原文发布时间超时；该条新闻未写入。")), remaining(deadline));
    })]);
  } finally { clearTimeout(timer); }
}

async function resolvePublic(url, lookup, deadline) {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || /\.(?:localhost|local|internal|home|lan)$/.test(host) || (!net.isIP(host) && !host.includes("."))) {
    throw dateError("新闻原文不能访问本机或私有网络地址。");
  }
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }]
    : await withinDeadline(lookup(host, { all: true, verbatim: true }), deadline);
  if (!addresses.length || addresses.some(item => !publicIp(item.address))) throw dateError("新闻原文不能访问本机或私有网络地址。");
  return addresses;
}

async function fetchPublicHtml(value, options = {}) {
  const deadline = Date.now() + Math.min(options.timeoutMs || TIMEOUT_MS, TIMEOUT_MS);
  const maxBytes = Math.min(options.maxBytes || MAX_BYTES, MAX_BYTES);
  const lookup = options.lookup || dns.lookup;
  let url = normalizedUrl(value);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const addresses = await resolvePublic(url, lookup, deadline);
    const response = await new Promise((resolve, reject) => {
      const transport = options.request || (url.protocol === "https:" ? https.request : http.request);
      const request = transport(url, {
        method: "GET", agent: false,
        headers: { accept: "text/html,application/xhtml+xml", "accept-encoding": "identity", "user-agent": "domi-news-date-verifier/1.0" },
        // Pin checked addresses for this request, preventing a second DNS lookup / rebinding.
        lookup: (_host, opts, callback) => {
          if (typeof opts === "function") callback = opts;
          if (opts?.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        }
      }, response => {
        response.on("error", reject);
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.destroy(); resolve({ redirect: response.headers.location }); return;
        }
        if (status < 200 || status >= 300) { response.destroy(); reject(dateError(`新闻原文返回 HTTP ${status}，无法核验发布时间。`)); return; }
        if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
          response.destroy(); reject(dateError("新闻原文返回不支持的压缩格式，无法核验发布时间。")); return;
        }
        if (Number(response.headers["content-length"]) > maxBytes) { response.destroy(); reject(dateError("新闻原文超出日期核验大小限制。")); return; }
        const chunks = []; let length = 0;
        response.on("data", chunk => {
          length += chunk.length;
          if (length > maxBytes) { response.destroy(); reject(dateError("新闻原文超出日期核验大小限制。")); }
          else chunks.push(chunk);
        });
        response.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8") }));
      });
      const timer = setTimeout(() => request.destroy(dateError("核验新闻原文发布时间超时；该条新闻未写入。")), remaining(deadline));
      request.on("error", reject);
      request.on("close", () => clearTimeout(timer));
      request.end();
    });
    if (response.html !== undefined) return { html: response.html, finalUrl: url.href };
    if (!response.redirect || redirects === MAX_REDIRECTS) throw dateError("新闻原文重定向无效或次数过多。");
    const redirected = normalizedUrl(new URL(response.redirect, url).href);
    if (url.protocol === "https:" && redirected.protocol !== "https:") throw dateError("新闻原文不允许重定向到不安全连接。");
    url = redirected;
  }
  throw dateError("无法核验新闻原文发布时间。");
}

function decodeEntities(text) {
  return String(text).replace(/&(?:quot|apos|amp|lt|gt|#(\d+)|#x([\da-f]+));/gi, (match, decimal, hex) => {
    if (decimal || hex) {
      const point = parseInt(decimal || hex, decimal ? 10 : 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return ({ "&quot;": '"', "&apos;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">" })[match.toLowerCase()] || match;
  });
}

function extractPublishedDate(html, sourceUrls = []) {
  const candidates = [];
  const articleUrlMatches = (value) => {
    const values = Array.isArray(value) ? value : [value];
    return values.some(item => {
      const raw = typeof item === "string" ? item : item?.["@id"] || item?.url;
      if (!raw) return false;
      return sourceUrls.some(sourceUrl => {
        try {
          const candidate = normalizedUrl(new URL(raw, sourceUrl).href), source = normalizedUrl(sourceUrl);
          const clean = url => {
            for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
            return `${url.hostname.replace(/^(?:www|m)\./, "")}${url.pathname}${url.search}`;
          };
          return clean(candidate) === clean(source);
        } catch { return false; }
      });
    });
  };
  const add = (raw, method, epoch = false) => {
    if (typeof raw !== "string" && typeof raw !== "number") return;
    try {
      const parsed = parseNewsDate(epoch ? Number(raw) : decodeEntities(raw));
      // This publisher's epoch attribute represents its China-local article time.
      if (epoch && sourceUrls.some(url => /(?:^|\.)jiemian\.com$/i.test(new URL(url).hostname))) {
        parsed.offset = 480;
        parsed.day = new Date(parsed.epoch + parsed.offset * 60_000).toISOString().slice(0, 10);
      }
      candidates.push({ ...parsed, raw: String(raw), method });
    } catch { /* Undated or yearless values are not evidence. */ }
  };
  const uncommented = html.replace(/<!--[\s\S]*?-->/g, "");
  const document = uncommented.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const stack = [], bodyCandidates = [];
  let articleMainCount = 0;
  for (const match of document.matchAll(/<\/?([a-z][\w:-]*)\b[^<>]{0,8192}>/gi)) {
    const tag = match[0], tagName = match[1].toLowerCase(); const attributes = {};
    if (tag.startsWith("</")) {
      const index = stack.map(entry => entry.tagName).lastIndexOf(tagName);
      if (index >= 0) stack.splice(index);
      continue;
    }
    for (const attribute of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      attributes[attribute[1].toLowerCase()] = decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4]);
    }
    const tokens = `${attributes.class || ""} ${attributes.id || ""}`.toLowerCase().split(/\s+/);
    if (tokens.includes("article-main")) articleMainCount += 1;
    const property = (attributes.property || attributes.name || attributes.itemprop || "").toLowerCase();
    const inHead = stack.some(entry => entry.tagName === "head");
    if (inHead && tagName === "meta" && ["article:published_time", "og:published_time", "datepublished", "pubdate", "publication_date", "citation_publication_date", "dc.date.issued"].includes(property)) {
      add(attributes.content, `meta:${property}`);
    }
    if (inHead && property === "datepublished") add(attributes.datetime || attributes.content, "itemprop:datePublished");
    const ancestors = stack.flatMap(entry => entry.tokens);
    const recommended = [...ancestors, ...tokens].some(token => /(?:recommend|related|suggest|latest|sidebar)/.test(token));
    if (attributes["data-article-publish-time"] && tokens.includes("info")
      && ancestors.includes("article-main") && ancestors.includes("article-detail") && !recommended) {
      bodyCandidates.push(attributes["data-article-publish-time"]);
    }
    if (!/\/>$/.test(tag) && !["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(tagName)) {
      stack.push({ tagName, tokens });
    }
  }
  if (articleMainCount === 1 && bodyCandidates.length === 1) add(bodyCandidates[0], "article-main:data-article-publish-time", true);
  for (const script of uncommented.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      const visit = (value, depth = 0) => {
        if (!value || typeof value !== "object" || depth > 24) return;
        if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
        const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
        if (types.some(type => ["ItemList", "ListItem"].includes(type))) return;
        if (types.some(type => ["Article", "NewsArticle", "BlogPosting"].includes(type))
          && (articleUrlMatches(value.url) || articleUrlMatches(value.mainEntityOfPage))) {
          add(value.datePublished, "jsonld:main-article:datePublished");
        }
        // Do not descend into related/embedded articles, authors, recommendations, or lists.
        if (value["@graph"]) visit(value["@graph"], depth + 1);
      };
      visit(JSON.parse(script[1].trim()));
    } catch { /* Invalid structured data cannot prove a publication date. */ }
  }
  if (!candidates.length) throw dateError("新闻原文没有可核验的完整发布日期；不能以更新、抓取时间或当前年份代替。");
  const preferred = candidates.find(candidate => !candidate.dateOnly && !candidate.method.includes("data-article-publish-time"))
    || candidates.find(candidate => !candidate.dateOnly) || candidates[0];
  if (candidates.some(candidate => {
    if (candidate.dateOnly) return candidate.day !== preferred.day;
    if (!preferred.dateOnly && candidate.epoch === preferred.epoch) return false;
    return new Date(candidate.epoch + preferred.offset * 60_000).toISOString().slice(0, 10) !== preferred.day;
  })) throw dateError("新闻原文存在冲突的发布日期；该条新闻暂不写入。");
  return preferred;
}

function unchangedSourceDate(input, existing, parsed) {
  if (!existing) return false;
  const previous = parseNewsDate(existing.publishedAt ?? existing.published_at);
  return previous.epoch === parsed.epoch && String(existing.url || "").trim() === String(input.url || "").trim();
}

async function verifyNewsSourceDate(input, existing, options = {}) {
  const parsed = parseNewsDate(input.publishedAt);
  if (unchangedSourceDate(input, existing, parsed)) return null;
  const url = normalizedUrl(input.url);
  const { html, finalUrl } = await fetchPublicHtml(url.href, options);
  const source = extractPublishedDate(html, [url.href, finalUrl]);
  const requestedDay = parsed.dateOnly ? parsed.day : new Date(parsed.epoch + source.offset * 60_000).toISOString().slice(0, 10);
  if (requestedDay !== source.day) throw dateError(`新闻日期与原文不一致：原文 ${source.day}，请求 ${requestedDay}；该条新闻未写入。`, "DOMI_NEWS_DATE_MISMATCH");
  const receipt = Object.freeze({});
  receipts.set(receipt, Object.freeze({
    url: url.href, finalUrl, publishedAt: parsed.epoch, publishedDay: source.day,
    sourcePublishedAt: source.epoch, rawPublishedDate: source.raw, method: source.method,
    verifiedAt: Date.now(), contentHash: crypto.createHash("sha256").update(html).digest("hex")
  }));
  return receipt;
}

function assertNewsSourceDate(input, existing, receipt) {
  const parsed = parseNewsDate(input.publishedAt);
  if (unchangedSourceDate(input, existing, parsed)) return { publishedAt: parsed.epoch, evidence: null };
  const evidence = receipt && receipts.get(receipt);
  if (!evidence || evidence.url !== normalizedUrl(input.url).href || evidence.publishedAt !== parsed.epoch) {
    throw dateError("新闻新增或修改发布日期、原文链接前，必须通过原文发布时间核验。");
  }
  return { publishedAt: parsed.epoch, evidence };
}

module.exports = { parseNewsDate, publicIp, fetchPublicHtml, extractPublishedDate, verifyNewsSourceDate, assertNewsSourceDate };

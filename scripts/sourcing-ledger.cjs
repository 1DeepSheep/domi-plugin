#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { acquireProcessLock } = require("./process-lock.cjs");

const DEFAULT_SETTINGS = Object.freeze({ enabled: false, localHour: 9, timeZone: "Asia/Shanghai", autoIntake: true });
const LEASE_MS = 2 * 60 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;
const MAX_DAILY_ATTEMPTS = 3;
const fail = (message, code = "sourcing_invalid") => Object.assign(new Error(message), { code });
const text = (value) => String(value ?? "").trim();
const unique = (values) => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
const normalized = (value) => text(value).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const stableId = (prefix, value) => `${prefix}_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 24)}`;

function httpUrl(value) {
  let url;
  try { url = new URL(text(value)); } catch { throw fail("信源必须包含有效的公开 http(s) 链接。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw fail("信源必须包含有效的公开 http(s) 链接。");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  return url.toString().replace(/\/$/, "");
}
function dayKey(now) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
function nextDailyAt(now, hour) {
  const shifted = new Date(now + 8 * 3600000);
  let next = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), hour - 8);
  if (next <= now) next += 86400000;
  return next;
}
function emptyLedger() { return { version: 1, settings: { ...DEFAULT_SETTINGS }, candidates: [], sources: [], focuses: [], focusConfigured: false, run: { status: "idle" }, history: [], removedSourceUrls: [] }; }
function unavailable(error) {
  return { ok: false, configured: false, error: error.message || String(error), candidates: [], sources: [], focuses: [], focusConfigured: false, excludedSourceUrls: [], settings: { ...DEFAULT_SETTINGS }, run: { status: "idle" } };
}
function resolvedConfig() {
  const config = require("./domi-repo.cjs").readConfig();
  if (config.backend !== "local" || config.legacyFeishuPrimary) throw fail("当前资料库仍以飞书为主。水下项目暂不支持此后端，不会另建本地资料库。", "sourcing_backend_unsupported");
  if (!config.repositoryDir || !config.databasePath) throw fail("请先配置 domi 本地资料库。", "sourcing_not_configured");
  if (!fs.existsSync(config.repositoryDir) || !fs.statSync(config.repositoryDir).isDirectory()) throw fail("已配置的本地资料库目录不可用。", "sourcing_not_configured");
  if (!fs.existsSync(config.databasePath)) throw fail("已配置的本地资料库数据库不可用，无法查重。", "sourcing_not_configured");
  return { libraryDir: path.resolve(config.repositoryDir), databasePath: path.resolve(config.databasePath) };
}
function normalizeSettings(current, patch = {}) {
  const settings = { ...current };
  for (const key of ["enabled", "autoIntake"]) {
    if (Object.hasOwn(patch, key)) {
      if (typeof patch[key] !== "boolean") throw fail(`${key} 必须是布尔值。`);
      settings[key] = patch[key];
    }
  }
  if (Object.hasOwn(patch, "localHour")) {
    if (!Number.isInteger(patch.localHour) || patch.localHour < 0 || patch.localHour > 23) throw fail("每日更新时间必须是 0–23 点。");
    settings.localHour = patch.localHour;
  }
  if (Object.hasOwn(patch, "timeZone") && patch.timeZone !== "Asia/Shanghai") throw fail("当前每日更新使用 Asia/Shanghai 时区。");
  return settings;
}
function normalizeSource(raw, now, existing, isRun = false) {
  const url = httpUrl(raw.url || existing?.url);
  const type = raw.type || existing?.type || "other";
  if (!["lab", "person", "project", "event", "open_source", "other"].includes(type)) throw fail("未知的搜索来源类型。");
  const status = raw.status || existing?.status || "pending";
  if (!["pending", "checked", "failed"].includes(status)) throw fail("未知的搜索来源状态。");
  if (raw.focusIds !== undefined && (!Array.isArray(raw.focusIds) || raw.focusIds.some(id => typeof id !== "string" || !id.trim()))) throw fail("来源 focusIds 必须是非空 ID 的数组。", "sourcing_invalid_source_scope");
  const focusIds = unique(raw.focusIds === undefined ? existing?.focusIds : raw.focusIds);
  return {
    id: existing?.id || stableId("src", url), name: text(raw.name || existing?.name) || new URL(url).hostname,
    type, url, enabled: raw.enabled === undefined ? existing?.enabled !== false : Boolean(raw.enabled), status,
    ...(focusIds.length ? { focusIds } : {}),
    ...(existing?.lastCheckedAt ? { lastCheckedAt: existing.lastCheckedAt } : {}),
    ...(isRun && ["checked", "failed"].includes(status) ? { lastCheckedAt: now } : {}),
    ...(raw.detail !== undefined || existing?.detail ? { detail: text(raw.detail ?? existing.detail) } : {})
  };
}
function configureSources(current, incoming, now) {
  const seenIds = new Set(), seenUrls = new Set();
  return incoming.map(raw => {
    const url = httpUrl(raw.url);
    const previous = current.find(item => raw.id && item.id === raw.id) || current.find(item => item.url === url);
    const changed = previous && previous.url !== url;
    const source = normalizeSource({ ...raw, status: changed ? "pending" : previous?.status || "pending", detail: changed ? "" : previous?.detail }, now, previous);
    if (changed) { delete source.lastCheckedAt; delete source.detail; }
    if (seenIds.has(source.id) || seenUrls.has(source.url)) throw fail("来源 ID 或链接重复，请保留一条。");
    seenIds.add(source.id); seenUrls.add(source.url);
    return source;
  });
}
function excludedSourceUrls(value) { return unique([...(value.removedSourceUrls || []), ...value.sources.filter(source => !source.enabled).map(source => source.url)]); }
function focusConfigured(value) { return value.focusConfigured === true || Boolean(value.focuses?.length); }
function sourceInScope(source, value) {
  const focuses = (value.focuses || []).filter(focus => focus.enabled);
  if (focusConfigured(value) && !focuses.length) return false;
  if (!source.focusIds?.length) return true;
  return focuses.some(focus => source.focusIds.includes(focus.id) || focus.urls.includes(source.url));
}
function mergeSources(current, incoming, now, removedSourceUrls = [], run = {}) {
  const next = [...current];
  const plan = run.focusPlan || [], activeIds = new Set(plan.map(focus => focus.id));
  for (const raw of incoming || []) {
    const url = httpUrl(raw.url);
    const index = next.findIndex(item => item.url === url);
    const previous = next[index];
    if (removedSourceUrls.includes(url) || next.some(item => raw.id && item.id === raw.id && item.url !== url)) throw fail("来源已被删除或改址，本轮不能恢复或提交其检查成果。", "sourcing_source_out_of_scope");
    if (previous && !previous.enabled) throw fail("来源已暂停，本轮不能提交其检查成果。", "sourcing_source_out_of_scope");
    if (raw.focusIds !== undefined && (!Array.isArray(raw.focusIds) || raw.focusIds.some(id => typeof id !== "string" || !activeIds.has(id)))) throw fail("来源归属必须使用本轮启用的关注对象 ID。", "sourcing_invalid_source_scope");
    const configuredIds = plan.filter(focus => focus.urls.includes(url)).map(focus => focus.id);
    if (configuredIds.length && (raw.focusIds || []).some(id => !configuredIds.includes(id))) throw fail("指定来源网址与申报的关注对象不匹配。", "sourcing_invalid_source_scope");
    const manual = previous && !previous.focusIds?.length;
    let focusIds = previous?.focusIds || [];
    if (run.focusConfigured) {
      if (previous?.focusIds?.length && !previous.focusIds.some(id => activeIds.has(id)) && !configuredIds.length) throw fail("来源所属关注对象已暂停或删除，本轮不能提交其检查成果。", "sourcing_source_out_of_scope");
      if (!manual) {
        if (configuredIds.length) focusIds = unique([...focusIds, ...configuredIds]);
        else if (previous) {
          if ((raw.focusIds || []).some(id => !previous.focusIds.includes(id))) throw fail("不能通过运行回执把历史来源改派给其他关注对象。", "sourcing_invalid_source_scope");
        } else {
          focusIds = unique(raw.focusIds);
          if (!focusIds.length) throw fail("新发现来源需要本轮有效的 focusIds 归属。", "sourcing_invalid_source_scope");
        }
      }
    } else if ((raw.focusIds || []).length) throw fail("当前没有已启用关注对象，不能提交关注归属来源。", "sourcing_invalid_source_scope");
    // Agent writes checkpoints and explicit lineage; user source settings remain authoritative.
    const source = previous
      ? normalizeSource({ ...previous, status: raw.status, detail: raw.detail, focusIds }, now, previous, true)
      : normalizeSource({ ...raw, enabled: true, focusIds }, now, undefined, true);
    if (index < 0) next.push(source); else next[index] = source;
  }
  return next;
}
const FOCUS_TYPES = new Set(["direction", "lab", "company", "person", "freeform"]);
const FOCUS_RELATIONS = new Set(["members", "alumni", "founders", "employees", "former_employees", "students", "coauthors", "collaborators"]);
const focusNameKey = value => text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
const focusKey = focus => JSON.stringify({ type: focus.type, name: focusNameKey(focus.name),
  keywords: focus.keywords.map(focusNameKey).sort(), excludedKeywords: focus.excludedKeywords.map(focusNameKey).sort(),
  relations: [...focus.relations].sort(), urls: [...focus.urls].sort() });
function focusStrings(value, previous, label) {
  if (value === undefined) return [...(previous || [])];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw fail(`${label} 必须是字符串数组。`, "sourcing_invalid_focus");
  return [...new Map(value.map(item => item.trim().normalize("NFKC")).filter(Boolean).map(item => [focusNameKey(item), item])).values()];
}
function normalizeFocus(raw, previous) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw fail("关注对象必须是对象。", "sourcing_invalid_focus");
  const type = raw.type === undefined ? previous?.type : raw.type;
  const suppliedName = raw.name === undefined ? previous?.name : raw.name;
  // Natural-language scope is user-authored data; retain its punctuation and line breaks.
  const name = typeof suppliedName === "string" ? type === "freeform" ? suppliedName.trim() : suppliedName.trim().normalize("NFKC") : "";
  const maximumLength = type === "freeform" ? 4000 : 300;
  if (!name || name.length > maximumLength || !FOCUS_TYPES.has(type)) throw fail(`关注对象需要有效名称和 direction/lab/company/person/freeform 类型；当前类型最多 ${maximumLength} 字符。`, "sourcing_invalid_focus");
  const enabled = raw.enabled === undefined ? previous?.enabled ?? true : raw.enabled;
  if (typeof enabled !== "boolean") throw fail("关注对象 enabled 必须是布尔值。", "sourcing_invalid_focus");
  const relations = focusStrings(raw.relations, previous?.relations, "关注关系");
  if (relations.some(relation => !FOCUS_RELATIONS.has(relation))) throw fail("关注关系类型无效。", "sourcing_invalid_focus");
  if (raw.urls !== undefined && (!Array.isArray(raw.urls) || raw.urls.some(url => typeof url !== "string"))) throw fail("关注对象网址必须是字符串数组。", "sourcing_invalid_focus");
  const focus = {
    name, type, enabled,
    keywords: focusStrings(raw.keywords, previous?.keywords, "关键词"),
    excludedKeywords: focusStrings(raw.excludedKeywords, previous?.excludedKeywords, "排除关键词"),
    relations, urls: unique((raw.urls ?? previous?.urls ?? []).map(httpUrl))
  };
  return { id: previous?.id || stableId("focus", focusKey(focus)), ...focus };
}
function configureFocuses(current, incoming) {
  const seenKeys = new Set(), seenIds = new Set();
  return incoming.map(raw => {
    // Same names are not sufficient identity: only an explicit existing ID edits a focus.
    const previous = current.find(item => raw?.id && item.id === raw.id);
    const focus = normalizeFocus(raw, previous), key = focusKey(focus);
    if (seenKeys.has(key) || seenIds.has(focus.id)) throw fail("关注对象定义或 ID 重复，请保留一条。", "sourcing_duplicate_focus");
    seenKeys.add(key); seenIds.add(focus.id);
    return focus;
  });
}
function focusCoverage(outcomes = {}) {
  const values = Object.values(outcomes).map(result => result.status);
  return { checked: values.filter(status => status === "checked").length, failed: values.filter(status => status === "failed").length, pending: values.filter(status => status === "pending").length };
}
function identityUrl(value, sources) {
  if (!text(value)) return undefined;
  const url = httpUrl(value);
  if (!sources.some(source => source.url === url)) throw fail("专属身份链接必须列入候选来源。", "sourcing_identity_required");
  if (/(?:^|\/)(?:team|people|alumni|members|events|program|participants|speakers|list)(?:\.(?:html?|php))?(?:\/index\.(?:html?|php))?\/?$/i.test(new URL(url).pathname)) throw fail("名单页不能作为个人或公司的专属身份链接。", "sourcing_identity_required");
  return url;
}
const RESEARCH_RELATIONS = new Set(["similar_product", "same_direction", "competitor", "upstream", "downstream", "complementary", "team_connection"]);
const pendingAnalysis = () => ({ status: "pending", note: "", items: [] });
function analysisText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw fail(`${label}需要非空文字。`, "sourcing_invalid_analysis");
  return value.trim();
}
function analysisAnchor(raw) {
  if (!raw || !["project", "person"].includes(raw.type) || typeof raw.id !== "string" || !raw.id.trim()) throw fail("联系或研究关联需要真实项目/人脉类型和 ID。", "sourcing_invalid_analysis");
  return { type: raw.type, id: raw.id.trim(), name: text(raw.name) };
}
function normalizeEvidence(raw) {
  if (!raw || !["library", "web"].includes(raw.kind)) throw fail("关联依据需要 library 或 web 类型。", "sourcing_invalid_analysis");
  const quote = analysisText(raw.quote, "关联依据引用");
  if (raw.kind === "web") return { kind: "web", url: httpUrl(raw.url), quote };
  return { kind: "library", entity: analysisAnchor(raw.entity), quote,
    ...(raw.documentPath !== undefined ? { documentPath: analysisText(raw.documentPath, "库内依据文档路径") } : {}) };
}
function normalizeAnalysis(raw, previous, kind, now) {
  if (raw === undefined) return previous ? structuredClone(previous) : pendingAnalysis();
  if (!raw || typeof raw !== "object" || !["pending", "found", "not_found"].includes(raw.status)
    || (raw.note !== undefined && typeof raw.note !== "string") || !Array.isArray(raw.items)) throw fail("联系路径和研究关联需要有效状态、说明及 items 数组。", "sourcing_invalid_analysis");
  const note = text(raw.note);
  if ((raw.status === "found" && !raw.items.length) || (raw.status === "not_found" && (raw.items.length || !note))) throw fail("found 需要实际结果；not_found 需要空结果及具体检索说明。", "sourcing_invalid_analysis");
  const items = raw.items.map(item => {
    if (!item || !Array.isArray(item.evidence) || !item.evidence.length) throw fail("联系或研究关联需要至少一条依据。", "sourcing_invalid_analysis");
    const evidence = item.evidence.map(normalizeEvidence), reason = analysisText(item.reason, "关联理由");
    if (kind === "contactPaths") {
      if (!["library_record", "public_overlap"].includes(item.basis) || !Array.isArray(item.chain) || !item.chain.length
        || item.chain.some(hop => typeof hop !== "string" || !hop.trim())) throw fail("联系路径需要有效依据类型及非空关系链。", "sourcing_invalid_analysis");
      return { via: analysisAnchor(item.via), chain: item.chain.map(hop => hop.trim()), basis: item.basis, reason,
        nextStep: analysisText(item.nextStep, "联系下一步"), evidence };
    }
    if (!RESEARCH_RELATIONS.has(item.relation)) throw fail("研究关联类型无效。", "sourcing_invalid_analysis");
    return { target: analysisAnchor(item.target), relation: item.relation, reason, difference: analysisText(item.difference, "关联差异或待核验项"), evidence };
  });
  // Only an explicit, revalidated block receives this run's server timestamp.
  return { status: raw.status, note, items, ...(raw.status !== "pending" ? { checkedAt: now } : {}) };
}
function normalizeCandidate(raw, now, existing) {
  const name = text(raw.name);
  if (!name || name.length > 300) throw fail("候选名称不能为空或过长。");
  const kind = raw.kind || existing?.kind;
  if (!["company", "team", "person", "product"].includes(kind)) throw fail("未知的候选类型。");
  const sources = (Array.isArray(raw.sources) ? raw.sources : []).map(source => ({ url: httpUrl(source.url), title: text(source.title), type: text(source.type) || "other" }));
  if (!sources.length) throw fail("候选必须保留至少一个公开来源。");
  const stage = raw.stage || existing?.stage || "new";
  const confidence = raw.confidence || existing?.confidence || "low";
  if (!["new", "watching", "archived", "excluded"].includes(stage) || !["high", "medium", "low"].includes(confidence)) throw fail("候选状态或证据可信度不合法。");
  const intake = { status: "pending", ...(existing?.intake || {}), ...(raw.intake || {}) };
  if (!["pending", "matched", "created", "needs_review"].includes(intake.status)) throw fail("未知的查重入库状态。");
  intake.projectId = text(intake.projectId) || undefined;
  intake.personIds = unique(intake.personIds);
  const relatedEntities = (raw.relatedEntities || existing?.relatedEntities || []).map(entity => {
    if (!["project", "person"].includes(entity.type) || !text(entity.id)) throw fail("关联档案必须包含类型和 ID。");
    return { type: entity.type, id: text(entity.id), name: text(entity.name), relation: text(entity.relation) };
  });
  const mergedSources = [...new Map([...(existing?.sources || []), ...sources].map(source => [source.url, source])).values()];
  const identity = identityUrl(raw.identityUrl ?? existing?.identityUrl, mergedSources);
  if (existing?.identityUrl && identity !== existing.identityUrl) throw fail("专属身份链接改变，不能覆盖既有候选。", "sourcing_identity_conflict");
  return {
    id: existing?.id || (identity ? stableId("cand", `${kind}:${normalized(name)}:${identity}`) : `cand_${crypto.randomUUID()}`),
    ...(identity ? { identityUrl: identity } : {}),
    name, kind, founders: unique(raw.founders ?? existing?.founders), summary: text(raw.summary ?? existing?.summary),
    domain: text(raw.domain ?? existing?.domain), tags: unique(raw.tags ?? existing?.tags), signal: text(raw.signal ?? existing?.signal),
    discoveredAt: existing?.discoveredAt || now, lastSeenAt: now,
    ...(text(raw.signalDate ?? existing?.signalDate) ? { signalDate: text(raw.signalDate ?? existing?.signalDate) } : {}),
    stage, confidence, sources: mergedSources,
    discoveryPath: unique([...(existing?.discoveryPath || []), ...(raw.discoveryPath || [])]), relatedEntities,
    intake, nextAction: text(raw.nextAction ?? existing?.nextAction),
    contactPaths: normalizeAnalysis(raw.contactPaths, existing?.contactPaths, "contactPaths", now),
    researchLinks: normalizeAnalysis(raw.researchLinks, existing?.researchLinks, "researchLinks", now)
  };
}
function parseList(value) { try { const list = JSON.parse(value || "[]"); return Array.isArray(list) ? list : []; } catch { return []; } }
function entityVersion(database, type, row) {
  const hasDocuments = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'").get();
  const documents = hasDocuments
    ? database.prepare("SELECT id,path,updated_at FROM documents WHERE owner_type=? AND owner_id=? ORDER BY id").all(type, row.id) : [];
  return JSON.stringify({ updatedAt: Number(row.updated_at ?? row.created_at), documents });
}
function entityVersions(databasePath) {
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("BEGIN");
    return Object.fromEntries(["projects", "people"].flatMap(table => database.prepare(`SELECT * FROM ${table}`).all()
      .map(row => [`${table === "projects" ? "project" : "person"}/${row.id}`, entityVersion(database, table === "projects" ? "project" : "person", row)])));
  } finally { database.close(); }
}
function insideLibrary(file, libraryDir) {
  if (!path.isAbsolute(text(file))) return false;
  try { const root = fs.realpathSync(libraryDir), real = fs.realpathSync(file); return real.startsWith(`${root}${path.sep}`); } catch { return false; }
}
function validateAnalysis(candidate, run, databasePath, libraryDir) {
  const analyses = [candidate.contactPaths, candidate.researchLinks];
  if (!analyses.some(analysis => analysis?.items?.length)) return;
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const hasDocuments = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'").get());
  const normalizeQuote = value => text(value).replace(/\s+/g, " ");
  const rows = new Map();
  function readAnchor(anchor) {
    const key = `${anchor.type}/${anchor.id}`;
    if (!rows.has(key)) rows.set(key, database.prepare(`SELECT * FROM ${anchor.type === "project" ? "projects" : "people"} WHERE id=?`).get(anchor.id));
    const row = rows.get(key);
    if (!row) throw fail(`联系或研究关联档案不存在：${key}`, "sourcing_invalid_analysis_link");
    anchor.name = row.name;
    return row;
  }
  function validateEvidence(evidence) {
    if (evidence.kind === "web") {
      if (!candidate.sources.some(source => source.url === evidence.url)) throw fail("网页关联依据必须列入候选 sources；这里只验证引用，不代替联网核查。", "sourcing_invalid_analysis_evidence");
      return;
    }
    const row = readAnchor(evidence.entity), quote = normalizeQuote(evidence.quote);
    const fields = ["name", "legal_name", "aliases_json", "domain", "subdomains_json", "notes", "organization", "financing_history", "investors_json", "cities_json", "types_json", "status", "rating"];
    const files = unique([row.document_path, ...(hasDocuments ? database.prepare("SELECT path FROM documents WHERE owner_type=? AND owner_id=?").all(evidence.entity.type, evidence.entity.id).map(doc => doc.path) : [])]);
    const isOwned = file => {
      if (!files.some(owned => path.resolve(owned) === path.resolve(file))) return false;
      let real;
      try { real = fs.realpathSync(file); } catch { return false; }
      return !hasDocuments || !database.prepare("SELECT 1 FROM documents WHERE (path=? OR path=?) AND (owner_type<>? OR owner_id<>?)")
        .get(path.resolve(file), real, evidence.entity.type, evidence.entity.id);
    };
    if (evidence.documentPath && (!path.isAbsolute(evidence.documentPath) || !isOwned(evidence.documentPath))) throw fail("库内依据文档必须已登记在所引用的档案名下。", "sourcing_invalid_analysis_evidence");
    if (!evidence.documentPath && fields.some(field => typeof row[field] === "string" && normalizeQuote(row[field]).includes(quote))) return;
    let remaining = 5 * 1024 * 1024;
    for (const file of evidence.documentPath ? [evidence.documentPath] : files) {
      if (!isOwned(file) || !insideLibrary(file, libraryDir) || !/\.(?:md|markdown|txt)$/i.test(file)) continue;
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > remaining) continue;
      const content = fs.readFileSync(file, "utf8"); remaining -= stat.size;
      if (normalizeQuote(content).includes(quote)) return;
    }
    throw fail(`库内依据引用无法在该档案的文字字段或库内已登记文档中找到：${evidence.entity.type}/${evidence.entity.id}`, "sourcing_invalid_analysis_evidence");
  }
  try {
    database.exec("BEGIN");
    for (const analysis of analyses) for (const item of analysis?.items || []) {
      const anchor = item.via || item.target;
      readAnchor(anchor);
      if (!Object.hasOwn(run.entityVersions || {}, `${anchor.type}/${anchor.id}`)) throw fail("联系入口和研究对照必须是本轮开始前已有的库内档案，不能把新入库候选当作已有关系。", "sourcing_invalid_analysis_link");
      if (item.target && (anchor.type === "project" ? candidate.intake.projectId === anchor.id : candidate.intake.personIds?.includes(anchor.id))) throw fail("候选自身的匹配档案属于入库查重，不能作为研究对照。", "sourcing_invalid_analysis_link");
      for (const evidence of item.evidence) validateEvidence(evidence);
      if (!item.evidence.some(evidence => evidence.kind === "library" && evidence.entity.type === anchor.type && evidence.entity.id === anchor.id)) {
        throw fail("联系或研究关联必须包含所经由/比较的档案自身的库内依据。", "sourcing_invalid_analysis_evidence");
      }
      if (item.basis === "public_overlap" && !item.evidence.some(evidence => evidence.kind === "web")) throw fail("公开交集还需要候选来源中的网页依据。", "sourcing_invalid_analysis_evidence");
    }
  } finally { database.close(); }
}
function entityCorroborates(candidate, reference, row, database, libraryDir) {
  const expectedNames = reference.type === "project" ? [candidate.name] : candidate.kind === "person" ? [candidate.name] : candidate.founders;
  const recordNames = [row.name, ...(reference.type === "project" ? [row.legal_name, ...parseList(row.aliases_json)] : [])].map(normalized).filter(Boolean);
  if (!expectedNames.some(name => recordNames.includes(normalized(name)))) throw fail(`候选身份与关联档案名称/别名不一致：${reference.type}/${row.id}`, "sourcing_identity_conflict");
  if (!candidate.identityUrl) throw fail("自动关联需要候选专属官网或个人主页；证据不足请保留 needs_review 并移除未核实的关联 ID。", "sourcing_identity_required");
  const files = [row.document_path];
  const hasDocuments = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'").get();
  if (hasDocuments) files.push(...database.prepare("SELECT path FROM documents WHERE owner_type=? AND owner_id=? ORDER BY updated_at DESC LIMIT 100").all(reference.type, row.id).map(file => file.path));
  const fragments = [text(row.notes), text(row.organization)];
  let remaining = 5 * 1024 * 1024;
  for (const file of unique(files)) {
    if (!insideLibrary(file, libraryDir) || !/\.(?:md|markdown|txt)$/i.test(file)) continue;
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > remaining) continue;
    fragments.push(fs.readFileSync(file, "utf8")); remaining -= stat.size;
  }
  const links = fragments.join("\n").match(/https?:\/\/[^\s<>"'\])]+/g) || [];
  const corroborated = links.some(url => { try { return httpUrl(url.replace(/[.,，。；;]+$/, "")) === candidate.identityUrl; } catch { return false; } });
  if (!corroborated) throw fail(`关联档案没有候选专属身份链接佐证：${reference.type}/${row.id}；请保留 needs_review。`, "sourcing_identity_conflict");
}
function validateStorageReceipt(candidate, reference, row, run, libraryDir) {
  const binding = (candidate.intake.receipts || []).find(receipt => receipt.entityType === reference.type && receipt.entityId === reference.id);
  if (!binding || !path.isAbsolute(text(binding.receiptPath)) || !path.isAbsolute(text(binding.manifestPath))) throw fail(`本轮新建/更新档案缺少独立归档回执：${reference.type}/${reference.id}`, "sourcing_receipt_missing");
  try {
    const { inspectManifest, verifyArtifact } = require("./domi-workflow.cjs");
    const receipt = JSON.parse(fs.readFileSync(binding.receiptPath, "utf8"));
    const inspected = inspectManifest(binding.manifestPath, { requireCoverage: true });
    const manifest = inspected.manifest;
    const idField = reference.type === "project" ? "projectId" : "personId";
    if (!inspected.ok || manifest.storagePhase !== "managed" || manifest.executionRunId !== run.runId
      || manifest.repository?.backend !== "local" || manifest.authorization?.internalWrite !== true
      || manifest.entity?.type !== reference.type || manifest.entity[idField] !== reference.id
      || manifest.completedStages?.length !== manifest.stagePlan?.length
      || receipt.schema !== "domi.storage-receipt.v1" || receipt.status !== "managed" || receipt.backend !== "local"
      || receipt.executionRunId !== run.runId || receipt.workflowRunId !== manifest.workflowRunId
      || receipt.entityType !== reference.type || receipt[idField] !== reference.id
      || !receipt.recordVerified || !receipt.documentVerified || !receipt.filesVerified
      || Date.parse(receipt.verifiedAt) < run.startedAt || !Number.isFinite(Date.parse(receipt.verifiedAt))
      || JSON.stringify(receipt) !== JSON.stringify(manifest.receipts?.storage)) throw new Error("归档回执与当前批次/实体/manifest 不一致");
    if (!row.document_path || !insideLibrary(row.document_path, libraryDir)
      || path.resolve(receipt.primaryEntityDocumentPath || receipt.documentPath) !== path.resolve(row.document_path)
      || !insideLibrary(receipt.documentPath, libraryDir)) throw new Error("规范文档与当前资料库记录不一致");
    if (reference.type === "project" && (Number(receipt.recordRevision) !== Number(row.revision)
      || receipt.recordHash !== manifest.entity.recordHash)) throw new Error("项目版本已改变，需重新归档核验");
    if (!Array.isArray(receipt.artifacts) || !receipt.artifacts.length
      || !receipt.artifacts.some(file => path.resolve(file.path) === path.resolve(row.document_path))) throw new Error("缺少规范主页文件回执");
    for (const file of receipt.artifacts) {
      if (!insideLibrary(file.path, libraryDir)) throw new Error("回执文件不在当前资料库");
      verifyArtifact(file);
    }
  } catch (error) { throw fail(`归档回执校验失败：${error.message}`, "sourcing_invalid_receipt"); }
}
function validateLinks(candidate, run, databasePath, libraryDir, autoIntake) {
  const references = [
    ...(candidate.intake.projectId ? [{ type: "project", id: candidate.intake.projectId }] : []),
    ...(candidate.intake.personIds || []).map(id => ({ type: "person", id })), ...candidate.relatedEntities
  ];
  const intakeKeys = new Set([
    ...(candidate.intake.projectId ? [`project/${candidate.intake.projectId}`] : []),
    ...(candidate.intake.personIds || []).map(id => `person/${id}`)
  ]);
  if (["created", "matched"].includes(candidate.intake.status) && !intakeKeys.size) throw fail("已入库或已匹配候选必须引用真实项目/人脉 ID。", "sourcing_invalid_link");
  if (!references.length) return;
  if (!fs.existsSync(databasePath)) throw fail("当前本地资料库不可读，无法验证关联档案。", "sourcing_invalid_link");
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let newlyCreated = false;
  try {
    for (const reference of references) {
      const table = reference.type === "project" ? "projects" : "people";
      const row = database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(reference.id);
      if (!row) throw fail(`关联档案不存在：${reference.type}/${reference.id}`, "sourcing_invalid_link");
      const key = `${reference.type}/${row.id}`;
      if (intakeKeys.has(key)) {
        entityCorroborates(candidate, reference, row, database, libraryDir);
        const isNew = !Object.hasOwn(run.entityVersions || {}, key) && Number(row.created_at) >= run.startedAt;
        const changed = !Object.hasOwn(run.entityVersions || {}, key) || entityVersion(database, reference.type, row) !== run.entityVersions[key];
        if (isNew) newlyCreated = true;
        if (changed && !autoIntake) throw fail("自动入库已关闭，本轮新增或变更的档案不能标记为入库成功。", "sourcing_intake_disabled");
        if (changed) validateStorageReceipt(candidate, reference, row, run, libraryDir);
      }
      const related = candidate.relatedEntities.find(item => item.type === reference.type && item.id === reference.id);
      if (related) related.name = row.name;
    }
  } finally { database.close(); }
  if (candidate.intake.status === "created" && !newlyCreated) throw fail("标记为新入库的档案并非本轮创建；请使用已匹配。", "sourcing_invalid_link");
  if (candidate.intake.status === "matched" && newlyCreated) throw fail("本轮新建档案不能借用 matched 状态跳过入库核验。", "sourcing_invalid_link");
}
function coverageValue(raw) {
  if (!raw || !["checked", "failed", "pending"].every(key => Number.isSafeInteger(raw[key]) && raw[key] >= 0)) throw fail("必须提供非负整数的 checked/failed/pending 覆盖回执。");
  return { checked: raw.checked, failed: raw.failed, pending: raw.pending };
}

class SourcingLedger {
  constructor({ libraryDir, databasePath, now = Date.now } = {}) {
    if (!libraryDir || !databasePath) throw fail("未指定当前本地资料库。");
    this.directory = path.join(path.resolve(libraryDir), ".domi");
    this.ledgerPath = path.join(this.directory, "sourcing-ledger.json");
    this.databasePath = path.resolve(databasePath);
    this.now = now;
  }
  read() {
    if (!fs.existsSync(this.ledgerPath)) return emptyLedger();
    const value = JSON.parse(fs.readFileSync(this.ledgerPath, "utf8"));
    if (value.version !== 1 || !Array.isArray(value.candidates) || !Array.isArray(value.sources) || (value.focuses !== undefined && !Array.isArray(value.focuses)) || (value.focusConfigured !== undefined && typeof value.focusConfigured !== "boolean") || !value.run || !value.settings) throw fail("水下项目台账格式异常，已停止写入。", "sourcing_corrupt");
    return value;
  }
  write(value) {
    const temporary = `${this.ledgerPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, this.ledgerPath);
    } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  snapshot(value = this.read()) {
    const run = { ...value.run };
    for (const privateKey of ["leaseToken", "receipt", "dayKey", "startedAt", "leaseUntil", "successfulDayKey", "attempts", "attemptDay", "candidateIds", "sourceOutcomes", "entityVersions", "focusOutcomes", "focusPlan", "focusConfigured"]) delete run[privateKey];
    const now = this.now(), day = dayKey(now);
    const expired = value.run.status === "running" && value.run.leaseUntil <= now;
    if (expired) { run.status = "failed"; run.error = "上轮更新已中断，等待续扫。"; }
    if (value.settings.enabled) {
      if (value.run.status === "running" && !expired) run.nextRunAt = value.run.leaseUntil;
      else if (value.run.successfulDayKey === day || (value.run.attemptDay === day && value.run.attempts >= MAX_DAILY_ATTEMPTS)) run.nextRunAt = nextDailyAt(now, value.settings.localHour);
      else if (value.run.retryAt) run.nextRunAt = value.run.retryAt;
      else run.nextRunAt = Date.parse(`${day}T${String(value.settings.localHour).padStart(2, "0")}:00:00+08:00`);
    }
    delete run.retryAt;
    if (value.run.focusOutcomes) {
      run.focusCoverage = focusCoverage(value.run.focusOutcomes);
      run.focusResults = Object.entries(value.run.focusOutcomes).map(([focusId, result]) => ({ focusId, ...result }));
    }
    return { ok: true, configured: true, settings: { ...value.settings }, candidates: value.candidates.map(candidate => ({ ...candidate, contactPaths: candidate.contactPaths || pendingAnalysis(), researchLinks: candidate.researchLinks || pendingAnalysis() })), sources: value.sources.map(source => ({ ...source, inScope: sourceInScope(source, value) })), focuses: value.focuses || [], focusConfigured: focusConfigured(value), excludedSourceUrls: excludedSourceUrls(value), run };
  }
  transaction(operation) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const release = acquireProcessLock(`${this.ledgerPath}.lock`);
    try {
      const value = this.read();
      const extra = operation(value, this.now()) || {};
      this.write(value);
      return { ok: true, snapshot: this.snapshot(value), ...extra };
    } finally { release(); }
  }
  configure(input = {}) {
    return this.transaction((value, now) => {
      if (value.run.status === "running" && value.run.leaseUntil > now
        && input.settings?.autoIntake !== undefined && input.settings.autoIntake !== value.settings.autoIntake) {
        throw fail("当前搜索仍在运行，请等待完成或停止后再修改自动入库设置。", "sourcing_settings_busy");
      }
      if (input.focuses !== undefined) {
        if (!Array.isArray(input.focuses)) throw fail("focuses 必须是数组。", "sourcing_invalid_focus");
        if (value.run.status === "running" && value.run.leaseUntil > now) throw fail("当前搜索仍在运行，请等待完成或停止后再修改关注对象。", "sourcing_settings_busy");
        value.focuses = configureFocuses(value.focuses || [], input.focuses);
        value.focusConfigured = true;
      }
      value.settings = normalizeSettings(value.settings, input.settings);
      if (input.sources !== undefined) {
        if (!Array.isArray(input.sources)) throw fail("sources 必须是数组。");
        const previous = value.sources;
        value.sources = configureSources(previous, input.sources, this.now());
        value.removedSourceUrls = unique([...(value.removedSourceUrls || []), ...previous.filter(source => !value.sources.some(item => item.url === source.url)).map(source => source.url)])
          .filter(url => !value.sources.some(source => source.url === url));
      }
    });
  }
  begin(input = {}) {
    return this.transaction((value, now) => {
      const day = dayKey(now), previous = value.run;
      if (previous.status === "running" && previous.leaseUntil > now) return { started: false, reason: "busy" };
      if (!input.force && !value.settings.enabled) return { started: false, reason: "disabled" };
      if (focusConfigured(value) && !(value.focuses || []).some(focus => focus.enabled)) return { started: false, reason: value.focuses?.length ? "focuses_paused" : "focuses_empty", error: "当前没有启用的关注对象，请先添加或启用至少一个关注对象。" };
      if (!input.force && previous.successfulDayKey === day) return { started: false, reason: "already_updated" };
      if (!input.force && previous.retryAt > now) return { started: false, reason: "backoff" };
      const dueAt = Date.parse(`${day}T${String(value.settings.localHour).padStart(2, "0")}:00:00+08:00`);
      if (!input.force && !previous.retryAt && now < dueAt) return { started: false, reason: "not_due" };
      if (!input.force && previous.attemptDay === day && previous.attempts >= MAX_DAILY_ATTEMPTS) return { started: false, reason: "daily_retry_limit" };
      if (previous.runId) value.history = [...(value.history || []), { runId: previous.runId, status: previous.status === "running" ? "failed" : previous.status, lastAttemptAt: previous.lastAttemptAt, error: previous.status === "running" ? "上轮更新租约已过期" : previous.error }].slice(-30);
      const runId = `sourcing_${crypto.randomUUID()}`, leaseToken = crypto.randomUUID();
      const excluded = new Set(excludedSourceUrls(value));
      const focusPlan = structuredClone((value.focuses || []).filter(focus => focus.enabled))
        .map(focus => ({ ...focus, urls: focus.urls.filter(url => !excluded.has(url)) }));
      value.run = {
        status: "running", runId, leaseToken, dayKey: day, startedAt: now, lastAttemptAt: now, leaseUntil: now + LEASE_MS,
        ...(previous.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt, successfulDayKey: previous.successfulDayKey } : {}),
        attemptDay: day, attempts: previous.attemptDay === day ? (previous.attempts || 0) + 1 : 1,
        sourceOutcomes: Object.fromEntries(unique([
          ...value.sources.filter(source => source.enabled && sourceInScope(source, value)).map(source => source.url),
          ...focusPlan.flatMap(focus => focus.urls)
        ]).filter(url => !excluded.has(url)).map(url => [url, "pending"])),
        focusConfigured: focusConfigured(value),
        focusPlan,
        focusOutcomes: Object.fromEntries((value.focuses || []).filter(focus => focus.enabled).map(focus => [focus.id, { status: "pending" }])),
        entityVersions: entityVersions(this.databasePath)
      };
      return { started: true, runId, leaseToken, ledgerPath: this.ledgerPath };
    });
  }
  active(value, input, now) {
    if (value.run.status !== "running" || input.runId !== value.run.runId || !input.leaseToken || input.leaseToken !== value.run.leaseToken) throw fail("更新批次或租约不匹配，已拒绝过期任务写入。", "sourcing_run_mismatch");
    if (value.run.leaseUntil <= now) throw fail("本轮更新租约已过期，请开始新一轮。", "sourcing_lease_expired");
    return value.run;
  }
  merge(input = {}) {
    return this.transaction((value, now) => {
      const run = this.active(value, input, now);
      if (!Array.isArray(input.candidates) || !Array.isArray(input.sources)) throw fail("merge 需要 candidates 和 sources 数组，允许明确的空数组。");
      const candidates = [...value.candidates], ids = [];
      for (const raw of input.candidates) {
        let index = candidates.findIndex(item => raw.id && item.id === raw.id);
        if (index < 0 && raw.identityUrl) {
          const identity = identityUrl(raw.identityUrl, (raw.sources || []).map(source => ({ url: httpUrl(source.url) })));
          index = candidates.findIndex(item => item.kind === raw.kind && normalized(item.name) === normalized(raw.name) && item.identityUrl === identity);
        }
        const previous = candidates[index];
        const candidate = normalizeCandidate(raw, now, previous);
        if (previous?.lastSeenAt < run.startedAt && !raw.intake?.receipts) candidate.intake.receipts = [];
        if (!raw.intake && previous?.intake.status === "created" && previous.lastSeenAt < run.startedAt) candidate.intake.status = "matched";
        validateLinks(candidate, run, this.databasePath, path.dirname(this.directory), value.settings.autoIntake);
        validateAnalysis(candidate, run, this.databasePath, path.dirname(this.directory));
        if (!value.settings.autoIntake && candidate.intake.status === "created") throw fail("自动入库未启用，不能将本轮候选标记为自动新建。", "sourcing_intake_disabled");
        if (index < 0) candidates.push(candidate); else candidates[index] = candidate;
        ids.push(candidate.id);
      }
      value.candidates = candidates;
      run.candidateIds = unique([...(run.candidateIds || []), ...ids]);
      value.sources = mergeSources(value.sources, input.sources, now, value.removedSourceUrls, run);
      run.sourceOutcomes = { ...(run.sourceOutcomes || {}) };
      for (const source of input.sources) {
        if (!["checked", "failed", "pending"].includes(source.status)) throw fail("本轮来源必须明确标记 checked、failed 或 pending。");
        run.sourceOutcomes[httpUrl(source.url)] = source.status;
      }
      if (input.focusResults !== undefined) {
        if (!Array.isArray(input.focusResults)) throw fail("focusResults 必须是数组。", "sourcing_invalid_focus_result");
        const seenFocusIds = new Set();
        for (const result of input.focusResults) {
          const id = text(result?.focusId);
          if (!id || !Object.hasOwn(run.focusOutcomes || {}, id) || seenFocusIds.has(id)
            || !["checked", "failed", "pending"].includes(result.status)
            || (result.detail !== undefined && typeof result.detail !== "string")
            || (["checked", "failed"].includes(result.status) && !text(result.detail))) throw fail("关注对象回执必须对应本轮启用 ID、唯一且具有有效状态；checked/failed 需填写非空检查依据。", "sourcing_invalid_focus_result");
          seenFocusIds.add(id);
          run.focusOutcomes[id] = { status: result.status, ...(result.detail !== undefined ? { detail: result.detail.trim() } : {}) };
        }
      }
      if (input.coverage) run.coverage = coverageValue(input.coverage);
      if (input.completed === true) {
        run.coverage = coverageValue(input.coverage);
        if (run.coverage.checked === 0 && run.coverage.failed === 0 && run.coverage.pending === 0) throw fail("搜索回执必须记录至少一个已检查、失败或待续扫来源。");
        const outcomes = Object.values(run.sourceOutcomes);
        if (run.coverage.checked !== outcomes.filter(status => status === "checked").length
          || run.coverage.failed !== outcomes.filter(status => status === "failed").length
          || run.coverage.pending < outcomes.filter(status => status === "pending").length) throw fail("覆盖回执与本轮已持久化的来源检查状态不一致。", "sourcing_invalid_coverage");
        run.receipt = { mergedAt: now, candidateIds: [...run.candidateIds], coverage: run.coverage, focusCoverage: focusCoverage(run.focusOutcomes) };
      } else if (run.receipt) delete run.receipt;
      run.leaseUntil = now + LEASE_MS;
      return { merged: ids.length };
    });
  }
  complete(input = {}) {
    return this.transaction((value, now) => {
      const run = this.active(value, input, now);
      if (!run.receipt || !run.receipt.mergedAt || !run.receipt.coverage) throw fail("未找到本轮已持久化的搜索回执；不能把任务结束视为更新成功。", "sourcing_receipt_missing");
      let analysisPending = false;
      for (const id of run.receipt.candidateIds) {
        const candidate = value.candidates.find(item => item.id === id);
        if (!candidate) throw fail("本轮候选回执缺失，无法完成更新。", "sourcing_receipt_missing");
        validateLinks(candidate, run, this.databasePath, path.dirname(this.directory), value.settings.autoIntake);
        validateAnalysis(candidate, run, this.databasePath, path.dirname(this.directory));
        if ([candidate.contactPaths, candidate.researchLinks].some(analysis => !["found", "not_found"].includes(analysis?.status)
          || !Number.isFinite(analysis.checkedAt) || analysis.checkedAt < run.startedAt)) analysisPending = true;
      }
      const focused = focusCoverage(run.focusOutcomes);
      const partial = run.coverage.failed > 0 || run.coverage.pending > 0 || focused.failed > 0 || focused.pending > 0 || analysisPending;
      run.status = partial ? "partial" : "idle";
      if (partial) { run.retryAt = now + RETRY_MS; run.error = "部分来源、关注内容或候选关联分析未完成，保留已发现候选并稍后续扫。"; }
      else { run.lastSuccessAt = now; run.successfulDayKey = run.dayKey; delete run.retryAt; delete run.error; }
      delete run.leaseToken; delete run.receipt; delete run.leaseUntil;
    });
  }
  fail(input = {}) {
    return this.transaction((value, now) => {
      const run = this.active(value, input, now);
      run.status = "failed"; run.error = text(input.error).slice(0, 2000) || "本轮搜索未完成，请稍后重试。";
      run.retryAt = now + RETRY_MS;
      delete run.leaseToken; delete run.receipt; delete run.leaseUntil;
    });
  }
}

function main(argv = process.argv.slice(2)) {
  let ledger;
  try {
    ledger = new SourcingLedger(resolvedConfig());
    const [command, ...args] = argv;
    const index = args.indexOf("--json-file");
    const input = index >= 0 ? JSON.parse(fs.readFileSync(args[index + 1], "utf8")) : {};
    let result;
    if (command === "snapshot") result = { ok: true, snapshot: ledger.snapshot() };
    else if (["configure", "begin", "merge", "complete", "fail"].includes(command)) result = ledger[command](input);
    else throw fail("用法：sourcing-ledger.cjs snapshot|configure|begin|merge|complete|fail [--json-file FILE]");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    let snapshot;
    try { snapshot = ledger ? ledger.snapshot() : unavailable(error); } catch { snapshot = unavailable(error); }
    process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || "sourcing_error", error: error.message, snapshot })}\n`);
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { SourcingLedger, DEFAULT_SETTINGS, LEASE_MS, RETRY_MS, MAX_DAILY_ATTEMPTS, dayKey, nextDailyAt, unavailable, resolvedConfig, main };

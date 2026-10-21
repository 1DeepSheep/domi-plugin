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
function emptyLedger() { return { version: 1, settings: { ...DEFAULT_SETTINGS }, candidates: [], sources: [], run: { status: "idle" }, history: [], removedSourceUrls: [] }; }
function unavailable(error) {
  return { ok: false, configured: false, error: error.message || String(error), candidates: [], sources: [], settings: { ...DEFAULT_SETTINGS }, run: { status: "idle" } };
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
  return {
    id: existing?.id || stableId("src", url), name: text(raw.name || existing?.name) || new URL(url).hostname,
    type, url, enabled: raw.enabled === undefined ? existing?.enabled !== false : Boolean(raw.enabled), status,
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
function mergeSources(current, incoming, now, removedSourceUrls = []) {
  const next = [...current];
  for (const raw of incoming || []) {
    const url = httpUrl(raw.url);
    const index = next.findIndex(item => item.url === url);
    const previous = next[index];
    if (!previous && (removedSourceUrls.includes(url) || next.some(item => raw.id && item.id === raw.id))) continue;
    // An agent owns scan checkpoints; only configure owns user source settings.
    const source = previous
      ? normalizeSource({ ...previous, status: raw.status, detail: raw.detail }, now, previous, true)
      : normalizeSource({ ...raw, enabled: true }, now, undefined, true);
    if (index < 0) next.push(source); else next[index] = source;
  }
  return next;
}
function identityUrl(value, sources) {
  if (!text(value)) return undefined;
  const url = httpUrl(value);
  if (!sources.some(source => source.url === url)) throw fail("专属身份链接必须列入候选来源。", "sourcing_identity_required");
  if (/(?:^|\/)(?:team|people|alumni|members|events|program|participants|speakers|list)(?:\.(?:html?|php))?(?:\/index\.(?:html?|php))?\/?$/i.test(new URL(url).pathname)) throw fail("名单页不能作为个人或公司的专属身份链接。", "sourcing_identity_required");
  return url;
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
    intake, nextAction: text(raw.nextAction ?? existing?.nextAction)
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
    if (value.version !== 1 || !Array.isArray(value.candidates) || !Array.isArray(value.sources) || !value.run || !value.settings) throw fail("水下项目台账格式异常，已停止写入。", "sourcing_corrupt");
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
    for (const privateKey of ["leaseToken", "receipt", "dayKey", "startedAt", "leaseUntil", "successfulDayKey", "attempts", "attemptDay", "candidateIds", "sourceOutcomes", "entityVersions"]) delete run[privateKey];
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
    return { ok: true, configured: true, settings: { ...value.settings }, candidates: value.candidates, sources: value.sources, run };
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
      if (!input.force && previous.successfulDayKey === day) return { started: false, reason: "already_updated" };
      if (!input.force && previous.retryAt > now) return { started: false, reason: "backoff" };
      const dueAt = Date.parse(`${day}T${String(value.settings.localHour).padStart(2, "0")}:00:00+08:00`);
      if (!input.force && !previous.retryAt && now < dueAt) return { started: false, reason: "not_due" };
      if (!input.force && previous.attemptDay === day && previous.attempts >= MAX_DAILY_ATTEMPTS) return { started: false, reason: "daily_retry_limit" };
      if (previous.runId) value.history = [...(value.history || []), { runId: previous.runId, status: previous.status === "running" ? "failed" : previous.status, lastAttemptAt: previous.lastAttemptAt, error: previous.status === "running" ? "上轮更新租约已过期" : previous.error }].slice(-30);
      const runId = `sourcing_${crypto.randomUUID()}`, leaseToken = crypto.randomUUID();
      value.run = {
        status: "running", runId, leaseToken, dayKey: day, startedAt: now, lastAttemptAt: now, leaseUntil: now + LEASE_MS,
        ...(previous.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt, successfulDayKey: previous.successfulDayKey } : {}),
        attemptDay: day, attempts: previous.attemptDay === day ? (previous.attempts || 0) + 1 : 1,
        sourceOutcomes: Object.fromEntries(value.sources.filter(source => source.enabled).map(source => [source.url, "pending"])),
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
        if (!value.settings.autoIntake && candidate.intake.status === "created") throw fail("自动入库未启用，不能将本轮候选标记为自动新建。", "sourcing_intake_disabled");
        if (index < 0) candidates.push(candidate); else candidates[index] = candidate;
        ids.push(candidate.id);
      }
      value.candidates = candidates;
      run.candidateIds = unique([...(run.candidateIds || []), ...ids]);
      value.sources = mergeSources(value.sources, input.sources, now, value.removedSourceUrls);
      run.sourceOutcomes = { ...(run.sourceOutcomes || {}) };
      for (const source of input.sources) {
        if (!["checked", "failed", "pending"].includes(source.status)) throw fail("本轮来源必须明确标记 checked、failed 或 pending。");
        run.sourceOutcomes[httpUrl(source.url)] = source.status;
      }
      if (input.coverage) run.coverage = coverageValue(input.coverage);
      if (input.completed === true) {
        run.coverage = coverageValue(input.coverage);
        if (run.coverage.checked === 0 && run.coverage.failed === 0 && run.coverage.pending === 0) throw fail("搜索回执必须记录至少一个已检查、失败或待续扫来源。");
        const outcomes = Object.values(run.sourceOutcomes);
        if (run.coverage.checked !== outcomes.filter(status => status === "checked").length
          || run.coverage.failed !== outcomes.filter(status => status === "failed").length
          || run.coverage.pending < outcomes.filter(status => status === "pending").length) throw fail("覆盖回执与本轮已持久化的来源检查状态不一致。", "sourcing_invalid_coverage");
        run.receipt = { mergedAt: now, candidateIds: [...run.candidateIds], coverage: run.coverage };
      } else if (run.receipt) delete run.receipt;
      run.leaseUntil = now + LEASE_MS;
      return { merged: ids.length };
    });
  }
  complete(input = {}) {
    return this.transaction((value, now) => {
      const run = this.active(value, input, now);
      if (!run.receipt || !run.receipt.mergedAt || !run.receipt.coverage) throw fail("未找到本轮已持久化的搜索回执；不能把任务结束视为更新成功。", "sourcing_receipt_missing");
      for (const id of run.receipt.candidateIds) {
        const candidate = value.candidates.find(item => item.id === id);
        if (!candidate) throw fail("本轮候选回执缺失，无法完成更新。", "sourcing_receipt_missing");
        validateLinks(candidate, run, this.databasePath, path.dirname(this.directory), value.settings.autoIntake);
      }
      const partial = run.coverage.failed > 0 || run.coverage.pending > 0;
      run.status = partial ? "partial" : "idle";
      if (partial) { run.retryAt = now + RETRY_MS; run.error = "部分来源未完成，保留已发现候选并稍后续扫。"; }
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

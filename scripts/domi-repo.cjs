#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA_VERSION = 1;
function defaultConfigPath(homeDir = os.homedir(), exists = fs.existsSync) {
  const applicationSupport = path.join(homeDir, "Library", "Application Support");
  const current = path.join(applicationSupport, "domi", "domi-plugin-config.json");
  const legacy = path.join(
    applicationSupport,
    String.fromCodePoint(0x8c46, 0x7c73),
    "domi-plugin-config.json"
  );
  return !exists(current) && exists(legacy) ? legacy : current;
}

function fail(message, code = "repository_error") {
  process.stdout.write(`${JSON.stringify({ ok: false, code, error: message })}\n`);
  process.exitCode = 1;
}

function resolveHomePath(value) {
  const raw = String(value || "").trim();
  return raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
}

function readConfig() {
  const configPath = resolveHomePath(process.env.DOMI_CONFIG_PATH || defaultConfigPath());
  if (!fs.existsSync(configPath)) {
    throw new Error("没有找到 domi 资料库配置。请先在 domi“设置 → 资料连接”中选择资料库模式。");
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const backend = config.storageBackend === "local" ? "local" : "feishu";
  const materialDir = resolveHomePath(config.localLibraryDir || config.oneDriveProjectDir);
  const repositoryDir = resolveHomePath(config.localRepositoryDir);
  const libraryDir = backend === "local" ? repositoryDir : materialDir;
  const databasePath = resolveHomePath(
    config.localDatabasePath || path.join(path.dirname(configPath), "domi-repository.sqlite3")
  );
  return { configPath, backend, libraryDir, materialDir, repositoryDir, databasePath };
}

function safeSegment(value, fallback = "_未分类") {
  const cleaned = String(value || "")
    .trim()
    .replace(/\//g, "／")
    .replace(/[<>:"\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .slice(0, 96);
  return cleaned || fallback;
}

function normalizedName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•._\-—–（）()【】[\]{}，,。.!！?？/&／]+/g, "");
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

function toEpochMs(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringList(value) {
  if (Array.isArray(value)) return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
  if (value === null || value === undefined || value === "") return [];
  return [...new Set(String(value).split(/[，,、]/).map((item) => item.trim()).filter(Boolean))];
}

function jsonList(value) {
  return JSON.stringify(stringList(value));
}

function parseJsonList(value) {
  try {
    return stringList(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

function yamlValue(value) {
  return JSON.stringify(value === undefined ? "" : value);
}

function replaceManagedBlock(existing, block) {
  const start = "<!-- domi:managed:start -->";
  const end = "<!-- domi:managed:end -->";
  const managed = `${start}\n${block.trim()}\n${end}`;
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  if (startIndex >= 0 && endIndex > startIndex) {
    return `${existing.slice(0, startIndex)}${managed}${existing.slice(endIndex + end.length)}`;
  }
  return existing.trim() ? `${managed}\n\n${existing.trim()}\n` : `${managed}\n`;
}

function writeManagedMarkdown(filePath, block) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const next = replaceManagedBlock(existing, block);
  const temporaryPath = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporaryPath, next, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function parseArguments(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

function readPayload(flags) {
  if (flags["json-file"]) return JSON.parse(fs.readFileSync(resolveHomePath(flags["json-file"]), "utf8"));
  if (flags.json) return JSON.parse(String(flags.json));
  if (!process.stdin.isTTY) {
    const input = fs.readFileSync(0, "utf8").trim();
    if (input) return JSON.parse(input);
  }
  return {};
}

class DomiRepository {
  constructor(config) {
    if (config.backend !== "local") {
      throw Object.assign(
        new Error("当前工作区使用飞书资料库；飞书模式继续按 investment-mgmt 的 lark-cli 契约执行。"),
        { code: "backend_not_local" }
      );
    }
    if (!config.libraryDir || !config.databasePath) {
      throw new Error("本地资料库缺少目录或数据库路径。请回到 domi 设置重新保存资料连接。");
    }
    this.config = config;
    this.libraryDir = path.resolve(config.libraryDir);
    this.databasePath = path.resolve(config.databasePath);
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    for (const directory of ["1.行业研究", "2.行业动态", "3.项目库", "4.人脉库"]) {
      fs.mkdirSync(path.join(this.libraryDir, directory), { recursive: true });
    }
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS repository_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        domain TEXT NOT NULL DEFAULT '',
        subdomains_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT '待交流',
        rating TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        cities_json TEXT NOT NULL DEFAULT '[]',
        investors_json TEXT NOT NULL DEFAULT '[]',
        last_updated_at INTEGER,
        document_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC, id);
      CREATE TABLE IF NOT EXISTS people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        types_json TEXT NOT NULL DEFAULT '[]',
        organization TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        rating TEXT NOT NULL DEFAULT '',
        last_contact_at INTEGER,
        cities_json TEXT NOT NULL DEFAULT '[]',
        document_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_people_updated ON people(updated_at DESC, id);
      CREATE TABLE IF NOT EXISTS news_events (
        event_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        domains_json TEXT NOT NULL DEFAULT '[]',
        subdomains_json TEXT NOT NULL DEFAULT '[]',
        types_json TEXT NOT NULL DEFAULT '[]',
        published_at INTEGER NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        investment_meaning TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        companies TEXT NOT NULL DEFAULT '',
        institutions TEXT NOT NULL DEFAULT '',
        importance REAL NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        evidence_status TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT '',
        worth_following INTEGER NOT NULL DEFAULT 1,
        document_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_news_events_published
        ON news_events(published_at DESC, event_id);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_owner
        ON documents(owner_type, owner_id, kind);
      INSERT INTO repository_meta (key, value, updated_at)
        VALUES ('schema_version', '${SCHEMA_VERSION}', unixepoch('now') * 1000)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
    `);
  }

  close() {
    this.database.close();
  }

  summary() {
    const count = (table) => Number(this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
    return {
      backend: "local",
      databasePath: this.databasePath,
      libraryDir: this.libraryDir,
      schemaVersion: SCHEMA_VERSION,
      counts: {
        projects: count("projects"),
        people: count("people"),
        news: count("news_events"),
        documents: count("documents")
      }
    };
  }

  projectDirectory(project) {
    const mainSubdomain = stringList(project.subdomains)[0] || "_未分类";
    return path.join(
      this.libraryDir,
      "3.项目库",
      safeSegment(project.domain),
      safeSegment(mainSubdomain),
      safeSegment(project.name, "未命名项目")
    );
  }

  projectPage(project, id) {
    const directory = this.projectDirectory(project);
    for (const child of ["纪要", "研究", "原始材料", "导出"]) {
      fs.mkdirSync(path.join(directory, child), { recursive: true });
    }
    const filePath = path.join(directory, "项目主页.md");
    const block = `---
domi_schema: ${SCHEMA_VERSION}
entity_type: "project"
project_id: ${yamlValue(id)}
company_name: ${yamlValue(project.name)}
domain: ${yamlValue(project.domain || "")}
subdomains: ${yamlValue(stringList(project.subdomains))}
status: ${yamlValue(project.status || "待交流")}
rating: ${yamlValue(project.rating || "")}
last_updated_at: ${yamlValue(new Date(project.lastUpdatedAt).toISOString())}
---

# ${project.name}

## 项目状态

- 领域：${project.domain || "未分类"}
- 子领域：${stringList(project.subdomains).join("、") || "未分类"}
- 进展：${project.status || "待交流"}
- 评级：${project.rating || "未评级"}

## 结构化摘要

${project.notes || "暂无摘要。"}
`;
    writeManagedMarkdown(filePath, block);
    return filePath;
  }

  upsertProject(input) {
    const name = String(input.name || input.companyName || "").trim();
    if (!name) throw new Error("项目写入缺少 name/companyName。");
    const normalized = normalizedName(name);
    const existing = this.database.prepare(
      "SELECT id, created_at FROM projects WHERE normalized_name = ?"
    ).get(normalized);
    const id = String(input.id || input.projectId || existing?.id || stableId("prj", normalized));
    const now = Date.now();
    const project = {
      name,
      domain: String(input.domain || "").trim(),
      subdomains: stringList(input.subdomains),
      status: String(input.status || "待交流").trim(),
      rating: String(input.rating || "").trim(),
      notes: String(input.notes || "").trim(),
      cities: stringList(input.cities),
      investors: stringList(input.investors),
      lastUpdatedAt: toEpochMs(input.lastUpdatedAt || input.lastFollowup, now)
    };
    const documentPath = this.projectPage(project, id);
    this.database.prepare(`
      INSERT INTO projects (
        id, name, normalized_name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, last_updated_at, document_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        normalized_name = excluded.normalized_name,
        domain = excluded.domain,
        subdomains_json = excluded.subdomains_json,
        status = excluded.status,
        rating = excluded.rating,
        notes = excluded.notes,
        cities_json = excluded.cities_json,
        investors_json = excluded.investors_json,
        last_updated_at = excluded.last_updated_at,
        document_path = excluded.document_path,
        updated_at = excluded.updated_at
    `).run(
      id, name, normalized, project.domain, jsonList(project.subdomains), project.status,
      project.rating, project.notes, jsonList(project.cities), jsonList(project.investors),
      project.lastUpdatedAt, documentPath, existing?.created_at || now, now
    );
    return {
      ok: true,
      action: existing ? "updated" : "created",
      storageReceipt: {
        backend: "local",
        projectId: id,
        projectUri: `domi://project/${id}`,
        documentUri: pathToFileURL(documentPath).href,
        libraryPath: path.dirname(documentPath),
        recordVerified: Boolean(this.getProject(id)),
        documentVerified: fs.existsSync(documentPath),
        filesVerified: fs.existsSync(path.dirname(documentPath)),
        status: "managed"
      },
      project: this.getProject(id)
    };
  }

  getProject(id) {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? this.mapProject(row) : null;
  }

  mapProject(row) {
    return {
      id: row.id,
      name: row.name,
      domain: row.domain,
      subdomains: parseJsonList(row.subdomains_json),
      status: row.status,
      rating: row.rating,
      notes: row.notes,
      cities: parseJsonList(row.cities_json),
      investors: parseJsonList(row.investors_json),
      lastUpdatedAt: row.last_updated_at,
      documentPath: row.document_path,
      documentUri: row.document_path ? pathToFileURL(row.document_path).href : ""
    };
  }

  listProjects(query = "") {
    const normalizedQuery = normalizedName(query);
    return this.database.prepare("SELECT * FROM projects ORDER BY updated_at DESC, name").all()
      .map((row) => this.mapProject(row))
      .filter((project) => !normalizedQuery || normalizedName(project.name).includes(normalizedQuery));
  }

  personPage(person, id) {
    const directory = path.join(this.libraryDir, "4.人脉库", safeSegment(person.name, "未命名人物"));
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, "人物主页.md");
    const block = `---
domi_schema: ${SCHEMA_VERSION}
entity_type: "person"
person_id: ${yamlValue(id)}
name: ${yamlValue(person.name)}
organization: ${yamlValue(person.organization || "")}
types: ${yamlValue(stringList(person.types))}
status: ${yamlValue(person.status || "")}
rating: ${yamlValue(person.rating || "")}
---

# ${person.name}

- 组织与身份：${person.organization || "待补充"}
- 类型：${stringList(person.types).join("、") || "待补充"}
- 进展：${person.status || "待补充"}
- 评级：${person.rating || "未评级"}
`;
    writeManagedMarkdown(filePath, block);
    return filePath;
  }

  upsertPerson(input) {
    const name = String(input.name || "").trim();
    if (!name) throw new Error("人物写入缺少 name。");
    const normalized = normalizedName(name);
    const existing = this.database.prepare(
      "SELECT id, created_at FROM people WHERE normalized_name = ?"
    ).get(normalized);
    const id = String(input.id || input.personId || existing?.id || stableId("per", normalized));
    const now = Date.now();
    const person = {
      name,
      types: stringList(input.types),
      organization: String(input.organization || "").trim(),
      status: String(input.status || "").trim(),
      rating: String(input.rating || "").trim(),
      lastContactAt: toEpochMs(input.lastContactAt || input.lastContact, null),
      cities: stringList(input.cities)
    };
    const documentPath = this.personPage(person, id);
    this.database.prepare(`
      INSERT INTO people (
        id, name, normalized_name, types_json, organization, status, rating,
        last_contact_at, cities_json, document_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        normalized_name = excluded.normalized_name,
        types_json = excluded.types_json,
        organization = excluded.organization,
        status = excluded.status,
        rating = excluded.rating,
        last_contact_at = excluded.last_contact_at,
        cities_json = excluded.cities_json,
        document_path = excluded.document_path,
        updated_at = excluded.updated_at
    `).run(
      id, name, normalized, jsonList(person.types), person.organization, person.status,
      person.rating, person.lastContactAt, jsonList(person.cities), documentPath,
      existing?.created_at || now, now
    );
    return {
      ok: true,
      action: existing ? "updated" : "created",
      person: this.listPeople(name).find((item) => item.id === id)
    };
  }

  listPeople(query = "") {
    const normalizedQuery = normalizedName(query);
    return this.database.prepare("SELECT * FROM people ORDER BY updated_at DESC, name").all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        types: parseJsonList(row.types_json),
        organization: row.organization,
        status: row.status,
        rating: row.rating,
        lastContactAt: row.last_contact_at,
        cities: parseJsonList(row.cities_json),
        documentPath: row.document_path,
        documentUri: row.document_path ? pathToFileURL(row.document_path).href : ""
      }))
      .filter((person) => !normalizedQuery
        || normalizedName(`${person.name}${person.organization}`).includes(normalizedQuery));
  }

  newsPage(event) {
    const published = new Date(event.publishedAt);
    const directory = path.join(
      this.libraryDir,
      "2.行业动态",
      String(published.getFullYear()),
      String(published.getMonth() + 1).padStart(2, "0")
    );
    const filePath = path.join(directory, `${safeSegment(event.eventId, "event")}.md`);
    const block = `---
domi_schema: ${SCHEMA_VERSION}
entity_type: "news_event"
event_id: ${yamlValue(event.eventId)}
title: ${yamlValue(event.title)}
domains: ${yamlValue(event.domains)}
subdomains: ${yamlValue(event.subdomains)}
published_at: ${yamlValue(published.toISOString())}
importance: ${Number(event.importance) || 0}
confidence: ${Number(event.confidence) || 0}
source_url: ${yamlValue(event.url || "")}
---

# ${event.title}

## 核心事实

${event.summary || "暂无摘要。"}

## 投资含义

${event.investmentMeaning || "待研判。"}

## 建议动作

${event.action || "继续关注。"}
`;
    writeManagedMarkdown(filePath, block);
    return filePath;
  }

  upsertNews(input) {
    const title = String(input.title || "").trim();
    if (!title) throw new Error("行业事件写入缺少 title。");
    const publishedAt = toEpochMs(input.publishedAt, Date.now());
    const eventId = String(
      input.eventId || input.id || stableId("evt", `${normalizedName(title)}:${publishedAt}`)
    );
    const existing = this.database.prepare(
      "SELECT event_id, created_at FROM news_events WHERE event_id = ?"
    ).get(eventId);
    const now = Date.now();
    const event = {
      eventId,
      title,
      domains: stringList(input.domains || input.domain),
      subdomains: stringList(input.subdomains),
      types: stringList(input.types || input.type),
      publishedAt,
      summary: String(input.summary || "").trim(),
      investmentMeaning: String(input.investmentMeaning || "").trim(),
      url: String(input.url || "").trim(),
      source: String(input.source || "").trim(),
      companies: String(input.companies || "").trim(),
      institutions: String(input.institutions || "").trim(),
      importance: Number(input.importance) || 0,
      confidence: Number(input.confidence) || 0,
      evidenceStatus: String(input.evidenceStatus || "").trim(),
      action: String(input.action || "").trim(),
      worthFollowing: input.worthFollowing === false ? 0 : 1
    };
    const documentPath = this.newsPage(event);
    this.database.prepare(`
      INSERT INTO news_events (
        event_id, title, domains_json, subdomains_json, types_json, published_at,
        summary, investment_meaning, url, source, companies, institutions,
        importance, confidence, evidence_status, action, worth_following,
        document_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        title = excluded.title,
        domains_json = excluded.domains_json,
        subdomains_json = excluded.subdomains_json,
        types_json = excluded.types_json,
        published_at = excluded.published_at,
        summary = excluded.summary,
        investment_meaning = excluded.investment_meaning,
        url = excluded.url,
        source = excluded.source,
        companies = excluded.companies,
        institutions = excluded.institutions,
        importance = excluded.importance,
        confidence = excluded.confidence,
        evidence_status = excluded.evidence_status,
        action = excluded.action,
        worth_following = excluded.worth_following,
        document_path = excluded.document_path,
        updated_at = excluded.updated_at
    `).run(
      eventId, title, jsonList(event.domains), jsonList(event.subdomains), jsonList(event.types),
      event.publishedAt, event.summary, event.investmentMeaning, event.url, event.source,
      event.companies, event.institutions, event.importance, event.confidence,
      event.evidenceStatus, event.action, event.worthFollowing, documentPath,
      existing?.created_at || now, now
    );
    return {
      ok: true,
      action: existing ? "updated" : "created",
      storageReceipt: {
        backend: "local",
        eventId,
        eventUri: `domi://news/${eventId}`,
        documentUri: pathToFileURL(documentPath).href,
        recordVerified: Boolean(this.getNews(eventId)),
        documentVerified: fs.existsSync(documentPath),
        status: "archived"
      },
      event: this.getNews(eventId)
    };
  }

  getNews(eventId) {
    const row = this.database.prepare("SELECT * FROM news_events WHERE event_id = ?").get(eventId);
    if (!row) return null;
    return {
      eventId: row.event_id,
      title: row.title,
      domains: parseJsonList(row.domains_json),
      subdomains: parseJsonList(row.subdomains_json),
      types: parseJsonList(row.types_json),
      publishedAt: row.published_at,
      summary: row.summary,
      investmentMeaning: row.investment_meaning,
      url: row.url,
      source: row.source,
      companies: row.companies,
      institutions: row.institutions,
      importance: Number(row.importance) || 0,
      confidence: Number(row.confidence) || 0,
      evidenceStatus: row.evidence_status,
      action: row.action,
      worthFollowing: Boolean(row.worth_following),
      documentPath: row.document_path,
      documentUri: row.document_path ? pathToFileURL(row.document_path).href : ""
    };
  }

  listNews({ from = 0, to = Date.now() + 1, limit = 500 } = {}) {
    return this.database.prepare(`
      SELECT event_id FROM news_events
      WHERE published_at >= ? AND published_at < ?
      ORDER BY published_at DESC, importance DESC, event_id
      LIMIT ?
    `).all(from, to, Math.min(Math.max(Number(limit) || 500, 1), 2000))
      .map((row) => this.getNews(row.event_id));
  }

  createDocument(input) {
    const ownerType = ["project", "person", "news"].includes(input.ownerType)
      ? input.ownerType
      : "project";
    const ownerId = String(input.ownerId || "").trim();
    const kind = safeSegment(input.kind || "文档", "文档");
    const title = String(input.title || kind).trim();
    if (!ownerId) throw new Error("文档写入缺少 ownerId。");
    let root;
    if (ownerType === "project") {
      const project = this.getProject(ownerId);
      if (!project) throw new Error(`没有找到项目 ${ownerId}。`);
      root = path.dirname(project.documentPath);
    } else if (ownerType === "person") {
      const person = this.listPeople().find((item) => item.id === ownerId);
      if (!person) throw new Error(`没有找到人物 ${ownerId}。`);
      root = path.dirname(person.documentPath);
    } else {
      const event = this.getNews(ownerId);
      if (!event) throw new Error(`没有找到行业事件 ${ownerId}。`);
      root = path.dirname(event.documentPath);
    }
    const targetDirectory = ownerType === "project" ? path.join(root, kind) : root;
    fs.mkdirSync(targetDirectory, { recursive: true });
    const filePath = path.join(targetDirectory, `${safeSegment(title, kind)}.md`);
    const content = input.contentFile
      ? fs.readFileSync(resolveHomePath(input.contentFile), "utf8")
      : String(input.content || `# ${title}\n`);
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== content) {
      fs.writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    }
    const now = Date.now();
    const id = stableId("doc", `${ownerType}:${ownerId}:${filePath}`);
    this.database.prepare(`
      INSERT INTO documents (id, owner_type, owner_id, kind, title, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        path = excluded.path,
        updated_at = excluded.updated_at
    `).run(id, ownerType, ownerId, kind, title, filePath, now, now);
    return {
      ok: true,
      document: { id, ownerType, ownerId, kind, title, path: filePath, uri: pathToFileURL(filePath).href },
      storageReceipt: {
        backend: "local",
        documentUri: pathToFileURL(filePath).href,
        documentVerified: fs.existsSync(filePath),
        status: "archived"
      }
    };
  }
}

function main() {
  const { positional, flags } = parseArguments(process.argv.slice(2));
  const [resource = "config", action = "get"] = positional;
  const config = readConfig();
  if (resource === "config" && action === "get") {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      backend: config.backend,
      configPath: config.configPath,
      localLibraryDir: config.materialDir,
      localRepositoryDir: config.repositoryDir,
      localDatabasePath: config.databasePath,
      configured: config.backend === "local"
        ? Boolean(config.libraryDir && config.databasePath)
        : true
    })}\n`);
    return;
  }

  let repository;
  try {
    repository = new DomiRepository(config);
    let result;
    if (resource === "init") {
      result = { ok: true, ...repository.summary() };
    } else if (resource === "status" || (resource === "workspace" && action === "verify")) {
      result = {
        ok: fs.existsSync(repository.databasePath) && fs.existsSync(repository.libraryDir),
        ...repository.summary()
      };
    } else if (resource === "project" && ["list", "search"].includes(action)) {
      const items = repository.listProjects(flags.query || "");
      result = { ok: true, total: items.length, items };
    } else if (resource === "project" && action === "get") {
      result = { ok: true, project: repository.getProject(flags.id || positional[2]) };
    } else if (resource === "project" && action === "upsert") {
      result = repository.upsertProject(readPayload(flags));
    } else if (resource === "person" && ["list", "search"].includes(action)) {
      const items = repository.listPeople(flags.query || "");
      result = { ok: true, total: items.length, items };
    } else if (resource === "person" && action === "upsert") {
      result = repository.upsertPerson(readPayload(flags));
    } else if (resource === "news" && action === "list") {
      const items = repository.listNews({
        from: toEpochMs(flags.from, 0),
        to: toEpochMs(flags.to, Date.now() + 1),
        limit: flags.limit
      });
      result = { ok: true, total: items.length, items };
    } else if (resource === "news" && action === "get") {
      result = { ok: true, event: repository.getNews(flags.id || positional[2]) };
    } else if (resource === "news" && action === "upsert") {
      result = repository.upsertNews(readPayload(flags));
    } else if (resource === "document" && action === "create") {
      result = repository.createDocument(readPayload(flags));
    } else {
      throw new Error(`未知命令：${resource} ${action}`);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    repository?.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), error?.code || "repository_error");
  }
}

module.exports = {
  defaultConfigPath,
  DomiRepository,
  SCHEMA_VERSION,
  normalizedName,
  readConfig,
  safeSegment
};

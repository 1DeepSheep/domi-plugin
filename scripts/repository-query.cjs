"use strict";

const crypto = require("node:crypto");

const COMMON = {
  id: ["id"], name: ["name"], status: ["status"], rating: ["rating"],
  createdAt: ["created_at"], updatedAt: ["updated_at"], cities: ["cities_json"],
  documentPath: ["document_path"], documentUri: ["document_path"]
};
const FIELDS = {
  project: { ...COMMON, domain: ["domain"], subdomains: ["subdomains_json"], notes: ["notes"],
    investors: ["investors_json"], financingHistory: ["financing_history"],
    latestValuationUsd100m: ["latest_valuation_usd_100m"], lastUpdatedAt: ["last_updated_at"],
    recordRevision: ["revision"], recordHash: ["*"] },
  person: { ...COMMON, types: ["types_json"], organization: ["organization"],
    lastContactAt: ["last_contact_at"], documents: ["document_path", "interaction_documents_json"],
    interactionDocuments: ["document_path", "interaction_documents_json"] }
};

function queryError(message, code = "invalid_query") {
  return Object.assign(new Error(message), { code });
}

function list(value) {
  if (value === undefined || value === null || value === "") return [];
  return [...new Set((Array.isArray(value) ? value : String(value).split(",")).map(String).map(x => x.trim()).filter(Boolean))];
}

function date(value, name) {
  if (value === undefined || value === null || value === "") return null;
  const result = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(result)) throw queryError(`${name} must be an epoch millisecond number or ISO date`);
  return result;
}

function optionsFor(kind, input = {}) {
  if (!FIELDS[kind]) throw queryError("Unknown repository entity kind");
  const fields = list(input.fields);
  if (fields.some(field => !Object.hasOwn(FIELDS[kind], field))) throw queryError("Unknown projection field");
  const limit = input.limit === undefined ? null : Number(input.limit);
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)) throw queryError("limit must be 1..500");
  const ids = list(input.ids);
  if (ids.length > 200) throw queryError("At most 200 ids per batch; split larger batches explicitly");
  const result = {
    kind, query: String(input.query || ""), fields: fields.length ? [...new Set(["id", ...fields])] : [],
    limit, ids, ratings: list(input.ratings ?? input.rating), statuses: list(input.statuses ?? input.status),
    createdFrom: date(input.createdFrom, "createdFrom"), createdTo: date(input.createdTo, "createdTo")
  };
  if (result.createdFrom !== null && result.createdTo !== null && result.createdFrom >= result.createdTo) {
    throw queryError("createdFrom must precede exclusive createdTo");
  }
  return result;
}

function installQueryVersion(database) {
  database.prepare("INSERT OR IGNORE INTO repository_meta(key,value,updated_at) VALUES ('query_identity',?,0)")
    .run(crypto.randomUUID());
  database.exec("INSERT OR IGNORE INTO repository_meta(key,value,updated_at) VALUES ('query_version','0',0)");
  for (const table of ["projects", "people", "documents"]) {
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      database.exec(`CREATE TRIGGER IF NOT EXISTS domi_query_${table}_${operation.toLowerCase()}
        AFTER ${operation} ON ${table} BEGIN
          UPDATE repository_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'query_version';
        END`);
    }
  }
}

function queryRecords(repository, kind, input = {}) {
  const options = optionsFor(kind, input);
  const table = kind === "project" ? "projects" : "people";
  const normalized = repository.normalizeQuery(options.query);
  const conditions = [], parameters = [];
  if (normalized) {
    conditions.push(kind === "project" ? "instr(normalized_name, ?) > 0" : "instr(domi_normalize(name || organization), ?) > 0");
    parameters.push(normalized);
  }
  for (const [column, values] of [["id", options.ids], ["rating", options.ratings], ["status", options.statuses]]) {
    if (values.length) { conditions.push(`${column} IN (${values.map(() => "?").join(",")})`); parameters.push(...values); }
  }
  if (options.createdFrom !== null) { conditions.push("created_at >= ?"); parameters.push(options.createdFrom); }
  if (options.createdTo !== null) { conditions.push("created_at < ?"); parameters.push(options.createdTo); }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(options)).digest("hex");
  const columns = options.fields.length ? [...new Set(["id", "updated_at", ...options.fields.flatMap(field => FIELDS[kind][field])])] : ["*"];
  const selection = columns.includes("*") ? "*" : columns.join(", ");
  const db = repository.database;
  db.exec("BEGIN");
  try {
    const identity = db.prepare("SELECT value FROM repository_meta WHERE key='query_identity'").get().value;
    const version = db.prepare("SELECT value FROM repository_meta WHERE key='query_version'").get().value;
    let cursor = null;
    if (input.cursor) {
      try {
        if (String(input.cursor).length > 2048) throw new Error("large cursor");
        cursor = JSON.parse(Buffer.from(String(input.cursor), "base64url").toString("utf8"));
      } catch { throw queryError("Malformed cursor"); }
      if (cursor.fingerprint !== fingerprint || cursor.identity !== identity) throw queryError("Cursor belongs to a different query or repository");
      if (cursor.version !== version) throw queryError("Repository changed; restart this query and deduplicate by id", "query_snapshot_changed");
      if (!Number.isFinite(cursor.updatedAt) || typeof cursor.id !== "string") throw queryError("Malformed cursor position");
    }
    const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}${where}`).get(...parameters).count);
    const after = cursor ? `${where ? " AND" : " WHERE"} (updated_at < ? OR (updated_at = ? AND id > ?))` : "";
    const pageParameters = [...parameters, ...(cursor ? [cursor.updatedAt, cursor.updatedAt, cursor.id] : [])];
    const rows = db.prepare(`SELECT ${selection} FROM ${table}${where}${after} ORDER BY updated_at DESC, id ASC${options.limit ? " LIMIT ?" : ""}`)
      .all(...pageParameters, ...(options.limit ? [options.limit + 1] : []));
    const hasMore = Boolean(options.limit && rows.length > options.limit);
    if (hasMore) rows.pop();
    const needDocuments = !options.fields.length || options.fields.some(field => ["documents", "interactionDocuments"].includes(field));
    const mapped = kind === "project" ? rows.map(row => repository.mapProject(row)) : repository.mapPeopleRows(rows, needDocuments);
    const items = mapped.map(item => options.fields.length ? Object.fromEntries(options.fields.map(field => [field, item[field]])) : item);
    const last = rows.at(-1);
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({ fingerprint, identity, version, updatedAt: last.updated_at, id: last.id })).toString("base64url") : null;
    db.exec("ROLLBACK"); // Read-only snapshot: no writes to commit.
    return { items, total, hasMore, nextCursor, complete: !hasMore, snapshotVersion: `${identity}:${version}`,
      scope: { ...options, createdToExclusive: true }, ...(options.ids.length ? { missingIds: options.ids.filter(id => !items.some(item => item.id === id)) } : {}) };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

module.exports = { installQueryVersion, queryRecords, optionsFor };

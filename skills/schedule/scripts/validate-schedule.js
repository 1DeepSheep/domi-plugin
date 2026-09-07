#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");

function validateSchedule(input = {}) {
  const missing = ["subject", "location", "timeZone", "startAt", "endAt"].filter(key => typeof input[key] !== "string" || !input[key].trim());
  const errors = missing.map(field => ({ field, code: "required" }));
  let formatter;
  try { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); }
  catch { errors.push({ field: "timeZone", code: "invalid_iana_time_zone" }); }
  const parseTime = field => {
    const match = String(input[field] || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
    const epoch = Date.parse(input[field]);
    if (!match || !Number.isFinite(epoch)) { errors.push({ field, code: "explicit_iso_offset_required" }); return NaN; }
    if (formatter && !missing.includes("timeZone")) {
      const parts = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]));
      const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
      if (local !== match.slice(1, 4).join("-") + "T" + match.slice(4, 7).join(":")) errors.push({ field, code: "date_or_offset_disagrees_with_time_zone" });
    }
    return epoch;
  };
  const start = parseTime("startAt"), end = parseTime("endAt");
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) errors.push({ field: "endAt", code: "must_follow_start" });
  const raw = Array.isArray(input.attendees) ? input.attendees : String(input.attendees || "")
    .replace(/[^<>;,\n]*<([^<>]+)>/g, "$1").split(/[;,\s]+/).filter(Boolean);
  const attendees = [], seen = new Set();
  raw.forEach((value, index) => {
    const text = typeof value === "string" ? value.trim() : "";
    const address = (text.match(/^[^<>]*<([^<>]+)>$/)?.[1] || text).trim();
    if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(address)
        || address.startsWith(".") || address.includes("..") || address.includes(".@")) {
      errors.push({ field: "attendees", index, code: "invalid_email" }); return;
    }
    const key = address.toLowerCase();
    if (!seen.has(key)) { attendees.push(address); seen.add(key); }
  });
  if (!raw.length) errors.push({ field: "attendees", code: "required" });
  return { ok: errors.length === 0, schema: "domi.schedule-validation.v1", errors,
    attendeeCount: attendees.length, duplicateCount: raw.length - attendees.length - errors.filter(error => error.field === "attendees" && error.code === "invalid_email").length,
    inputSha256: crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    semanticReviewRequired: true, invitationSent: false };
}

if (require.main === module) {
  const chunks = [];
  process.stdin.on("data", chunk => chunks.push(chunk));
  process.stdin.on("end", () => {
    try { const result = validateSchedule(JSON.parse(Buffer.concat(chunks).toString("utf8"))); process.stdout.write(`${JSON.stringify(result)}\n`); if (!result.ok) process.exitCode = 1; }
    catch { process.stdout.write(`${JSON.stringify({ ok: false, error: "Expected schedule JSON on stdin" })}\n`); process.exitCode = 1; }
  });
}
module.exports = { validateSchedule };

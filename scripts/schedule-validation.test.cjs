const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSchedule } = require("../skills/schedule/scripts/validate-schedule.js");
const valid = { subject: "合成会议", location: "线上", timeZone: "Asia/Shanghai", startAt: "2026-09-07T10:00:00+08:00", endAt: "2026-09-07T11:00:00+08:00", attendees: "甲 <a@example.com>; A@example.com, b@example.com" };
test("schedule validator deduplicates explicit attendees and returns no private addresses", () => {
  const result = validateSchedule(valid);
  assert.equal(result.ok, true); assert.equal(result.attendeeCount, 2); assert.equal(result.duplicateCount, 1);
  assert.equal(result.invitationSent, false); assert.doesNotMatch(JSON.stringify(result), /example\.com/);
});
test("schedule validator reports all missing/invalid fields without inventing defaults or sending a partial invite", () => {
  const result = validateSchedule({ ...valid, subject: "", attendees: "good@example.com invalid@", timeZone: "Mars/Unknown", endAt: "2026-09-07T09:00:00+08:00" });
  assert.equal(result.ok, false);
  for (const field of ["subject", "attendees", "timeZone", "endAt"]) assert.ok(result.errors.some(error => error.field === field));
  assert.equal(validateSchedule({ ...valid, endAt: undefined }).ok, false);
});
test("schedule validator rejects impossible dates, offset mismatch and ambiguous local-only timestamps", () => {
  for (const startAt of ["2026-02-30T10:00:00+08:00", "2026-09-07T10:00:00", "2026-09-07T10:00:00Z"]) {
    assert.equal(validateSchedule({ ...valid, startAt }).ok, false);
  }
  const dst = { ...valid, timeZone: "America/New_York", startAt: "2026-03-08T02:30:00-05:00", endAt: "2026-03-08T04:30:00-04:00" };
  assert.equal(validateSchedule(dst).ok, false);
});

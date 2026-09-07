const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const {
  normalizeLedger,
  parseLedgerDocument,
  readLocalLedger,
  renderLedger,
  writeLocalLedger
} = require("../skills/todo/scripts/todo-ledger.js");
const { mergeLedger, mergeLocalLedger, readRunReceipt } = require("../skills/todo/scripts/todo-ledger.js");

function proposal(id, overrides = {}, review = {}) {
  return { task: { id, title: `事项${id}`, reason: "已有来源证明现在需要跟进", signalKey: `signal-${id}`,
    priority: "P2", category: "project-follow-up", source: { kind: "project", recordId: `project-${id}` },
    suggestedAction: { kind: "research", prompt: "核验这个具体项目的最新变化" }, ...overrides },
    review: { status: "passed", sourceRefs: ["source-1:L1-L3"], ...review } };
}

test("merge protects in-progress, completed signals, cooldown and established due dates", () => {
  const now = "2026-09-07T00:00:00.000Z";
  const candidates = ["working", "done", "ignored", "dated"].map(id => proposal(id));
  const ledger = normalizeLedger({ tasks: candidates.map((candidate, index) => ({ ...candidate.task,
    status: ["in_progress", "done", "ignored", "open"][index], dueAt: index === 3 ? "2026-09-10T00:00:00.000Z" : null,
    ignoredAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-08-01T00:00:00.000Z" })) }, now);
  const merged = mergeLedger({ ledger, candidates, now });
  assert.deepEqual(merged.ledger.tasks.map(task => task.status), ["in_progress", "done", "ignored", "open"]);
  assert.equal(merged.ledger.tasks[3].dueAt, "2026-09-10T00:00:00.000Z");
  assert.equal(merged.ledger.tasks[3].createdAt, "2026-08-01T00:00:00.000Z");
  const cleared = mergeLedger({ ledger: merged.ledger, candidates: [proposal("dated", { dueAt: null }, { dateCancelled: true })], now });
  assert.equal(cleared.ledger.tasks[3].dueAt, null);
});

test("merge rejects unreviewed and fabricated dates, enforces new-entry creation dates and reserves category seats", () => {
  const now = "2026-09-07T00:00:00.000Z";
  const categories = ["key-milestone", "new-entry", "relationship-follow-up", "project-follow-up"];
  const candidates = categories.flatMap((category, categoryIndex) => Array.from({ length: 7 }, (_, i) =>
    proposal(`${categoryIndex}-${i}`, { category, priority: "P1", dueAt: "2026-09-10T00:00:00.000Z" },
      { dateVerified: true, sourceCreatedAt: "2026-09-01T00:00:00.000Z", valueVerified: true })));
  candidates.push(proposal("bad-date", { dueAt: "2026-09-09" }));
  candidates.push(proposal("old-created", { category: "new-entry" }, { sourceCreatedAt: "2025-01-01", valueVerified: true }));
  candidates.push({ task: proposal("unreviewed").task });
  const result = mergeLedger({ ledger: { tasks: [] }, candidates, now });
  assert.equal(result.ledger.tasks.length, 12);
  assert.equal(result.ledger.tasks.filter(task => task.priority === "P1").length, 4);
  for (const category of categories) assert.ok(result.ledger.tasks.filter(task => task.category === category).length >= 2);
  assert.ok(result.diagnostics.some(item => item.reason === "unverified_date"));
  assert.ok(result.diagnostics.some(item => item.reason === "new_entry_evidence_required"));
  assert.ok(result.diagnostics.some(item => item.reason === "semantic_review_required"));
});

test("merge combines same contact purpose, preserves distinct actions and never completes unsampled open tasks", () => {
  const now = "2026-09-07T00:00:00.000Z";
  const contact = { kind: "contact", prompt: "询问对方目前的融资进展" };
  const first = proposal("first", { source: { kind: "project", recordId: "same" }, suggestedAction: contact });
  const second = proposal("second", { source: { kind: "project", recordId: "same" }, suggestedAction: contact, category: "new-entry" },
    { sourceCreatedAt: "2026-09-01", valueVerified: true });
  const result = mergeLedger({ ledger: { tasks: [] }, candidates: [first, second], now });
  assert.equal(result.ledger.tasks.length, 1);
  assert.equal(result.ledger.tasks[0].category, "new-entry");
  const preserved = mergeLedger({ ledger: result.ledger, candidates: [], now });
  assert.equal(preserved.ledger.tasks[0].status, "open");
  const other = proposal("other", { source: { kind: "project", recordId: "same" }, suggestedAction: contact, purposeKey: "technical-reference" });
  assert.equal(mergeLedger({ ledger: result.ledger, candidates: [other], now }).ledger.tasks.length, 2);
});

test("local-merge binds persistent readback receipt to run and content, rejects stale input and duplicate markers", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-todo-receipt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const documentPath = path.join(root, "0.待办事项.md");
  fs.writeFileSync(documentPath, `# 用户原文\n${renderLedger({ tasks: [] })}\n保留这一行\n`);
  const before = readLocalLedger(documentPath);
  const input = { runId: "run-a", now: "2026-09-07T00:00:00.000Z", expectedLedgerHash: before.ledgerSha256, candidates: [proposal("one")] };
  const result = mergeLocalLedger(documentPath, input);
  assert.equal(result.receipt.verified, true);
  assert.deepEqual(readRunReceipt(documentPath, "run-a").receipt, result.receipt);
  assert.match(fs.readFileSync(documentPath, "utf8"), /保留这一行/);
  assert.throws(() => mergeLocalLedger(documentPath, input), /changed/);
  assert.throws(() => readRunReceipt(documentPath, "wrong-run"), /does not match/);
  fs.appendFileSync(documentPath, "用户补充\n");
  assert.throws(() => readRunReceipt(documentPath, "run-a"), /does not match/);
  fs.appendFileSync(documentPath, renderLedger({ tasks: [] }));
  assert.throws(() => readLocalLedger(documentPath), /多个/);
});

test("legacy missing task timestamps have a stable read hash and remain mergeable", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-todo-legacy-clock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const documentPath = path.join(root, "0.待办事项.md");
  const raw = { schemaVersion: 1, tasks: [{ ...proposal("legacy").task, status: "ignored" }] };
  fs.writeFileSync(documentPath, `<pre caption="domi-task-board-v1"><code>${JSON.stringify(raw)}</code></pre>`);
  fs.utimesSync(documentPath, new Date("2026-09-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z"));
  const first = readLocalLedger(documentPath), second = readLocalLedger(documentPath);
  assert.equal(first.ledgerSha256, second.ledgerSha256);
  assert.equal(first.ledger.tasks[0].ignoredAt, "2026-09-01T00:00:00.000Z");
  const result = mergeLocalLedger(documentPath, { runId: "legacy-run", now: "2026-09-07T00:00:00Z", expectedLedgerHash: first.ledgerSha256, candidates: [proposal("legacy")] });
  assert.equal(result.receipt.verified, true);
  assert.equal(result.ledger.tasks[0].status, "ignored");
});

test("todo ledger normalizes enums and preserves ignored state", () => {
  const ledger = normalizeLedger({
    schemaVersion: 9,
    updatedAt: "2026-07-28T00:00:00.000Z",
    tasks: [{
      id: "task-example",
      title: "跟进示例项目",
      priority: "P1",
      category: "project-update",
      status: "ignored",
      source: { kind: "project", recordId: "record-example", displayName: "示例项目" },
      suggestedAction: { kind: "research", label: "查看动态", prompt: "核验最新动态" },
      ignoredAt: "2026-07-28T01:00:00.000Z"
    }]
  });
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.tasks[0].status, "ignored");
  assert.equal(ledger.tasks[0].category, "project-follow-up");
  assert.equal(ledger.tasks[0].ignoredAt, "2026-07-28T01:00:00.000Z");
});

test("todo ledger XML escapes text and returns the precise block ID", () => {
  const xml = renderLedger({
    schemaVersion: 1,
    tasks: [{
      id: "task-example",
      title: "A & B",
      priority: "P2",
      status: "open",
      source: { kind: "manual" },
      suggestedAction: { kind: "custom", label: "执行", prompt: "比较 A < B" }
    }]
  }).replace("<pre ", '<pre id="block-example" ');
  assert.match(xml, /A &amp; B/);
  assert.match(xml, /A &lt; B/);
  const parsed = parseLedgerDocument({ content: xml });
  assert.equal(parsed.found, true);
  assert.equal(parsed.blockId, "block-example");
  assert.equal(parsed.ledger.tasks[0].title, "A & B");
  assert.equal(parsed.ledger.tasks[0].suggestedAction.prompt, "比较 A < B");
});

test("todo ledger parses Feishu-rendered captions and code-block line breaks", () => {
  const xml = renderLedger({
    schemaVersion: 1,
    tasks: [{
      id: "task-feishu-rendered",
      title: "跟进示例项目",
      category: "project-follow-up",
      priority: "P1",
      status: "open",
      source: { kind: "project", recordId: "project-example", displayName: "示例项目" },
      suggestedAction: { kind: "contact", label: "联系", prompt: "联系项目团队" }
    }]
  })
    .replace('caption="domi-task-board-v1"', 'caption="domi-task-board-v1&#xA;"')
    .replace(/\n/g, "<br />")
    .replace("<pre ", '<pre id="block-feishu" ');

  const parsed = parseLedgerDocument({ data: { document: { content: xml } } });
  assert.equal(parsed.found, true);
  assert.equal(parsed.blockId, "block-feishu");
  assert.equal(parsed.ledger.tasks[0].id, "task-feishu-rendered");
});

test("local todo ledger updates only the managed block and preserves user content", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-todo-ledger-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const documentPath = path.join(root, "0.待办事项.md");
  fs.writeFileSync(
    documentPath,
    `# 待办事项\n\n${renderLedger({ schemaVersion: 1, tasks: [] })}\n\n用户补充内容\n`
  );

  const result = writeLocalLedger(documentPath, {
    schemaVersion: 1,
    tasks: [{
      id: "task-local",
      title: "跟进本地项目",
      category: "project-follow-up",
      priority: "P1",
      status: "open",
      source: { kind: "project", recordId: "project-local", displayName: "本地项目" },
      suggestedAction: { kind: "contact", label: "联系", prompt: "联系项目团队" }
    }]
  });

  assert.equal(result.ledger.tasks[0].id, "task-local");
  assert.equal(readLocalLedger(documentPath).ledger.tasks[0].status, "open");
  assert.match(fs.readFileSync(documentPath, "utf8"), /用户补充内容/);
});

test("local-read exits even when the spawning parent keeps stdin open", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-todo-spawn-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const documentPath = path.join(root, "0.待办事项.md");
  fs.writeFileSync(documentPath, `# 待办事项\n\n${renderLedger({ schemaVersion: 1, tasks: [] })}\n`);

  const child = spawn(
    process.execPath,
    [path.join(__dirname, "..", "skills", "todo", "scripts", "todo-ledger.js"), "local-read", documentPath],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  let timeout;
  const result = await Promise.race([
    new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("local-read waited for stdin")), 1500);
    })
  ]).finally(() => clearTimeout(timeout));

  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(stderr, "");
  assert.equal(JSON.parse(stdout).found, true);
  assert.equal(child.stdin.destroyed, true);
});

test("an unknown command fails before reading an open stdin pipe", async (t) => {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, "..", "skills", "todo", "scripts", "todo-ledger.js"), "unknown-command"],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  let timeout;
  const result = await Promise.race([
    new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("unknown command waited for stdin")), 1500);
    })
  ]).finally(() => clearTimeout(timeout));

  assert.deepEqual(result, { code: 1, signal: null });
  assert.match(stderr, /^Usage: todo-ledger\.js/);
  assert.equal(child.stdin.destroyed, true);
});

test("todo skill keeps the new-entry window, action dedupe and category quotas explicit", () => {
  const skill = fs.readFileSync(
    path.join(__dirname, "..", "skills", "todo", "SKILL.md"),
    "utf8"
  );
  const rules = fs.readFileSync(
    path.join(__dirname, "..", "skills", "todo", "references", "suggestion-rules.md"),
    "utf8"
  );

  assert.match(skill, /近 28 天入库/);
  assert.match(skill, /最近 4 周新入库候选索引/);
  assert.match(skill, /不要为了发现同一批新入库对象再次全量读取项目表或人脉表/);
  assert.match(skill, /同一种联系动作/);
  assert.match(skill, /每个有合格候选的分类保留最多 2 个席位/);
  assert.match(rules, /### 近 28 天新入库/);
  assert.match(rules, /动作目的明显不同可以跨分类并存/);
  assert.match(rules, /单一分类不超过 5/);
  assert.match(skill, /无日期必须为 `null`/);
  assert.match(skill, /未来 7 天内且证据明确为 P1/);
  assert.match(skill, /8–14 天默认 P2/);
  assert.match(skill, /配额不足、未入选或本轮未扫描到，不得改成 `done\/ignored`/);
  assert.match(rules, /不得用扫描时间、当前时间、模型推算或建议跟进时间替代/);
  assert.match(rules, /新候选 `dueAt=null` 必须保留原事项已有的可核验日期/);
});

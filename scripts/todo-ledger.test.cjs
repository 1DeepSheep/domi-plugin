const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  normalizeLedger,
  parseLedgerDocument,
  readLocalLedger,
  renderLedger,
  writeLocalLedger
} = require("../skills/todo/scripts/todo-ledger.js");

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
});

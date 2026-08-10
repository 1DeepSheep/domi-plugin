"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const todo = read("skills", "todo", "SKILL.md");
const todoSchema = read("skills", "todo", "references", "todo-ledger-schema.md");
const radar = read("skills", "investment-radar", "SKILL.md");
const quickScan = read("skills", "investment-radar", "references", "quick-scan.md");
const PREVIOUS_TODO_CLIENT_BYTES = 14821;
const PREVIOUS_RADAR_QUICK_BYTES = 39747;

test("client todo contract is compact without weakening lifecycle or date guards", () => {
  const bytes = Buffer.byteLength(todo);
  assert.ok(1 - bytes / PREVIOUS_TODO_CLIENT_BYTES >= 0.59, `todo reduction fell below about 60% (${bytes} bytes)`);
  assert.match(todo, /DOMI_TODO_CLIENT_SNAPSHOT_V1/);
  assert.match(todo, /无需再读两个 reference/);
  assert.match(todo, /不再读取 `storage-backends\.md`/);
  assert.match(todo, /无日期必须为 `null`/);
  assert.match(todo, /禁止用当前／扫描时间、模型推算或建议时间填充、覆盖已有真实日期/);
  assert.match(todo, /未来 7 天内且证据明确为 P1/);
  assert.match(todo, /8–14 天默认 P2/);
  assert.match(todo, /配额不足、未入选或本轮未扫描到，不得改成 `done\/ignored`/);
  assert.match(todo, /不得切换、双写或新建第二账本/);
  assert.match(todo, /category \+ source\.kind \+ source\.recordId \+ signalKey/);
  assert.match(todo, /同一种联系动作/);
  assert.match(todo, /只写、回读各一次/);
  assert.match(todo, /local-write/);
  assert.match(todo, /fetch \+ `parse` 核对/);
  assert.match(todoSchema, /只有 `repositoryBackend=legacy_feishu_primary` 时.*唯一主账本读写/);
  assert.match(todoSchema, /已完成安全迁移后.*不得继续写入/);
});

test("quick radar prompt is about sixty percent smaller and keeps full scan quality", () => {
  const promptBytes = Buffer.byteLength(radar) + Buffer.byteLength(quickScan);
  assert.ok(1 - promptBytes / PREVIOUS_RADAR_QUICK_BYTES >= 0.59, `radar reduction fell below about 60% (${promptBytes} bytes)`);
  assert.match(radar, /每次调度都执行完整五领域轮次/);
  assert.match(radar, /不得因上一轮零新增而跳过到点轮次、降频或改变客户端周期/);
  assert.match(radar, /不再加载其他 Radar reference/);
  assert.match(radar, /存在该事实时直接锁定，不再读取 `storage-backends\.md`/);
  for (const domain of ["AI", "半导体", "智能出行", "前沿科技", "具身智能&机器人"]) {
    assert.match(quickScan, new RegExp(domain.replace("&", "&")));
  }
  assert.match(quickScan, /DeepTech 深科技/);
  assert.match(quickScan, /最多 12 个候选、8 个合格新增/);
  assert.match(quickScan, /必须打开.*原文/);
  assert.match(quickScan, /证据状态只能是/);
  assert.match(quickScan, /多篇转载同一通稿仍是一条来源链/);
  assert.match(quickScan, /可证伪/);
  assert.match(quickScan, /importance>=7 && confidence>=6/);
  assert.match(quickScan, /evt_v1_/);
  assert.match(quickScan, /媒体、URL、标题、披露日期、金额、投资方、评分和批次不得入键/);
  assert.match(quickScan, /疑似同事件但无法确认时不自动合并或写入/);
  assert.match(quickScan, /超时／未知先按 ID 回查，不能直接重放/);
  assert.match(quickScan, /批量回读 ID、标题、发布时间、URL、评分、分类/);
  assert.match(quickScan, /legacy_feishu_primary/);
  assert.match(quickScan, /绝不切换或双写/);
  assert.match(quickScan, /不得修改项目／人物评级、状态、Notes、互动或更新时间/);
  assert.match(quickScan, /RADAR_RESULT/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const radar = read("skills", "investment-radar", "SKILL.md");
const sourceRegistry = read("skills", "investment-radar", "references", "source-registry.md");
const podcast = read("skills", "investment-radar", "references", "podcast-ingestion.md");
const router = read("skills", "domi-router", "SKILL.md");
const routerWorkflow = read("skills", "domi-router", "references", "podcast-ingestion-workflow.md");
const plaud = read("skills", "plaud", "SKILL.md");
const asrNotes = read("skills", "asr-notes", "SKILL.md");
const investmentMgmt = read("skills", "investment-mgmt", "SKILL.md");

test("user sources remain private and podcast auto processing is opt in", () => {
  assert.match(radar, /新闻／RSS／重点公众号／播客信源/);
  assert.match(sourceRegistry, /不得写入插件源码、Git、诊断报告或发布包/);
  assert.match(sourceRegistry, /autoProcess/);
  assert.match(sourceRegistry, /默认必须为 `false`/);
  assert.match(sourceRegistry, /不得读取用户日常 Chrome／Tabbit Profile/);
});

test("podcast transcription is forced through the user's PLAUD account", () => {
  for (const contract of [podcast, router, routerWorkflow, plaud, asrNotes, investmentMgmt]) {
    assert.match(contract, /PLAUD/);
  }
  assert.match(podcast, /禁止回退到 Qwen、Whisper 或任何本地 ASR/);
  assert.match(router, /播客是例外/);
  assert.match(asrNotes, /sourceKind=podcast/);
  assert.match(asrNotes, /transcriptProvider=plaud/);
  assert.match(asrNotes, /禁止本地 ASR/);
  assert.match(routerWorkflow, /transcriptPath: \/absolute\/private\/path\/from\/plaud\.md/);
  assert.match(routerWorkflow, /transcriptProvider: plaud/);
  assert.match(routerWorkflow, /audioPath.*只能交给 PLAUD/);
});

test("a podcast has one canonical document with project or industry references", () => {
  assert.match(podcast, /project_dominant/);
  assert.match(podcast, /industry_dominant/);
  assert.match(podcast, /ambiguous/);
  assert.match(podcast, /只允许一个可编辑主文档/);
  assert.match(investmentMgmt, /只保存引用/);
  assert.match(investmentMgmt, /不得暗中新建项目/);
  assert.match(routerWorkflow, /archiveSignals:/);
  assert.match(routerWorkflow, /linkedProjectIds:/);
});

test("Xiaoyuzhou uses only public episode metadata and direct audio", () => {
  assert.match(podcast, /JSON-LD/);
  assert.match(podcast, /`og:audio`/);
  assert.match(podcast, /`enclosure\.url`/);
  assert.match(podcast, /不调用小宇宙私有 API/);
  assert.match(podcast, /付费／受限标记、无公开直链或只有 HLS／DRM 时返回明确错误/);
});

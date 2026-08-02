"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const skill = fs.readFileSync(
  path.join(__dirname, "..", "skills", "asr-notes", "SKILL.md"),
  "utf8"
);

test("final notes present corrected facts without exposing the ASR repair process", () => {
  assert.match(skill, /最终纪要只呈现纠正后的准确结果/);
  assert.match(skill, /用户明确给出的别名映射/);
  assert.match(skill, /公开网络搜不到就标记为可疑/);
  assert.match(skill, /人物关系排除清单/);
  assert.match(skill, /禁止在正文加入`公开检索未找到能够独立验证/);
  assert.doesNotMatch(skill, /以表格形式汇报复核结果/);
});

test("ongoing and planned financing are included in the financing table", () => {
  assert.match(
    skill,
    /状态 \| 融资时间\/计划交割 \| 融资轮次 \| 投前估值 \| 股东\/拟投资方出资情况 \| 投后\/目标估值/
  );
  assert.match(skill, /状态只能使用`已完成`、`进行中`、`计划中`/);
  assert.match(skill, /进行中 → 计划中 → 已完成/);
  assert.match(skill, /未提及就不生成“材料未披露”清单/);
  assert.doesNotMatch(skill, /当前融资规划等\*\*非历史融资条目\*\*/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const skill = fs.readFileSync(
  path.join(__dirname, "..", "skills", "asr-notes", "SKILL.md"),
  "utf8"
);
const editorialStandard = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "skills",
    "asr-notes",
    "references",
    "investment-note-editorial-standard.md"
  ),
  "utf8"
);
const educationEvidence = fs.readFileSync(
  path.join(__dirname, "..", "skills", "asr-notes", "references", "education-evidence.md"),
  "utf8"
);
const careerEvidence = fs.readFileSync(
  path.join(__dirname, "..", "skills", "asr-notes", "references", "career-model-evidence.md"),
  "utf8"
);
const founderFormat = fs.readFileSync(
  path.join(__dirname, "..", "skills", "asr-notes", "references", "founder-profile-format.md"),
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

test("investment notes separate evidence work from a concise high-signal final document", () => {
  assert.match(skill, /investment-note-editorial-standard\.md/);
  assert.match(skill, /所有\*\*对理解公司、人物、产品、交易或投资判断有增量的信息单元\*\*/);
  assert.match(editorialStandard, /年份—公司／机构—岗位/);
  assert.match(editorialStandard, /不得用“技术背景深厚”“搜索经验丰富”代替/);
  assert.match(editorialStandard, /谁组织／参与 → 研究对象与方法 → 得到的具体发现 → 放弃／坚持的产品定位决定/);
  assert.match(editorialStandard, /不得删除四类必要边界/);
  assert.match(editorialStandard, /归属.*时间.*推算.*未解决冲突/s);
});

test("historical notes stay useful without being mistaken for the current meeting", () => {
  assert.match(editorialStandard, /本次录音 \| 历史交流（含日期） \| 公司材料 \| 公开资料 \| 用户更正 \| 推算/);
  assert.match(editorialStandard, /不得让旧材料看起来像本次会中披露或公司当前状态/);
  assert.match(editorialStandard, /允许按`入学年份-18`计算/);
  assert.match(editorialStandard, /实体修正必须原子更新/);
  assert.match(editorialStandard, /current_transcript.*historical_record.*verification_only/s);
  assert.match(editorialStandard, /未提供时由本Skill根据用户本轮明确给出的输入生成/);
  assert.match(editorialStandard, /不得自行把旧项目文档升级为历史正文来源/);
  assert.match(editorialStandard, /notesScope=current_session/);
  assert.match(editorialStandard, /notesScope.*longitudinal/s);
  assert.match(careerEvidence, /historical_record/);
  assert.match(careerEvidence, /不得把历史技术写成当前公司的技术栈/);
  assert.match(educationEvidence, /允许按`本科入学年份-18`推算/);
});

test("founder birth year may be inferred only from a known undergraduate entry year", () => {
  assert.match(skill, /本科首次入学年份明确时，可按`入学年份-18`写成`YYYY（推算）`/);
  assert.match(editorialStandard, /允许按`入学年份-18`计算/);
  assert.match(educationEvidence, /允许按`本科入学年份-18`推算/);
  assert.match(founderFormat, /允许按`本科入学年份-18`推算/);
  assert.match(founderFormat, /<本科入学年份>-18=<推算出生年份>/);
  const birthYearRules = [skill, editorialStandard, educationEvidence, founderFormat].join("\n");
  assert.doesNotMatch(birthYearRules, /不得[^\n]*(?:本科|大学)[^\n]*(?:减|推算)[^\n]*18/);
  assert.doesNotMatch(birthYearRules, /禁止[^\n]*(?:本科|大学)[^\n]*(?:减|推算)[^\n]*18/);
});

test("verification-only materials cannot silently expand the meeting narrative", () => {
  assert.match(editorialStandard, /verification_only.*否；默认只纠正／核实/s);
  assert.match(skill, /`verification_only`辅助文件/);
  assert.match(skill, /`historical_record`的旧交流纪要不属于本阶段/);
  assert.match(skill, /封闭的`sourceManifest`或用户明确禁止联网/);
  assert.match(skill, /不得读取清单外来源/);
});

test("long project notes use restrained scan-friendly emphasis and a compact career table", () => {
  assert.match(skill, /长篇模式A纪要可按编辑规范选3—5条完整句子用`<u>\.\.\.<\/u>`标出/);
  assert.match(editorialStandard, /只保留`姓名 \| 出生年份 \| 当前职位 \| 学历 \| 工作经历`五列/);
  assert.match(editorialStandard, /外部背景数字保留对投资判断有意义的有效位数/);
  assert.doesNotMatch(editorialStandard, /姓名 \| 出生年份 \| 当前职位 \| 学历 \| 历史职级\/岗位 \| 工作经历/);
  assert.match(skill, /founder-profile-format\.md/);
  assert.match(founderFormat, /不要再加“工作经历：”父bullet/);
  assert.match(founderFormat, /单元格内换行统一用` <br \/>`/);
  assert.match(founderFormat, /YYYY（推算）/);
});

test("high-signal product decisions and counter-consensus founder theses survive filtering", () => {
  assert.match(editorialStandard, /谁组织／参与 → 研究对象与方法 → 得到的具体发现 → 放弃／坚持的产品定位决定/);
  assert.match(editorialStandard, /标杆公司重塑低效旧行业的类比/);
  assert.match(editorialStandard, /行业需求存在但旧供给没有做好／缺少能定义行业的人/);
  assert.match(editorialStandard, /必须保留真实主语/);
  assert.match(skill, /谁组织／参与 → 如何研究或讨论 → 得到什么证据 → 最终放弃／坚持什么决定/);
  assert.match(skill, /行业需求存在但旧供给没有做好／缺少能定义行业的人/);
  assert.match(skill, /删除过程性路演建议，不删除投资判断本身/);
});

test("process narration is removed instead of paraphrased", () => {
  assert.match(editorialStandard, /只说明“查了什么、没查到什么、为何没有采用某字段”/);
  assert.match(editorialStandard, /删除后不得留下同义改写/);
  assert.match(founderFormat, /不出现搜索路径、候选排除、缺失字段枚举、反复核验说明/);
  assert.match(editorialStandard, /相邻表格字段即可直接复算的确定性算术只展示结果/);
  assert.match(skill, /低信息量或不影响判断的乱码只留在精修稿和内部审计，不进入最终纪要/);
  assert.doesNotMatch(skill, /宁可让笔记"丑"一点/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const skill = fs.readFileSync(
  path.join(__dirname, "..", "skills", "asr-notes", "SKILL.md"),
  "utf8"
);
const readReference = (name) =>
  fs.readFileSync(
    path.join(__dirname, "..", "skills", "asr-notes", "references", name),
    "utf8"
  );
const audioRules = readReference("audio-transcription-and-speakers.md");
const modeRules = readReference("meeting-modes-and-chapters.md");
const entityRules = readReference("entity-and-number-verification.md");
const investmentEvidenceGates = readReference("investment-evidence-gates.md");
const commonFormat = readReference("refinement-and-common-format.md");
const investmentStructure = readReference("investment-note-structure.md");
const completenessQa = readReference("completeness-qa.md");
const optionalVerification = readReference("optional-material-and-pending-verification.md");
const deliveryRules = readReference("delivery-rules.md");
const handoffContract = readReference("recoverable-handoff-contract.md");
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
const allRules = [
  skill,
  audioRules,
  modeRules,
  entityRules,
  investmentEvidenceGates,
  commonFormat,
  investmentStructure,
  completenessQa,
  optionalVerification,
  deliveryRules,
  handoffContract,
  editorialStandard,
  educationEvidence,
  careerEvidence,
  founderFormat,
].join("\n");

test("all progressive-disclosure Markdown references resolve from their containing file", () => {
  const skillRoot = path.join(__dirname, "..", "skills", "asr-notes");
  const markdownFiles = [
    path.join(skillRoot, "SKILL.md"),
    ...fs.readdirSync(path.join(skillRoot, "references"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => path.join(skillRoot, "references", name)),
  ];

  for (const filePath of markdownFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const match of content.matchAll(/\]\(([^)#]+\.md)(?:#[^)]+)?\)/g)) {
      const targetPath = path.resolve(path.dirname(filePath), match[1]);
      assert.ok(
        fs.existsSync(targetPath),
        `${path.relative(skillRoot, filePath)} links to missing ${match[1]}`,
      );
    }
  }
});

test("final notes present corrected facts without exposing the ASR repair process", () => {
  assert.match(skill, /最终纪要只呈现纠正后的准确结果/);
  assert.match(skill, /用户明确给出的别名映射/);
  assert.match(skill, /公开网络搜不到就标记为可疑/);
  assert.match(skill, /人物关系排除清单/);
  assert.match(skill, /禁止在正文加入`公开检索未找到能够独立验证/);
  assert.doesNotMatch(allRules, /以表格形式汇报复核结果/);
});

test("ongoing and planned financing are included in the financing table", () => {
  assert.match(
    investmentStructure,
    /状态 \| 融资时间\/计划交割 \| 融资轮次 \| 投前估值 \| 股东\/拟投资方出资情况 \| 投后\/目标估值/
  );
  assert.match(investmentStructure, /状态只能使用`已完成`、`进行中`、`计划中`/);
  assert.match(investmentStructure, /进行中 → 计划中 → 已完成/);
  assert.match(investmentStructure, /未提及就不生成“材料未披露”清单/);
  assert.doesNotMatch(allRules, /当前融资规划等\*\*非历史融资条目\*\*/);
});

test("investment notes separate evidence work from a concise high-signal final document", () => {
  assert.match(skill, /investment-note-editorial-standard\.md/);
  assert.match(commonFormat, /所有\*\*对理解公司、人物、产品、交易、讨论结论、行动安排或投资判断有增量的信息单元\*\*/);
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
  assert.match(investmentStructure, /本科首次入学年份明确时，可按`入学年份-18`写成`YYYY（推算）`/);
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
  assert.match(allRules, /`verification_only`辅助文件/);
  assert.match(allRules, /`historical_record`的旧交流纪要不属于本阶段/);
  assert.match(allRules, /封闭的`sourceManifest`或用户明确禁止联网/);
  assert.match(allRules, /不得读取清单外来源/);
});

test("long project notes use restrained scan-friendly emphasis and a compact career table", () => {
  assert.match(commonFormat, /长篇模式A纪要可按编辑规范选3—5条完整句子用`<u>\.\.\.<\/u>`标出/);
  assert.match(editorialStandard, /只保留`姓名 \| 出生年份 \| 当前职位 \| 学历 \| 工作经历`五列/);
  assert.match(editorialStandard, /外部背景数字保留对投资判断有意义的有效位数/);
  assert.doesNotMatch(editorialStandard, /姓名 \| 出生年份 \| 当前职位 \| 学历 \| 历史职级\/岗位 \| 工作经历/);
  assert.match(skill, /founder-profile-format\.md/);
  assert.match(founderFormat, /不要再加“工作经历：”父bullet/);
  assert.match(founderFormat, /单元格内换行统一用原始内联 HTML token ` <br \/>`/);
  assert.match(founderFormat, /不得写成反斜杠转义、反引号代码或 HTML 实体/);
  assert.match(editorialStandard, /渲染预览中确认页面没有显示字面量`<br \/>`/);
  assert.match(founderFormat, /一条bullet对应单元格中的一行/);
  assert.match(founderFormat, /`N-1`个`<br \/>`/);
  assert.match(founderFormat, /不得用空格、逗号或顿号把两段经历连成一段/);
  assert.match(editorialStandard, /汇总表必须由上方已核验的学历／工作经历bullet逐条投影/);
  assert.match(allRules, /否则不得交付或归档/);
  assert.match(founderFormat, /YYYY（推算）/);
});

test("high-signal product decisions and counter-consensus founder theses survive filtering", () => {
  assert.match(editorialStandard, /谁组织／参与 → 研究对象与方法 → 得到的具体发现 → 放弃／坚持的产品定位决定/);
  assert.match(editorialStandard, /标杆公司重塑低效旧行业的类比/);
  assert.match(editorialStandard, /行业需求存在但旧供给没有做好／缺少能定义行业的人/);
  assert.match(editorialStandard, /必须保留真实主语/);
  assert.match(completenessQa, /谁组织／参与 → 如何研究或讨论 → 得到什么证据 → 最终放弃／坚持什么决定/);
  assert.match(completenessQa, /行业需求存在但旧供给没有做好／缺少能定义行业的人/);
  assert.match(completenessQa, /删除过程性路演建议，不删除投资判断本身/);
});

test("process narration is removed instead of paraphrased", () => {
  assert.match(editorialStandard, /只说明“查了什么、没查到什么、为何没有采用某字段”/);
  assert.match(editorialStandard, /删除后不得留下同义改写/);
  assert.match(founderFormat, /不出现搜索路径、候选排除、缺失字段枚举、反复核验说明/);
  assert.match(editorialStandard, /相邻表格字段即可直接复算的确定性算术只展示结果/);
  assert.match(commonFormat, /低信息量或不影响判断的乱码只留在精修稿和内部审计，不进入最终纪要/);
  assert.doesNotMatch(allRules, /宁可让笔记"丑"一点/);
});

test("management interview titles use the project-side leader instead of a generated topic", () => {
  const plaudWorkflow = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "skills",
      "domi-router",
      "references",
      "plaud-investment-recording-workflow.md"
    ),
    "utf8"
  );
  const exactTitle = "20260115-示例科技（ExampleTech）-联创 张某";
  assert.match(deliveryRules, /\*\*管理层访谈\*\*/);
  assert.match(deliveryRules, /联合创始人／共同创始人`统一缩写为`联创/);
  assert.match(deliveryRules, /联合创始人兼CTO.*优先使用创始人身份/s);
  assert.match(deliveryRules, new RegExp(exactTitle));
  assert.match(editorialStandard, new RegExp(exactTitle));
  assert.match(plaudWorkflow, new RegExp(exactTitle));
  assert.match(deliveryRules, /不得用模型自行提炼的主题覆盖已确认的管理层访谈身份/);
  assert.match(plaudWorkflow, /不得再用模型提炼的技术主题覆盖/);
});

test("progressive disclosure keeps the entrypoint small and routes conservatively", () => {
  assert.ok(Buffer.byteLength(skill, "utf8") < 12_000);
  assert.match(skill, /选中的reference是\*\*规范性规则\*\*/);
  assert.match(skill, /触发后必须由当前执行者完整读取/);
  assert.match(skill, /场景有歧义时按模式A处理并加载完整投资质量包/);
  for (const reference of [
    "meeting-modes-and-chapters.md",
    "refinement-and-common-format.md",
    "completeness-qa.md",
    "delivery-rules.md",
    "investment-evidence-gates.md",
    "investment-note-structure.md",
    "investment-note-editorial-standard.md",
    "founder-profile-format.md",
    "education-evidence.md",
    "career-model-evidence.md",
  ]) {
    assert.match(skill, new RegExp(reference.replace(".", "\\.")));
  }
  assert.match(skill, /不得降低模型、推理强度、搜索深度、证据门槛、交付篇幅或QA标准/);
});

test("mode B keeps high-value interaction and action items instead of applying the project filter", () => {
  assert.match(commonFormat, /模式B不得套用上面的“只保留创始人／项目方信息”过滤器/);
  assert.match(commonFormat, /保留能改变结论、补足语境、提出关键反证或推动决策的高价值提问与互动/);
  assert.match(commonFormat, /保留会议形成的决定、行动项、负责人、截止时间和依赖条件/);
  assert.match(commonFormat, /可建立`#### 后续行动`/);
  assert.match(deliveryRules, /\*\*非项目会议（模式B）\*\*/);
  assert.match(deliveryRules, /\[YYYYMMDD\]-\[核心主题\]-\[会议类型\]\.md/);
  assert.match(deliveryRules, /模式仍不确定.*交流纪要/s);
});

test("recoverable workflows persist evidence and QA without replacing the transcript", () => {
  assert.match(skill, /recoverable-handoff-contract\.md/);
  assert.match(skill, /持久化`evidence_index`和`qa_receipt`/);
  assert.match(handoffContract, /schema: asr\.evidence-index\.v1/);
  assert.match(handoffContract, /schema: asr\.qa-receipt\.v1/);
  assert.match(handoffContract, /evidence index不能用摘要替代原文/);
  assert.match(handoffContract, /独立的一次性普通纪要.*可以只在内存维护/s);
  assert.match(handoffContract, /默认用户交付仍只显示纪要文件和必要结论/);
  assert.match(handoffContract, /domi\.handoff\.v1\.artifacts/);
});

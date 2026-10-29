"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const router = read("skills/domi-router/SKILL.md");
const routerAgent = read("skills/domi-router/agents/openai.yaml");
const recordingWorkflow = read(
  "skills/domi-router/references/plaud-investment-recording-workflow.md",
);
const artifactDelivery = read(
  "skills/domi-router/references/artifact-delivery.md",
);

test("every plugin Skill default prompt uses its domi namespace", () => {
  const skillsRoot = path.join(root, "skills");
  const agentFiles = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      skillName: entry.name,
      agentPath: path.join(skillsRoot, entry.name, "agents", "openai.yaml"),
    }))
    .filter(({ agentPath }) => fs.existsSync(agentPath));

  assert.ok(agentFiles.length > 0, "expected plugin Skill agent definitions");
  for (const { skillName, agentPath } of agentFiles) {
    const yaml = fs.readFileSync(agentPath, "utf8");
    assert.match(
      yaml,
      new RegExp(`default_prompt:.*\\$domi:${skillName}(?:\\b|[^A-Za-z0-9_-])`),
      `${path.relative(root, agentPath)} must invoke $domi:${skillName}`,
    );
    assert.doesNotMatch(
      yaml,
      new RegExp(`default_prompt:.*\\$(?!domi:)${skillName}(?:\\b|[^A-Za-z0-9_-])`),
      `${path.relative(root, agentPath)} must not invoke the unnamespaced Skill`,
    );
  }
});

test("domi-router agent is a general namespaced entrypoint", () => {
  assert.match(routerAgent, /\$domi:domi-router/);
  assert.doesNotMatch(routerAgent, /\$domi-router\b/);
  assert.match(routerAgent, /录音、研究、Slides、行业雷达、人物、待办、日程或交付意图/);
  assert.match(router, /每一条用户消息都先按\*\*本轮最新、明确的原始意图\*\*重新选择路由/);
});

test("Slides, PPT and deck requests route to the standalone Slides skill", () => {
  assert.match(router, /Slides／PPT／deck／演示文稿/);
  assert.match(router, /叠加 `domi:slides`/);
  assert.match(router, /默认生成 Morgan Stanley 投行风格 HTML \+ PDF/);
  assert.match(router, /只有用户明确要求可编辑 PowerPoint／PPTX 时才额外交付 PPTX/);
  assert.match(router, /保留原模板时仍执行 Slides 内容、字体、密度和视觉 QA/);
});

test("ordinary follow-up after a completed recording cannot rerun PLAUD or ASR", () => {
  for (const terminalState of ["managed", "notes_non_project", "discussion_complete"]) {
    assert.match(recordingWorkflow, new RegExp(`\\b${terminalState}\\b`));
  }
  assert.match(recordingWorkflow, /终态只说明既有录音工作流可供引用，不授权下一条用户消息重新进入录音流程/);
  assert.match(recordingWorkflow, /每条新消息必须先按本轮最新原始意图重新路由/);
  assert.match(recordingWorkflow, /只做最小增量修订/);
  assert.match(recordingWorkflow, /禁止调用 PLAUD `pending`、`sync-pending`、生成、上传或下载/);
  assert.match(recordingWorkflow, /禁止重跑 `domi:asr-notes` 的完整纪要生成流程/);
  assert.match(recordingWorkflow, /只有用户本轮明确说“重新处理／重新转写／用新录音重做／重新同步”/);
  assert.match(router, /普通追问直接基于已验证产物回答/);
});

test("real-file delivery uses the Codex deliverable marker and a binary channel receipt", () => {
  assert.match(artifactDelivery, /domi\.delivery-artifact\.v1/);
  assert.match(artifactDelivery, /purpose": "deliverable"/);
  assert.match(artifactDelivery, /deliveryMode": "attachment"/);
  assert.match(
    artifactDelivery,
    /:codex-file-citation\{path="\/absolute\/\.\.\." purpose="deliverable"\}/,
  );
  assert.match(artifactDelivery, /微信桥接.*读取该文件的真实字节.*以文件消息上传/s);
  assert.match(artifactDelivery, /绝不能把 marker 序列化成聊天文本/);
  assert.match(artifactDelivery, /不能消费 Codex deliverable marker.*`blocked_missing_attachment_channel`/s);
  assert.match(artifactDelivery, /workflowRunId \+ artifactId \+ channel \+ target \+ sha256/);
  assert.match(artifactDelivery, /只有附件 API 返回成功并能以回执确认目标会话中的真实文件时/);
});

test("document previews stay separate from attachment delivery and link examples are complete", () => {
  const previewRoute = router.split("\n").find(line => line.startsWith("| 查看／打开已生成文档 |"));
  assert.ok(previewRoute, "existing documents need a local preview route");
  assert.match(previewRoute, /可点击的文档链接/);
  assert.doesNotMatch(previewRoute, /原生文件通道|发送|下载/);
  assert.match(artifactDelivery, /本机预览入口不等于附件已发送/);
  assert.match(artifactDelivery, /不能读取本机文件的渠道不能用本地链接代替附件/);
  assert.match(artifactDelivery, /未归档时可链接已验证的工作区文件/);
  assert.match(artifactDelivery, /不要猜路径或把暂存结果说成已入库/);
  const openings = [...artifactDelivery.matchAll(/\[[^\]\n]+\]\(</g)];
  const examples = [...artifactDelivery.matchAll(/\[[^\]\n]+\]\(<[^<>\n`]+>\)/g)].map(match => match[0]);
  assert.ok(examples.length >= 3, "local preview examples must include notes and transcript links");
  assert.equal(examples.length, openings.length, "all angle-bracket link examples must close with >)");
  for (const example of examples) {
    assert.match(example, /^\[[^\]\n]+\]\(<\/[^<>\n]+>\)/, "angle-bracket paths must close with >) before prose");
  }
  assert.ok(examples.some(example => /纪要 \(修订\)\.md>\)/.test(example)), "keep a valid example with spaces and parentheses");
});

test("recording completion links artifacts without exposing recovery state or successful QA", () => {
  const completion = recordingWorkflow.split("## 九、最终报告")[1];
  assert.ok(completion);
  assert.match(completion, /artifact-delivery\.md/);
  assert.match(completion, /纪要和已有完整文字稿的可点击入口/);
  assert.match(completion, /不把状态迁移、证据索引、QA、哈希、回读日志或更新时间逐项列入正常完成反馈/);
  assert.match(completion, /实际未完成的入库或发送必须如实说明/);
  assert.match(artifactDelivery, /`context_ready`、`notes_non_project`、`managed`/);
  assert.match(artifactDelivery, /`score\/projectId\/recordId`/);
  assert.match(artifactDelivery, /用户明确索要审计／排障时再提供相关内容/);
  assert.match(artifactDelivery, /不因此额外生成精修逐字稿/);
  assert.match(read("skills/asr-notes/references/delivery-rules.md"), /domi-router\/references\/artifact-delivery\.md/);
});

test("artifact-producing Skills defer explicit file requests to the shared contract", () => {
  const relatedSkills = [
    "asr-notes",
    "asr-refine",
    "deal-negotiation",
    "desk-research",
    "ic-memo",
    "investment-analysis",
    "investment-mgmt",
    "investment-radar",
    "investment-review",
    "mac-recording",
    "plaud",
    "slides",
    "sourcing",
    "todo",
  ];

  for (const skillName of relatedSkills) {
    const skill = read(`skills/${skillName}/SKILL.md`);
    assert.match(
      skill,
      /domi-router\/references\/artifact-delivery\.md/,
      `${skillName} must use the shared artifact delivery contract`,
    );
  }

  const asrNotes = read("skills/asr-notes/SKILL.md");
  assert.doesNotMatch(asrNotes, /默认只告知完成和纪要路径/);
});

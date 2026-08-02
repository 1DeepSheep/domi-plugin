const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const skill = fs.readFileSync(path.join(root, "skills", "investment-review", "SKILL.md"), "utf8");
const intake = fs.readFileSync(
  path.join(root, "skills", "domi-router", "references", "project-intake-workflow.md"),
  "utf8"
);

test("investment review prioritizes product, industry and winner path over generic diligence", () => {
  assert.match(skill, /产品与行业问题至少占一半/);
  assert.match(skill, /成功公司的形态／胜出路径/);
  assert.match(skill, /尽调项不得冒充关键问题/);
  assert.match(skill, /当前轮、可执行的价格与条款/);
  assert.match(skill, /事情是否成立、公司如何长大、谁会成功/);
});

test("project intake enforces the same investment-review quality gate", () => {
  assert.match(intake, /产品与行业问题至少 2 个/);
  assert.match(intake, /后置尽调/);
  assert.match(intake, /具体 deal breaker/);
});

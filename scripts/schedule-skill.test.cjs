const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const skill = fs.readFileSync(path.join(root, "skills", "schedule", "SKILL.md"), "utf8");
const agent = fs.readFileSync(
  path.join(root, "skills", "schedule", "agents", "openai.yaml"),
  "utf8"
);

assert.match(skill, /一个或多个参会人/);
assert.match(skill, /主动询问“日程邀请发给哪些邮箱/);
assert.match(skill, /逗号、分号、空格或换行分隔/);
assert.match(skill, /忽略大小写去重并校验格式/);
assert.match(skill, /不得自动选择或群发本机保存的整个常用参会人列表/);
assert.match(skill, /主题[\s\S]*日期和开始时间[\s\S]*地点或线上方式[\s\S]*一个或多个接收日程邀请的参会人邮箱/);
assert.match(skill, /Outlook Calendar 连接器/);
assert.doesNotMatch(skill, /\$domi:todo|待办事项设为|完整读取.*outlook-calendar|检查冲突/);
assert.match(agent, /如果我没选择参会人，请先问我要发给哪些邮箱/);

console.log("schedule skill checks passed");

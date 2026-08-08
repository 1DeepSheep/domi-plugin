const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  buildJob,
  compareManifest,
  parseMarkdown
} = require("./feishu-markdown-export.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-feishu-md-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imagePath = path.join(root, "chart.png");
  fs.writeFileSync(imagePath, Buffer.from("fake-image-content"));
  const markdownPath = path.join(root, "report.md");
  fs.writeFileSync(markdownPath, `# 标题

正文含有 **粗体** 和 [来源](https://example.com/source)。

- 项目一
- [x] 已完成

| 公司 | 评级 |
|---|---|
| 示例 | A |

\`\`\`js
console.log("ok");
\`\`\`

![图表](./chart.png)
`);
  return { root, imagePath, markdownPath };
}

test("prepare resolves local images and produces a private handoff manifest", (t) => {
  const { imagePath, markdownPath } = fixture(t);
  const job = buildJob(markdownPath, { title: "投资报告" });
  assert.equal(job.capability, "domi.feishuMarkdownExporter.v1");
  assert.equal(job.artifactType, "domi.feishuMarkdownPreflight.v1");
  assert.equal(job.authorization, "none");
  assert.equal(job.hostMustUseOriginalUserIntent, true);
  assert.equal(job.hostMustUseCurrentOpenDocument, true);
  assert.equal(job.manifest.counts.images, 1);
  assert.equal(job.manifest.counts.tableCells, 4);
  assert.equal(job.manifest.counts.codeBlocks, 1);
  assert.equal(job.manifest.images[0].resolvedPath, imagePath);
  assert.equal(job.manifest.images[0].byteLength > 0, true);
  assert.equal(job.authorizationToken, undefined);
});

test("preflight job contains no app write credential or IPC endpoint", (t) => {
  const { markdownPath } = fixture(t);
  const job = buildJob(markdownPath, {});
  assert.equal(job.authorizationToken, undefined);
  assert.equal(job.authorizationRunId, undefined);
  assert.equal(job.socketPath, undefined);
});

test("missing local images fail before any Feishu document can be created", (t) => {
  const { root } = fixture(t);
  const source = path.join(root, "missing.md");
  fs.writeFileSync(source, "# 报告\n\n![缺图](./not-found.png)\n");
  assert.throws(() => buildJob(source, {}), (error) => error.code === "MISSING_LOCAL_IMAGE");
});

test("mixed Markdown image syntaxes preserve document order", (t) => {
  const { root } = fixture(t);
  for (const name of ["inline.png", "reference.png", "html.png"]) {
    fs.writeFileSync(path.join(root, name), Buffer.from(name));
  }
  const source = path.join(root, "mixed.md");
  fs.writeFileSync(source, `# 图片顺序

![内联](./inline.png)

![引用][chart]

<img src="./html.png" alt="HTML">

[chart]: ./reference.png
`);
  const manifest = buildJob(source, {}).manifest;
  assert.deepEqual(manifest.images.map((image) => image.alt), ["内联", "引用", "HTML"]);
});

test("export returns an App-host handoff and never falls back to a plain document write", (t) => {
  const { markdownPath } = fixture(t);
  const result = spawnSync(process.execPath, [
    path.join(__dirname, "feishu-markdown-export.cjs"),
    "export",
    "--source",
    markdownPath
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      DOMI_FEISHU_EXPORT_SOCKET: "",
      DOMI_FEISHU_EXPORT_TOKEN: "",
      DOMI_FEISHU_EXPORT_RUN_ID: ""
    }
  });
  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.code, "FEISHU_EXPORT_HANDOFF_REQUIRED");
  assert.equal(output.status, "not_exported");
  assert.match(output.message, /Codex 不接收写凭证/);
  assert.match(output.message, /不会改用低保真直写/);
});

test("verification detects structural or image loss", (t) => {
  const { markdownPath } = fixture(t);
  const source = parseMarkdown(fs.readFileSync(markdownPath, "utf8"), markdownPath);
  const fetched = parseMarkdown("# 标题\n\n正文含有粗体。\n", path.join(path.dirname(markdownPath), "fetched.md"));
  const mismatches = compareManifest(source, fetched);
  assert.ok(mismatches.includes("images"));
  assert.ok(mismatches.includes("tableCells"));
  assert.ok(mismatches.includes("links"));
});

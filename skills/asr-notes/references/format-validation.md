# 纪要格式检查

适用于最终结构化纪要及其后续修改，不适用于原始文字稿、精修稿、投资快评、研究报告或IC memo。

纪要正文及事实编辑完成后，先使用插件脚本生成格式化版本，再执行完整性与语义QA，并绑定最终版本的哈希：

```bash
node <plugin-root>/scripts/notes-format.cjs format --input <草稿.md> --output <最终纪要.md> --profile structured-notes --mode A
node <plugin-root>/scripts/notes-format.cjs check --input <最终纪要.md> --profile structured-notes --mode A
```

已确认的非项目讨论使用 `--mode B`；混合旧格式可用 `--mode auto`。程序只调整明确的标题层级、板块分隔线和必要空行，不改写字句、数字、列表、表格或代码块。遇到结构歧义时由模型核对原文，明确主板块与子板块后再执行，不把未知内容强塞进五个投资板块。

- 文档标题、主板块：`####`；子标题：`#####`。已有加粗话题标识可以保留，不必全部改成子标题。
- 相邻主板块之间必须有独立 `---`，前后各留一个空行。文档标题与第一板块之间的参会人行仍是普通正文。
- 只调整格式，不能删除不易归类的正文、补造缺失章节或压缩信息。
- 修改后重新检查实际 Markdown 和客户端渲染；通过后再生成/更新 `evidence_index`、`qa_receipt`，并执行 `domi-workflow.cjs evidence-check`。已有QA若绑定旧文件，不能改写哈希伪装成已审核；保留旧回执，针对新版本重做相应审核。
- `domi-workflow.cjs notes-check --path <最终纪要.md> --mode A` 可独立复查；阶段推进、ASR证据检查及网关正式纪要写入会再次验证格式。原始转写和其他文档类型保持各自格式。

最小示例：

```markdown
#### 20260901-示例科技-创始人 张某
参会人：示例科技张某，投资团队李某
#### 一、团队背景
- 团队事实。

---

#### 二、产品与技术
##### 核心产品
- 产品事实。

---

#### 三、商业化与增长
- 经营事实。
```

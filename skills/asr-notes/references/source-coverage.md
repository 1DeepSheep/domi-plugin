# 原文到纪要的覆盖检查

所有纪要先按[完整性与编辑审查](completeness-qa.md)执行语义判断。以下程序合同适用于新生成／重写的多阶段纪要、PLAUD纪要和将进入评级／归档的纪要；一次性独立笔记保持同等人工审查，默认不增加用户可见附件。

## 先列原文信息，再写正文

1. 锁定完整`transcript`和来源清单，按原文顺序读完。用现有`claims`保存有效信息，不能仅从已经写好的纪要倒推claims。高信号事实包括无数字的机制、失败原因、反例、取舍与观点依据；不按关键词或篇幅挑选。
2. 在内部工作目录生成固定待审区间：

```bash
node <plugin-root>/scripts/notes-coverage.cjs prepare --index <evidence-index.json> --output <coverage.json绝对路径>
```

初始索引此时可以只有来源和工作流身份，随后补齐claims。程序按40行／4000个UTF-16代码单元双上限分段，可调小、不可调大。每段绑定来源哈希，初始为`pending`；`start/end`是从0开始、左闭右开的字符区间。这些边界用于核对覆盖，不是删改文字或重新归类的边界；必须保留跨段上下文、指代和因果关系。

3. 完整审阅每个源区间后，在其`review`中记录`status:reviewed`、`reviewer:model`、`claimIds`及必要的`exclusions`。被保留的信息关联实际来源范围和正文落点。排除项须提供该段内的`start/end`、`kind`与具体`reason`：`non_substantive`为纯寒暄，`mode_excluded`为该模式明确排除的无实质会议流程，`duplicate`为无增量重复，`out_of_scope`为无判断增量的旁支，`unintelligible`仅用于不影响判断且无法辨识的内容。重复项须指明保留了全部增量的事实；重要实体或数字未定不能当作乱码排除，`materialToDecision:true`阻断交付。
4. 不得一键把所有区间标为已审，不得用一个主题词代表整段多个事实。正文写完后先格式化，再给每个claim补充`notesRefs`，例如：

```json
{"claimId":"claim-001","sourceRefs":[{"sourceId":"current","lines":[12,15]}],"notesRefs":[{"lines":[8,9],"quote":"对应纪要中实际存在的完整事实句"}]}
```

`quote`来自最终纪要，不能写原文摘录、标题或“已在技术章节概括”等占位词。同一事实有多个落点时逐一登记。数字单位、口径、实际／目标、计划／完成、本人／团队、问题／方法／结果／限制在原文存在时均须保留。`sourceRefs`与合理排除区间须覆盖所有非空白原文，包括必要的说话人／时间标记，不能只给稀疏的几条引文就宣布全文已审。

## 绑定与检查

5. 将审阅完的coverage文件以`{path,sha256,bytes}`登记在`index.coverage`中，使用`domi-workflow.cjs artifact`计算文件哈希和字节数，不手工填写。更新索引后再生成绑定最终纪要与索引的QA。
6. QA使用`reviewer:model`，除原有实体、数字、完整性、归因等检查外，必须单独记录`checks.editorial:passed`：没有过程备注、泛化空话、未讨论字段清单或模型擅加的投资评价；重要未决边界简洁保留。
7. 运行：

```bash
node <plugin-root>/scripts/notes-coverage.cjs check --index <evidence-index.json> --notes <最终纪要.md>
node <plugin-root>/scripts/domi-workflow.cjs evidence-check --index <evidence-index.json> --qa <qa-receipt.json>
```

程序重新读取实际来源与正文，检查固定区间是否缺失、重复或未审，来源范围是否越界，claim是否有实际正文摘录，以及所有文件哈希是否匹配。新ASR阶段完成、PLAUD的`notes_project`／`notes_non_project`标记均要求这一合同；仅手写`completeness:passed`、泛化章节位置或旧式布尔审计不足以推进。

**程序检查不能判断模型是否识别了所有有效信息，不能证明事实成立或语义等价。** 它只拒绝遗漏审查区间、空落点与过期工件等可验证错误。模型仍须从原文反查正文并完成去噪审阅；不得按程序通过、字数比或关键词覆盖率宣布内容完整。

## 旧纪要与修订

旧工件可只读查看，其覆盖状态显示`legacy-unverified`时，只说明没有新版覆盖凭据，不表示已经完成新版审查，也不自动修改原文、纪要或历史QA。新生成或重新提交完成的纪要必须使用新合同。

旧数据只读核对可给`notes-coverage.cjs check`加`--allow-legacy`，或给`domi-workflow.cjs evidence-check`加`--allow-legacy true`；这两个入口的参数形式不同。不能把旧只读开关用于批准新完成阶段。

用户指出已有纪要错误时，使用原始转写和用户更正定点修订；记录原句、修改理由和新落点，保留旧版本，重跑受影响的语义／格式检查。不得为补凭据而重新转写录音、重建项目、改写历史审计使其看起来审核过新版本。默认仍只向用户交付修正后的纪要。

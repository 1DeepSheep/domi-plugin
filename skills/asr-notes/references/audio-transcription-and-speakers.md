# 音频转写、说话人与来源交接

仅在本地音频、匿名／缺失说话人、PLAUD Router 交接、旧版快速讨论恢复或播客来源场景读取。以下规则为规范性要求，不是可省略的示例。

### 第零阶段：音频文件检测与转写（Audio Detection & Transcription）

**触发条件**：用户提供的文件扩展名为音频格式（`.mp3`、`.wav`、`.m4a`、`.flac`、`.ogg`、`.wma`、`.aac`、`.opus`、`.webm` 等），而非文本文件（`.txt`、`.md`、`.srt` 等），并且输入不是 `sourceKind=podcast`。

> 若用户提供的已是文本文件，跳过本阶段，直接进入【说话人信息确认】。
>
> 若 `sourceKind=podcast`，即使同时给出音频路径也不得进入本阶段。只接受上游 PLAUD 的 `transcriptPath` 与 `transcriptProvider=plaud`；缺少时停止并返回 `waiting_for_plaud`，禁止自动降级。

**步骤一：询问说话人信息**

在开始转写之前，**必须先确认说话人信息**（除非用户已在调用时提供）：

> 开始处理前需要确认一下：
> 1. 这次会议/访谈有几位说话人？
> 2. 分别是谁？（姓名、公司/机构、职位——知道多少说多少即可）
>
> 这些信息有助于转写后的说话人标注和笔记整理。

**等待用户回复后再继续。** 若用户表示不清楚或不想提供，也可继续，但需在后续笔记的参会人行标注"[说话人信息待补充]"。

**步骤二：运行高精度 Qwen3-ASR 并强制说话人分离**

调用本 Skill 自带的 `scripts/transcribe_diarized.py`。该入口固定使用当前 Qwen3-ASR 开源系列中准确率最高的 `Qwen/Qwen3-ASR-1.7B`；模型缓存完成后在本机推理，并把时间戳和说话人结果保存为 JSON 后再渲染为规范文本：

```bash
python3 "<本 Skill 目录>/scripts/transcribe_diarized.py" \
  --audio "<音频文件路径>" \
  --output-dir "<音频文件所在目录>" \
  --num-speakers <说话人数量（若已知）> \
  --context "<领域词汇>"
```

**参数说明**：
- `--model Qwen/Qwen3-ASR-1.7B`：脚本内部固定指定，不依赖 CLI 默认值；不得静默切换到 0.6B，也不得用 0.6B draft model
- `--dtype bfloat16`：包装器内部固定保持模型原始精度，不暴露静默降级开关；一次性改用 float16 必须先说明影响并取得用户明确同意，且不得修改未来默认值
- `--timestamps` 与 `--diarize`：脚本内部**始终启用**。时间戳模型也显式固定为 `Qwen/Qwen3-ForcedAligner-0.6B`，说话人分离由 Pyannote 生成，避免依赖 CLI 将来的默认值
- `--num-speakers`：若用户明确告知人数则传入，否则省略此参数（模型自动检测）
- `--context`：根据会议主题提供领域词汇，帮助模型识别专业术语。示例：
  - 投资访谈：`"融资 估值 投资 创始人 ARR 红杉 高瓴 战投 FA"`
  - 技术讨论：`"模型 训练 推理 GPU 算力 微调 RAG"`
  - 生物医药：`"CRO CDMO 临床 GLP 细胞培养基 IND"`
  - 通用：根据用户描述的会议主题自行组织
- `--context` 除领域词汇外，必须加入已知参会人姓名、公司名、产品名和容易误识的英文术语
- 权威中间产物为 `<音频文件名>.json`；其中必须保留 `segments`、`speaker_segments` 和 `domi_provenance`
- 下游输入为脚本生成的 `<音频文件名>.diarized.txt`，格式为 `### HH:MM:SS.mmm SPEAKER_XX` 加正文；脚本必须用带 `speaker` 字段的逐字/词级 `segments` 生成正文，并用 `speaker_segments` 交叉核对说话人集合和覆盖率。禁止直接读取 JSON 顶层 `text` 代替说话人稿，也禁止直接渲染可能漏掉零时长对齐字的 `speaker_segments.text`

**强制门禁与失败规则**：
- 包装器在每次转写前自动运行隔离环境中的 `mlx-qwen3-asr --doctor` 并解析具体检查项；该命令即使存在 diarize warning 也可能返回 0，因此不能只看退出码
- 默认 Pyannote 模型为 `pyannote/speaker-diarization-community-1`。首次使用须在模型页面接受条款并在本机交互执行 `hf auth login`；令牌只保存于 Hugging Face 本机凭据文件，禁止粘贴到对话、Skill、命令参数或插件配置
- diarize extras、Pyannote 模型访问、1.7B 模型加载或实际转写任一失败时，立即停止本地转写和后续整理；明确告知缺失条件。不得自动去掉 `--diarize`，不得自动改用 0.6B
- 只有用户在看到影响后**明确要求无说话人模式**，才允许本次例外降级；该例外不改变以后默认值
- CLI 只在本次运行的临时目录写入 JSON；通过全部校验后才原子发布，禁止把旧 JSON 当成本次成功结果
- CLI 成功退出后仍须通过脚本的产物语义校验：顶层文字非空且未截断、`segments` 非空且每项都有安全的说话人标签、`speaker_segments` 非空、两套分段的说话人集合一致、时间范围有效、带说话人正文覆盖原稿；渲染时须保留顶层文字的标点与空格，并合并相邻同一说话人的逐字/词级片段。音频、JSON 和渲染文本路径必须互不相同
- 已知说话人数时，产物中的非空说话人标签数量必须与人数一致；不一致视为分离失败，不得按名单顺序猜测姓名
- 未知人数且只产生一个标签时，包装器返回 `diarization_status=needs_review`；若内容明显包含多人，视为说话人分离异常并暂停姓名归因
- `SPEAKER_00` 等标签只表示声纹聚类，不等于真实身份；只有自我介绍、用户确认或其他明确锚点足够时才能映射姓名

**步骤三：确认转写完成**

转写完成后：
1. 告知用户 JSON 路径、带说话人文本路径、实际说话人数、`diarization_status`、已验证模型和大致字数
2. 将生成的 `.diarized.txt` 文件作为输入，继续执行后续阶段（第一阶段起）

---

### 【说话人信息确认】

**即使用户提供的是文本文件**（非音频），如果满足以下任一条件，也应在开始处理前主动询问说话人信息：

- 文本中有 `Speaker 1`、`Speaker 2` 等匿名说话人标签，但未标注真实姓名
- 文本中完全没有说话人标记（纯文字流）
- 用户未在调用时说明参会人是谁

询问方式：

> 开始处理前确认一下：这次会议的参会人分别是谁？（姓名、公司/机构、职位——知道多少说多少即可）

**例外**：如果文本开头已有明确的自我介绍（如"大家好我是XX公司的XXX"），且说话人信息从内容中可以完整提取，则无需额外询问。

**domi Router 上下文确认例外**：若上游 `domi-router` 已完成 PLAUD 的对话上下文确认，并传入 `contextStatus=provided` 或 `contextStatus=skipped`，不要再次询问：

- `provided`：把用户补充的对话类型、目的、参会人姓名、机构和职位作为高优先级上下文，与文字稿交叉核对；有冲突时保留并标记待确认，不要静默覆盖原文。
- `skipped`：直接执行后续阶段，从文字稿尽力识别说话人；无法确认时在参会人行标注`[说话人信息待补充]`。

**旧版快速讨论恢复例外**：若上游恢复既有任务，并同时传入 `workflowKind=quick-discussion` 与 `outputProfile=quick_discussion`：

- 输入必须使用 PLAUD 下载的既有 `transcriptPath`，跳过本地 Qwen 音频转写；完整沿用上游的 `discussionTopic`、`contextStatus` 与已知类型、目的和参会人。该例外只用于恢复旧状态，不授权启动新的本机录音。
- 内部讨论默认使用模式 B；只有用户明确说明这是项目拜访／创始人交流时才使用模式 A。即使内容属于创业项目，本工作流也只生成纪要，不自动触发投资评级、归档或项目库写入。
- 默认纪要文件名使用 `[YYYYMMDD]-[主题]-快速讨论.md`；主题从用户输入与文字稿提炼，不强行填入公司名。仍须执行适用的实体、数字、联网核验和完整性审计，不得因“快速”降低事实质量。
- 本阶段只交付完整结构化纪要并返回 `notesPath`。跟进事项不塞回纪要正文；由上游基于最终纪要和原始文字稿生成独立的讨论摘要文件，避免与本 Skill 对会议元信息／Next Steps 的过滤规则冲突。

**播客 PLAUD 交接例外**：若上游传入 `sourceKind=podcast`：

- 必须同时存在 `transcriptProvider=plaud` 和 PLAUD 下载的 `transcriptPath`；只读取该文字稿，跳过本地 Qwen 音频转写。
- 采用上游的 `episodeUrl / episodeId / podcastName / episodeTitle / publishedAt / guests / description` 作为上下文，不再询问用户“参会人”。嘉宾缺失时从公开页面和文字稿核验，无法确认则写“嘉宾待识别”。
- 默认使用模式 B。单集主要介绍某家公司也只生成纪要和归档建议，不自动执行投资评级或项目新建。
- 纪要保留公开单集链接，并返回 `canonicalDocumentTitle` 与 `archiveSignals`（涉及公司、行业、嘉宾、内容占比），交由 Router／investment-mgmt 判定唯一主归档。
- 实体存在疑义时先回看 PLAUD 文字稿上下文并联网核验；不得截取播客音频用本地 ASR 重转。确需重新听写时只能由 Router 恢复同一 PLAUD 文件或请求用户确认 PLAUD 侧重新生成。

---

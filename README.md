<p align="center">
  <img src="assets/domi-icon.png" width="88" alt="domi plugin">
</p>

<h1 align="center">domi plugin</h1>

<p align="center">
  为 Codex 提供投资研究、行业雷达、项目管理、人物研究、会议纪要和资料归档能力。
</p>

<p align="center">
  <a href="https://github.com/1DeepSheep/domi/releases/latest">安装 domi 客户端</a>
  ·
  <a href="https://github.com/1DeepSheep/domi">查看客户端源码</a>
</p>

## 推荐安装方式

普通用户直接安装 [domi Mac 客户端](https://github.com/1DeepSheep/domi/releases/latest) 即可。客户端会安装与当前版本匹配的 domi 插件，并在升级时同步更新；不需要手动复制 Skills 或修改 Codex 配置。

当前公开安装包面向 Apple Silicon Mac。使用前请先安装并登录 Codex：

```bash
codex --version
codex login status
```

Codex 的安装与登录说明见 [OpenAI Codex 官方文档](https://developers.openai.com/codex/)。

## 能力

| 能力 | 可以完成的工作 |
| --- | --- |
| 行业雷达 | 按领域追踪最新新闻、融资、公司和机构动态；可维护公开新闻、RSS、重点公众号与播客信源，核验原文并归档 |
| 项目研究 | 从公司名、链接、BP、截图或项目材料出发，形成结构化研究与项目资料 |
| 投资分析 | 快评、IC 报告、财务与基本面分析、交易谈判和研究 slides |
| 人物研究 | 创始人发现、公开人物画像、关系线索整理和人脉资料维护 |
| 会议纪要 | 音频或文字稿整理、说话人识别、核心结论、跟进事项和项目入库 |
| 本机录音 | 使用 Mac 麦克风录音；可以只保存本地，也可继续交给 PLAUD 处理 |
| 播客纪要 | 从公开 RSS 或单集页面发现重要节目，获用户授权后下载公开音频并交给用户自己的 PLAUD 转写；按公司或行业保存一个主文档并多处关联 |
| 资料管理 | 以本地 SQLite + Markdown 为唯一权威资料库，维护历史融资、最新估值和关注投资机构；飞书 Base／Wiki／Docs／Drive 可按需作为外部参考或发布位置 |
| 待办事项 | 根据关键节点、新入库对象、重点项目与人物动态维护本地工作区的 `0.待办事项.md` |
| Outlook 日程 | 整理主题、时间和地点，并向用户指定的一个或多个参会人发送 Outlook 日程邀请 |

示例：

```text
看一下 AI4S 最近一周值得关注的行业动态。
研究并入库这家公司，整理项目文档并给出初步评级。
把这份创始人交流纪要整理成投资快评。
把这份研究做成 slides 报告。
寻找具身智能方向值得认识的潜在创始人。
同步我的待办事项，把行动项维护到当前资料库的待办事项文档。
整理这个会面的主题、时间和地点，并向我指定的多个参会人发送 Outlook 日程邀请。
开始本地录音，停止后只保存文件。
```

## 本地资料库与飞书知识外挂

domi 默认并始终使用本地资料库：SQLite 保存结构化索引，Markdown 和附件保存在用户选择的 `domi工作区`。首次初始化会创建 `0.待办事项.md`、行业研究、行业动态、项目库和人脉库；重复初始化不会覆盖用户内容。

飞书是可选知识外挂与发布平台，不是第二套管理后端。连接后的权限能力与之前保持一致，完整覆盖 Base、Wiki、Docs、Drive、IM 和 Contact；“本地主库”只决定默认读写位置，不缩减飞书能力：

- 用户明确要求时，domi 可以搜索或读取其有权限的飞书 Base／Wiki／Docs／Drive；本地没有命中不会自动扩张为飞书检索。
- 用户明确指定目标时，可以创建或编辑外部 Base／Wiki／Docs／Drive 内容，通过 Contact 解析收件人并用 IM 发送；这些动作不会把外部资源变成 domi 的管理主库。
- 新用户不需要手工配置 Base Token、Table ID 或固定 Wiki Space ID。连接能力与本轮动作授权相互独立：一次连接保留完整权限，但 domi 只执行用户本轮明确要求的飞书动作。
- 用户明确说“创建到飞书”或“编辑这篇飞书文档”时，可以从本地 Markdown 创建／更新远端副本；不会顺带创建项目、人脉、行业 Base。
- 含本地图片的 Markdown 必须由 App host 根据用户原始明确指令直接传输，并回读验证标题层级、列表、表格、代码、链接、图片和顺序；Codex 不接收飞书写凭证，只接收完成回执。Host 能力不可用或任一图片失败时，整篇保持未导出；不得退化成只创建纯文本飞书文档。
- 远端副本不会替代本地记录，本地修改也不会无授权自动推送到飞书。

旧版曾使用飞书作为主库的用户不会在升级后突然丢失资料或出现两套数据：显式本地导入、最终增量补齐和逐项回读验证完成前，既有 Base／Wiki／本地材料继续按原主库模式读写；插件不会把新数据写进空本地库。全部验证通过后才由客户端原子切换为本地主库，且不会删除旧飞书内容。

PLAUD 是可选连接。如果用户跳过，插件不会启动 PLAUD worker、读取浏览器状态或检查录音队列。连接时由用户选择 Google Chrome 或 Tabbit，并在 domi 专用浏览器 Profile 中亲自登录自己的 PLAUD 账号；插件不会读取或复制日常浏览器 Profile，断开时可删除该专用登录数据。除用户主动登录外，读取与同步命令会以 macOS 隐藏后台模式串行复用该专用 Profile，不会激活日常浏览器窗口或重复打开 `Plaud Web` 标签页。

用户添加的新闻、RSS、重点公众号和播客清单只保存在本机 Application Support，不进入插件或 Git。播客只处理公开、免费的直接音频；不读取平台登录 Cookie，不调用私有接口，不绕过付费、私密、HLS／DASH 或 DRM 限制。播客转写固定使用用户自己的 PLAUD；连接不可用时暂停，不会回退到本地 ASR。

Outlook Calendar 也是可选连接。domi 只声明官方连接器映射；OAuth 登录和令牌由 Codex 管理。未连接时，`schedule` 会提示完成连接，不会改用 SMTP、ICS 邮件或本地凭据。

## 独立使用插件

这个仓库本身是插件源码根目录，主要供客户端打包和插件开发使用。需要脱离 domi 客户端单独使用时，请把仓库放到个人插件目录：

```bash
git clone https://github.com/1DeepSheep/domi-plugin.git ~/plugins/domi
```

然后按照 Codex 官方插件规范，把 `domi` 作为本地插件加入 `~/.agents/plugins/marketplace.json` 对应的个人 marketplace，并运行：

```bash
codex plugin add domi@personal
```

如果你的个人 marketplace 名称不是 `personal`，请替换为该文件顶层的 `name`。不要使用 `codex plugin install <Git URL>`：当前 Codex CLI 没有这一命令。完成安装后请新建一个 Codex 任务，以便载入新的 Skills。

> 独立安装属于开发者路径。希望开箱即用时，请优先使用 domi 客户端自动管理插件。

## 本地数据与隐私

运行时配置和用户数据位于仓库之外：

```text
~/Library/Application Support/domi/
~/Documents/domi/
~/.domi/
```

本仓库不包含用户历史、凭据、录音、文字稿、项目材料、租户标识、表格标识、Wiki 映射、1.待办事项文档链接或私人邮箱。请勿把上述目录中的文件复制进仓库。

## 开发与发布检查

```bash
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
node scripts/public-release-check.cjs
node scripts/public-release-check.cjs --history
```

维护者可将额外的敏感词写入被忽略的 `.privacy-terms.local`，或通过 `DOMI_PRIVATE_IDENTITY_TERMS` 环境变量提供；文件和变量内容不得提交。

## License

[Apache License 2.0](LICENSE)

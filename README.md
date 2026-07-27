<p align="center">
  <img src="assets/domi-icon.png" width="88" alt="domi plugin">
</p>

<h1 align="center">domi plugin</h1>

<p align="center">
  为 Codex 提供投资研究、行业雷达、项目管理、人物研究、会议纪要和资料归档能力。
</p>

<p align="center">
  <a href="https://github.com/1DeepSheep/domi-releases/releases/latest">安装 domi 客户端</a>
  ·
  <a href="https://github.com/1DeepSheep/domi-workbench">查看客户端源码</a>
</p>

## 推荐安装方式

普通用户直接安装 [domi Mac 客户端](https://github.com/1DeepSheep/domi-releases/releases/latest) 即可。客户端会安装与当前版本匹配的 domi 插件，并在升级时同步更新；不需要手动复制 Skills 或修改 Codex 配置。

当前公开安装包面向 Apple Silicon Mac。使用前请先安装并登录 Codex：

```bash
codex --version
codex login status
```

Codex 的安装与登录说明见 [OpenAI Codex 官方文档](https://developers.openai.com/codex/)。

## 能力

| 能力 | 可以完成的工作 |
| --- | --- |
| 行业雷达 | 按领域追踪最新新闻、融资、公司和机构动态，核验原文并归档 |
| 项目研究 | 从公司名、链接、BP、截图或项目材料出发，形成结构化研究与项目资料 |
| 投资分析 | 快评、IC 报告、财务与基本面分析、交易谈判和研究 slides |
| 人物研究 | 创始人发现、公开人物画像、关系线索整理和人脉资料维护 |
| 会议纪要 | 音频或文字稿整理、说话人识别、核心结论、跟进事项和项目入库 |
| 本机录音 | 使用 Mac 麦克风录音；可以只保存本地，也可继续交给 PLAUD 处理 |
| 资料管理 | 在本地 SQLite + Markdown 或用户自己的飞书 Base + Wiki 中完成归档 |

示例：

```text
看一下 AI4S 最近一周值得关注的行业动态。
研究并入库这家公司，整理项目文档并给出初步评级。
把这份创始人交流纪要整理成投资快评。
把这份研究做成 slides 报告。
寻找具身智能方向值得认识的潜在创始人。
开始本地录音，停止后只保存文件。
```

## 资料库模式

首次设置时由用户选择资料库后端：

- **本地模式**：SQLite 保存结构化索引，Markdown 和附件保存在用户选择的文件夹；无需飞书。
- **飞书模式**：由用户在本机配置自己的 Base、表格字段和 Wiki 映射；仓库中不预置任何组织或个人地址。

两种模式复用同一套项目分类、研究和写作规范。domi 在执行前读取用户当前选择，再把结果写入相应后端。

从本地模式切换到飞书时，客户端可以先迁移本地资料：项目 Markdown 和文档内图片进入对应 Wiki，项目、人脉、行业动态分别进入 Watching List、People Base 和行业动态 Base。每条内容都会按业务键去重并回读验证；只有全部通过后才完成后端切换，本地 SQLite、Markdown 和附件始终保留。

PLAUD 是可选连接。如果用户跳过，插件不会启动 PLAUD worker、读取浏览器状态或检查录音队列。

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

本仓库不包含用户历史、凭据、录音、文字稿、项目材料、租户标识、表格标识或 Wiki 映射。请勿把上述目录中的文件复制进仓库。

## 开发与发布检查

```bash
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
node scripts/public-release-check.cjs
node scripts/public-release-check.cjs --history
```

维护者可将额外的敏感词写入被忽略的 `.privacy-terms.local`，或通过 `DOMI_PRIVATE_IDENTITY_TERMS` 环境变量提供；文件和变量内容不得提交。

## License

[Apache License 2.0](LICENSE)

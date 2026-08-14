<p align="center">
  <a href="./README.md">中文</a> · <strong>English</strong>
</p>

<p align="center">
  <img src="assets/domi-icon.png" width="88" alt="domi plugin">
</p>

<h1 align="center">domi plugin</h1>

<p align="center">
  <strong>Turn Codex into an AI investment analyst that can execute real workflows</strong>
</p>

<p align="center">
  Connect information capture, research, investment judgment, knowledge management, ongoing tracking, and downstream actions in recoverable, auditable workflows.
</p>

<p align="center">
  <a href="https://github.com/1DeepSheep/domi/releases/latest">Install the domi Mac app</a>
  ·
  <a href="https://github.com/1DeepSheep/domi">App source and documentation</a>
</p>

## Why domi

General-purpose AI can answer questions. domi is designed to finish investment work. It gives Codex 15 coordinated investment Skills and strict workflow routing, so research, judgment, knowledge management, and follow-up actions can run continuously within one task.

```text
Recordings / documents / web pages / company leads
                         ↓
Transcribe & structure → research & judge → archive locally → track over time → publish to Feishu / schedule actions
```

### 1. Complete end-to-end work instead of stopping at content generation

- An existing PLAUD project recording can move through transcription, structured notes, key takeaways, an investment review, follow-up actions, and repository archival.
- A company name, URL, pitch deck, screenshot, or project file can move through desk research, fact verification, investment rating, project documentation, and structured records.
- An industry scan can move through multi-source discovery, primary-source verification, entity normalization, event deduplication, importance and confidence scoring, priority-entity matching, and event archival.
- For multistage workflows managed by the Router and backed by stage receipts, domi preserves completed artifacts and state and can resume from a verified safe point, reducing the risk of regenerated content, duplicate records, or repeated external actions.

### 2. Produce investment judgment, not just summaries

domi's workflows are built around investment decisions. They cover concise investment reviews, B/A/S ratings, IC memos, prospectus and financial-statement analysis, datapack and pitch-deck analysis, deal-term review, and investment-banking or consulting-style research reports. Material facts are separated from judgment, and important conclusions require sources, dates, and open questions.

### 3. Turn scattered information into compounding institutional memory

Projects, people, industry events, research documents, meeting notes, and tasks live in one local system of record. Within the user's authorized data, domi can search, deduplicate, and connect prior work so each new analysis starts with accumulated context. It can also derive follow-up actions from priority projects, people, and dates.

### 4. Expand an investor's coverage

domi can map sectors, companies, and potential founders through systematic coverage of project pages, papers, open-source repositories, teams, and relationship paths, helping reduce search blind spots. During each user-initiated industry-radar scan, it can track news, financings, policy, technology, companies, and institutions, prioritizing developments that could change an existing investment view.

## Core capabilities

| Capability | What domi can do |
| --- | --- |
| Recordings and meeting notes | Sync existing PLAUD recordings, transcribe them, refine ASR, structure speakers, and produce complete notes, key conclusions, and follow-up actions |
| Project research and intake | Start with a company name, URL, deck, screenshot, or files; complete desk research, deduplication, rating, project documentation, structured records, and attachment archival |
| Investment judgment | High-density 3–5 point reviews, 1–10 scores, B/A/S ratings, risks, and critical validation questions |
| Deep analysis | Analyze prospectuses, annual and quarterly reports, financial statements, datapacks, pitch decks, business models, operations, and financial quality; produce slides or HTML/PDF research decks |
| IC and deal work | IC decision memos, Term Sheet/SAFE/SPA/SHA review, and deal-negotiation preparation |
| Industry radar | News, RSS, priority official WeChat accounts, and public podcast sources; source verification, event-level deduplication, scoring, priority project/person matching, and event archival |
| Company and people mapping | Sector scans, company profiles, potential-founder discovery, public background verification, relationship paths, and next-action recommendations |
| Investment tasks | Derive milestones, meetings, follow-ups, and stalled items from projects, people, industry events, and critical dates |
| Feishu knowledge extension | On explicit request, search or read Base/Wiki/Docs/Drive, create or edit Feishu documents, and publish through Feishu direct messages |
| Outlook scheduling | Organize the topic, time, location, and attendees, then send invitations through the connected Outlook Calendar |

## Typical prompts

Describe the outcome in natural language inside the domi app:

```text
Sync an existing PLAUD recording, then turn it into notes, an investment view, and follow-up actions.
Research and archive this company, create the project document, and give it an initial rating.
Turn these founder-meeting notes into a concise investment review.
Analyze the business quality, financial quality, and key risks in this prospectus.
Write an IC memo from the materials for this project.
Scan the past week of important AI-for-Science developments, prioritizing tracked companies and people.
Find potential founders worth meeting in embodied intelligence and explain possible introduction paths.
Sync my tasks and identify the people and projects I should follow up on next.
Search our Feishu knowledge base for relevant material and publish the final version as a Feishu document.
Schedule this meeting in Outlook and invite the attendees I specify.
```

When the user only asks to “look into” something, domi defaults to read-only research. It does not infer permission to archive, publish, or schedule. Those actions can be explicitly requested later in the same task.

## Why the workflows are reliable

domi does not merely place several Skills side by side. Its Router locks the workflow, repository backend, stage artifacts, completion criteria, and recovery point for each task:

- **Backend locking within a task:** work cannot silently switch between local storage and Feishu.
- **Deduplication before writes:** projects, people, and industry events are searched before creation; ambiguous or bulk changes require confirmation.
- **Read-back verification:** critical structured records and remote deliverables are verified after writing.
- **Read/write separation:** a research request does not automatically become an archival, publishing, or scheduling action.
- **Fail closed:** incomplete permissions, targets, or image exports stop at the current stage instead of being reported as success.
- **Recoverable execution:** completed artifacts and stage markers are preserved so a failed workflow does not restart from zero.

## A local system of record, with Feishu as an optional knowledge extension

domi always defaults to a local repository: SQLite stores structured indexes, Markdown stores readable documents, and attachments remain in the user's selected `domi workspace`. First-time initialization creates tasks, industry research, industry events, project, and people areas. Re-initialization does not overwrite user content, and app or plugin upgrades do not clear runtime data.

Feishu is an optional knowledge extension and publishing platform, not a second management backend. Once connected, Base, Wiki, Docs, Drive, IM, and Contact remain available, but domi only searches, reads, creates, edits, or sends when the user explicitly requests it:

- New users do not need to configure Base Tokens, Table IDs, or a fixed Wiki Space ID manually.
- Connecting Feishu does not create management Bases, migrate local data, or replace the local system of record.
- Before publishing local Markdown to Feishu, domi performs a preflight; after publishing, it reads back and verifies headings, lists, tables, code, links, images, and content order. If any image fails, it does not degrade into a partial text-only copy.
- Remote copies do not replace local records, and local edits are not pushed without an explicit instruction.
- Users of the legacy Feishu-primary setup keep using their existing Base/Wiki/local-material chain until import and item-level read-back verification complete. The switch is atomic, and legacy Feishu content is not deleted.

## Privacy and safety boundaries

Runtime configuration and user data live outside this repository:

```text
~/Library/Application Support/domi/
~/Documents/domi/
~/.domi/
```

- Project files, people data, source lists, recordings, transcripts, databases, Feishu identifiers, and credentials are not committed to Git or included in plugin releases.
- User-managed news, RSS, priority official-account, and podcast lists remain in local Application Support.
- PLAUD is optional. The user signs in through a dedicated domi browser profile; the plugin does not read everyday browser profiles. Podcast ingestion only handles public, free, directly downloadable audio and does not read platform cookies or bypass paywalls, private content, HLS/DASH, or DRM.
- Outlook OAuth is managed by Codex's official connector; the plugin does not store its token.
- Feishu write credentials are not passed to Codex. The local app host performs Markdown publishing only from the user's explicit instruction, while Codex receives a completion receipt.

See [PRIVACY.md](PRIVACY.md) for the full boundary.

## Recommended installation

Most users should install the [domi Mac app](https://github.com/1DeepSheep/domi/releases/latest). The app installs the matching plugin and keeps it synchronized during upgrades, with no manual Skill copying or Codex configuration changes.

Public builds support both Apple Silicon and Intel Macs. Install and sign in to Codex first:

```bash
codex --version
codex login status
```

See the [official OpenAI Codex documentation](https://developers.openai.com/codex/) for installation and sign-in instructions.

## Standalone plugin use (developer path)

This repository is the plugin source root and primarily supports app packaging and plugin development. To use it without the domi app, place the repository in a personal plugin directory:

```bash
git clone https://github.com/1DeepSheep/domi-plugin.git ~/plugins/domi
```

Following the official Codex plugin format, add `domi` to the personal marketplace described by `~/.agents/plugins/marketplace.json`, then run:

```bash
codex plugin add domi@personal
```

If the marketplace is not named `personal`, replace it with the top-level `name` from that file. Do not use `codex plugin install <Git URL>`: the current Codex CLI does not provide that command. Create a new Codex task after installation so the new Skills are loaded.

> For a ready-to-use experience, prefer the domi app and its managed plugin installation.

## Development and release checks

```bash
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
node scripts/public-release-check.cjs
node scripts/public-release-check.cjs --history
```

Maintainers can place extra sensitive terms in the ignored `.privacy-terms.local` file or provide them through `DOMI_PRIVATE_IDENTITY_TERMS`. Neither the file nor the variable contents may be committed.

## License

[Apache License 2.0](LICENSE)

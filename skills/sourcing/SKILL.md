---
name: sourcing
description: Investment sourcing workflow for discovering potential founders, mapping founder talent pools, running public-source background checks, planning warm introductions, and managing investor relationship data in the user-selected Feishu or local SQLite/Markdown repository.
---

# Sourcing

Use this skill to turn ad hoc founder leads and relationship notes into a disciplined sourcing system: discover people, verify background signals, map relationship paths, and keep the current Domi people repository current.

When the task reads or writes internal people data, first read `../investment-mgmt/references/storage-backends.md` and resolve the explicit backend. Use `lark-base` only in Feishu mode; in local mode use the plugin-level `scripts/domi-repo.cjs person search/upsert` commands and never require Feishu authorization.

## Operating Modes

Start by identifying the mode. If the request mixes modes, run them in this order: source candidates -> enrich profiles -> plan outreach -> update Base.

| Mode | Use for | Typical output |
|---|---|---|
| `discover` | Find potential founders or founder-like talent for a thesis, sector, geography, school/company alumni pool, or emerging technology area. | Ranked candidate list with evidence and next action. |
| `profile` | Build a structured profile for one person. | Person profile with identity, career, projects, public signals, relationship path, and confidence. |
| `background-check` | Verify a person's public track record before meeting, investing, hiring, referencing, or introducing. | Background memo with verified facts, open questions, and risk flags. |
| `relationship` | Maintain investor relationship context and follow-ups. | Relationship map, intro path, touchpoint log, next follow-up, Base updates. |
| `base-maintenance` | Query, dedupe, enrich, or update "1.1 People人际关系管理". | Clean records, proposed field mapping, update summary. |

## Step 0: Scope and Guardrails

Before collecting data, lock the brief:

1. Define target scope: sector/thesis, stage, geography, role, seniority, company types, time window, and exclusion criteria.
2. Define purpose: sourcing, meeting prep, reference check, intro planning, portfolio support, or relationship hygiene.
3. Identify whether the user wants only a chat answer, an update to the current people repository, or both.
4. Use only public, user-provided, or authorized internal sources. Do not infer or store sensitive personal attributes such as health, religion, ethnicity, political views, family status, or private contact details unless the user explicitly provided them and they are directly needed for the task.
5. Mark every important claim as `verified`, `user-provided`, `inferred`, or `unverified`; include source and date for time-sensitive facts.

## Step 1: Route Tools

Use the narrowest tool that matches the task:

- In Feishu mode use `lark-base` for all operations on "1.1 People人际关系管理".
- In local mode use `domi-repo.cjs person search/upsert`; SQLite is the structured authority and the generated `人物主页.md` is its readable mirror.
- Use `lark-contact` only when a Feishu/Lark user identity must be resolved from a name, email, or open_id.
- Use `lark-im`, `lark-calendar`, or `lark-mail` only when the user explicitly asks to use communication history or schedule context and permissions are available.
- Use `desk-research` when a person is tied to a company/project that needs a company or sector investment profile.
- Use `investment-mgmt` when the person's company should be connected to the Watching List, Wiki, or local library.
- Use Google or Google-style web search for anti-omission discovery when available, especially for niche people sourcing. If a dedicated Google surface is unavailable, use the available web search with Google operators (`"exact phrase"`, `site:`, `OR`, `-exclude`) and state the limitation. Treat search snippets as discovery leads only; verify important facts on primary pages.
- Use web search for current public facts, public profiles, news, funding, publications, GitHub/HuggingFace output, podcasts, talks, and adverse media.

## Step 2: Inspect the People Base

When the task involves Feishu Base, always inspect the current schema before writing. Do not assume exact field names.

1. Locate the Base/table named "1.1 People人际关系管理".
2. Read fields, field types, required fields, select options, linked-record fields, and existing views.
3. Search before creating: dedupe by name + current organization + canonical profile URL + email/open_id when available.
4. Prefer updating an existing person record over creating a duplicate.
5. If a useful field does not exist, place the information in an existing notes/summary field or ask before changing schema.
6. For bulk writes or uncertain merges, show the proposed changes and wait for confirmation. If the user explicitly asks to update a specific record and the match is unambiguous, proceed.

Common field concepts to map if present: name, current organization, role/title, location, sector tags, source, canonical profile URL, contact channel, relationship owner, relationship strength, mutual contacts, intro path, touchpoints, last interaction date, next follow-up date, status, background summary, risk flags, confidence, related project/company, and notes.

People Base field conventions for "1.1 People人际关系管理":

- `类型` is a single primary relationship/category label in business usage. Do not assign multiple type labels to one person, even if the API returns the field as accepting multiple values. If the CLI requires an array shape, pass exactly one option, e.g. `["大厂"]`.
- Put secondary context such as school, employer, previous company, role, and why the person matters into `所属组织&身份` or `情报`, not into extra `类型` options.
- When adding a new person, choose the one most retrieval-useful `类型` option. When the user corrects the type, replace the existing value rather than appending.

## Step 3: Discover Candidates

For founder sourcing, generate a target hypothesis first, then search broadly and rank tightly.

### Anti-Omission Discovery

When the user asks to find people in a niche research, company, lab, alumni, or technical domain, do not start only from person-name search. First build a small source graph, then derive candidates from it.

1. Seed entities: list likely labs, teams, programs, flagship projects, papers, GitHub/HuggingFace orgs, demo pages, conference pages, newsletters, and Chinese/English names for the same entities.
2. Project graph: open project pages and paper pages before ranking people. Extract authors, affiliations, equal contributors, project leads, dataset/infrastructure leads, and acknowledgements.
3. Alias graph: for each promising person, search Chinese name, English name, hyphenated/non-hyphenated spelling, initials, GitHub handle, email domain, Scholar profile, and homepage title.
4. Snowball graph: follow coauthors, lab member pages, GitHub org members, HuggingFace model/dataset uploaders, and repeated names across related papers.
5. Google pass: run a dedicated Google/Google-style pass after the source graph, using exact phrases and site operators to find adjacent clusters that project-first search misses.
6. Coverage check: before finalizing, state which source families were checked and which were unavailable. Include a short "possible misses" note if evidence is thin or the domain is fast-moving.

Use this pattern especially for AI research sourcing: strong candidates often appear on project pages, author contribution sections, GitHub/HuggingFace organizations, and lab news before their personal pages or media coverage mention the exact keywords.

### Google Anti-Omission Pass

For niche AI/technical sourcing, run Google/Google-style queries as a required second pass before finalizing. The goal is not to "prove" facts from Google snippets; it is to reveal branches that the first source graph missed.

Minimum query families:

- Exact entity cross: `"<company/team>" "<school/lab>" "<role>" "<domain>"`, e.g. `"ByteDance Seed" "Tsinghua" "Ph.D." "LLM"`.
- Project/source graph: `"<project name>" "<lab/team>" author`, `"<paper title>" "<company/team>"`, and project-domain terms such as `"DAPO" "Tsinghua AIR" "ByteDance Seed"`.
- Personal homepage sweep: `site:github.io "<company/team>" "<school/lab>" "<domain>"`, plus `site:*.github.io` variants when the search surface supports them.
- Role phrase sweep: `"I am a Research Scientist at <company/team>" "<school>"`, `"interned at <company/team>" "<school>"`, `"earned my Ph.D. from <school>" "<company/team>"`.
- Bilingual and alias sweep: Chinese/English institution names, team names, lab names, person name spellings, hyphenated/non-hyphenated names, and known handles.
- Scholar/publication sweep: candidate names plus `Google Scholar`, paper titles, advisor names, coauthor clusters, and affiliation phrases.
- Negative-space sweep: rerun searches without the dominant project terms and with exclusions for already-covered clusters, e.g. `"<company/team>" "<school>" "LLM" -DAPO -"CUDA Agent"`.

For high-value searches, scan enough results to see at least three consecutive result clusters without a new candidate branch, or explain why coverage is limited. Record the query families used in the coverage note.

Candidate sources:

- Internal: People Base, Watching List, Wiki docs, past meeting notes, portfolio founders, advisors, co-investors, event lists, and introductions.
- Public professional signals: company websites, LinkedIn, X/Twitter, GitHub, HuggingFace, Product Hunt, app stores, patents, papers, talks, podcasts, newsletters, communities, demo days, accelerators, funding databases, and reputable media.
- Momentum signals: new product launches, open-source velocity, hiring, fundraising, customer traction, technical benchmarks, community adoption, and repeated high-quality output.

Rank candidates using concise evidence, not generic prestige. Prefer observable founder-relevant signals:

- Domain depth: years in domain, hard-earned customer insight, research/technical contribution, operator experience.
- Builder signal: shipped products, repos, models, patents, papers, demos, revenue, users, or public customer proof.
- Founder readiness: recent career transition, side project momentum, team formation, fundraise hints, startup incorporation, public hiring.
- Network proximity: known mutuals, portfolio connection, prior interactions, shared institution/company, event overlap.
- Fit to thesis: direct alignment with the user's investment mandate and timing.

Before presenting a final candidate table, assign every candidate a status:

- `Included`: meets the brief with enough evidence.
- `Watchlist`: likely relevant but one key condition is unverified or adjacent.
- `Excluded`: found during search but does not meet the brief; give a terse reason if excluding a plausible candidate.

## Step 4: Build Profiles and Background Checks

For each person, separate facts from judgments:

1. Identity resolution: confirm this is the right person; list canonical links.
2. Career timeline: roles, organizations, dates, responsibilities, and gaps where material.
3. Founder/building history: companies, products, repos, publications, launches, customer proof, financing, exits, or failures.
4. Reputation and references: public endorsements, collaborators, investors, customers, public criticism, and people who could provide references.
5. Relationship graph: mutual contacts, likely warm intro paths, relationship owner, and confidence in each path.
6. Risk checks: adverse media, litigation/regulatory issues, resume inconsistencies, misleading claims, inactive projects, conflicts of interest, or reputation concerns. Keep language factual and cite sources.
7. Open questions: missing data that should be resolved by a call, reference, document, or direct ask.

Use a simple confidence label:

- `High`: multiple independent sources or strong internal confirmation.
- `Medium`: one reliable source plus weaker corroboration.
- `Low`: plausible but not yet independently verified.

## Step 5: Relationship Management

Keep relationship records action-oriented. A good record should answer: who owns the relationship, why this person matters, how to reach them, what happened last, and what should happen next.

Recommended relationship fields or notes:

- Relationship status: new lead, researched, intro requested, contacted, met, nurturing, active opportunity, not relevant, do not contact.
- Relationship strength: cold, weak tie, warm tie, strong tie, trusted relationship.
- Intro route: direct, relationship owner, mutual contact, event, portfolio founder, co-investor, advisor.
- Last touchpoint: date, channel, short factual summary.
- Next action: owner, due date, specific ask.
- Investment relevance: thesis tag, sector tag, stage fit, related company/project.
- Sensitivity: do not share, confidential, consent needed, stale contact, duplicate risk.

Do not store private or sensitive personal details just because they are easy to find. Store only what supports legitimate investment relationship management.

## Step 6: Output Formats

Use the format that matches the user's task.

For candidate discovery:

| Priority | Person | Current role/company | Fit thesis | Evidence | Source links | Intro path | Next action | Confidence |
|---|---|---|---|---|---|---|---|---|

For a person profile:

- One-line summary
- Why relevant now
- Verified facts
- Founder/building signals
- Relationship path
- Risks and open questions
- Suggested next step
- Sources

For a background-check memo:

- Executive view: proceed / proceed with questions / pause
- Verified timeline
- Track record evidence
- Reference map
- Risk flags
- Gaps to verify directly
- Sources and dates

For Base updates:

- Records found
- Duplicates or merge candidates
- Fields updated
- New records created
- Skipped/uncertain items
- Follow-up actions

## Quality Bar

- Verify current facts online when they may have changed: role, company, funding, product status, public controversy, and contactability.
- Cite sources and dates for important public claims.
- Include source links and recommendation priority in candidate discovery tables unless the user explicitly asks for a lighter format.
- Run an alias/source-graph coverage check for niche technical sourcing before finalizing; do not rely only on direct keyword search over names.
- Avoid over-weighting school/company prestige; explain why the person is relevant to the investment thesis.
- Distinguish public facts, internal relationship notes, and investment judgment.
- When writing to "1.1 People人际关系管理", optimize for future retrieval: consistent tags, canonical URLs, clear next actions, and no duplicate people.

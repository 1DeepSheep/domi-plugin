# Domi Plugin

Domi is an investment workflow plugin for Codex. It provides reusable skills for industry news, project and people research, meeting notes, investment review, IC materials, deal negotiation, local recording, and optional PLAUD transcription.

## Storage backends

The user chooses one backend during setup:

- **Local**: SQLite stores structured indexes; Markdown and attachments stay in a user-selected folder.
- **Feishu**: Base and Wiki identifiers are supplied by each user on their own Mac. No tenant, Base, table, field, Wiki, or user identifier is bundled with the plugin.

PLAUD is optional. If the user skips it, Domi does not start its worker, inspect browser state, or read a recording queue.

## Local configuration

Runtime configuration and data are outside this repository:

```text
~/Library/Application Support/豆米/
~/Documents/豆米/
~/.domi/
```

Do not commit any file copied from these locations. The plugin repository contains no user history, credentials, recordings, transcripts, project materials, or organization-specific storage mappings.

## Public release check

Before publishing:

```bash
node scripts/public-release-check.cjs
node scripts/public-release-check.cjs --history
```

Maintainers can put additional private identity terms in an ignored `.privacy-terms.local` file or the `DOMI_PRIVATE_IDENTITY_TERMS` environment variable. The file itself must never be committed.

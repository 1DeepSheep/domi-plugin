# Privacy boundary

The public domi plugin contains workflow logic, neutral taxonomy rules, writing guidance, tests, and public assets only.

It must not contain:

- personal names, emails, account identifiers, local usernames, or absolute home paths;
- Feishu tenant domains, user IDs, Base/Table/Field IDs, Wiki IDs, or access tokens;
- PLAUD cookies, browser profiles, recordings, transcripts, or workflow state;
- SQLite databases, user Markdown documents, attachments, logs, or diagnostics;
- API keys, signing material, GitHub tokens, Apple credentials, or private repository credentials.

User-selected storage paths and external service identifiers are read at runtime from the local client configuration. Local mode writes only to the selected library folder and the client’s Application Support database. Feishu mode never silently falls back to local storage after an authorization failure.

Every public root commit and release candidate must pass both the current-tree and full-history checks in `scripts/public-release-check.cjs`.

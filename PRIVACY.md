# Privacy boundary

The public domi plugin contains workflow logic, neutral taxonomy rules, writing guidance, tests, and public assets only.

It must not contain:

- personal names, emails, account identifiers, local usernames, or absolute home paths;
- Feishu tenant domains, user IDs, Base/Table/Field IDs, Wiki IDs, or access tokens;
- PLAUD cookies, browser profiles, recordings, transcripts, or workflow state;
- SQLite databases, user Markdown documents, attachments, logs, or diagnostics;
- API keys, signing material, GitHub tokens, Apple credentials, or private repository credentials.

This includes the configured `1.待办事项` document locator, Outlook email/account hint, common calendar attendees, Base and table identifiers, Wiki mappings, and local filesystem paths.

User-selected storage paths and external service identifiers are read at runtime from `DOMI_CONFIG_PATH` in the local client configuration. Outlook OAuth is owned by the Outlook Calendar connector and is never stored by this plugin. Local mode writes only to the selected library folder and the client’s Application Support database. Feishu mode never silently falls back to local storage after an authorization failure.

Every public root commit and release candidate must pass both the current-tree and full-history checks in `scripts/public-release-check.cjs`.

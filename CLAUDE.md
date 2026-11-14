# Notes for Claude sessions working on this repo

- When a PR ships a feature, append an entry to `content/build-log.json` in the same PR
  (where it lives, how it works, a tiny demo). If the work moves one of the admin's assignments
  forward, add `status_updates` to that entry (current UTC time in `at`; `doing` unless the
  admin's own deliverable is submitted). See `docs/god-mode.md`. Run `pytest` in `backend/`.
- Never put the admin's email, API keys or connection strings in code, content or docs.
- Work in ponytail mode every turn (smallest complete change; rules: https://github.com/DietrichGebert/ponytail/blob/main/AGENTS.md).
  `.claude/settings.json` enables the ponytail plugin; if it didn't load, follow those rules anyway.

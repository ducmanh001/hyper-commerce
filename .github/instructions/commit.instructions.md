---
applyTo: '**'
---

## Commit Message Rules (enforced by commitlint)

Full guide: `.github/COMMIT_CONVENTION.md`

**Quick rules — check BEFORE writing any commit:**

- Subject: `type(scope): subject` — max **72 chars**, min 10 chars
- Aim for **50 chars** (readable in `git log --oneline`)
- Imperative mood: `add`, `fix`, `remove` — not `added`, `fixing`
- No capital after colon, no trailing period
- Types: `feat` `fix` `docs` `chore` `refactor` `perf` `test` `style` `ci` `revert`
- Body lines wrap at **72 chars**
- Breaking change: `feat(scope)!:` + `BREAKING CHANGE:` footer

**Avoid vague verbs:** `update X` → `add X` / `fix X` / `remove X` / `replace X`

# Commit Message Convention

> Based on [Conventional Commits 1.0](https://www.conventionalcommits.org/)
> Enforced by: `@commitlint/config-conventional` via husky `commit-msg` hook

---

## Format

```
<type>(<scope>): <subject>          ← subject line: max 72 chars
                                    ← blank line (required if body exists)
<body>                              ← optional, 72 chars/line
                                    ← blank line (required if footer exists)
<footer>                            ← optional: BREAKING CHANGE, Closes #
```

---

## Subject Line Rules

| Rule           | Constraint            | Example                                                    |
| -------------- | --------------------- | ---------------------------------------------------------- |
| **Max length** | **72 characters**     | `feat(order): add idempotency key to POST /orders` ← 51 ✅ |
| **Min length** | **10 characters**     | `fix: crash` ← too short ❌                                |
| **Aim for**    | **50 characters**     | Sweet spot — readable in `git log --oneline`               |
| **Case**       | lowercase after colon | `feat: add X` ✅ not `feat: Add X` ❌                      |
| **Tense**      | imperative            | `add`, `fix`, `remove` ✅ not `added`, `fixing` ❌         |
| **Period**     | no trailing period    | `feat: add search` ✅ not `feat: add search.` ❌           |

---

## Types

| Type       | When to use                                        | Breaking? |
| ---------- | -------------------------------------------------- | --------- |
| `feat`     | New feature, new endpoint, new service             | Can be    |
| `fix`      | Bug fix, incorrect behavior corrected              | Can be    |
| `docs`     | Docs only: README, spec files, comments, SCHEMA.md | Never     |
| `chore`    | Tooling, deps, config, CI, non-code changes        | Never     |
| `refactor` | Code change — no feature added, no bug fixed       | Can be    |
| `perf`     | Performance improvement                            | Can be    |
| `test`     | Add/update tests only                              | Never     |
| `style`    | Formatting, whitespace, lint — zero logic change   | Never     |
| `ci`       | CI/CD config changes (.github/workflows)           | Never     |
| `revert`   | Revert a previous commit                           | —         |

---

## Scopes (this project)

Use service/domain name as scope:

```
feat(order):        feat(payment):      feat(inventory):    feat(feed):
feat(live):         feat(wallet):       feat(search):       feat(ai):
feat(notification): feat(subscription): feat(review):       feat(ads):
feat(user):         feat(chat):         feat(admin):        feat(web):

chore(config):      chore(deps):        chore(ci):          chore(ai-workflow):
docs(specs):        docs(schema):       docs(events):       refactor(db):
```

Scope là **optional** nhưng strongly recommended. Bỏ qua khi change ảnh hưởng toàn project.

---

## Body Rules

- Cách subject 1 dòng trắng
- **72 ký tự/dòng** — wrap thủ công
- Giải thích **WHY**, không phải HOW (code đã nói HOW rồi)
- Bullet points OK: bắt đầu bằng `-`

---

## Footer Rules

```
BREAKING CHANGE: mô tả breaking change
Closes #123
Refs #456
```

---

## Examples

### ✅ Good

```
feat(order): add idempotency key to POST /orders

Prevents duplicate order creation when client retries on network timeout.
Uses Redis key order:idem:{key} TTL=24h — checked before creating order.

Closes #234
```

```
fix(wallet): prevent double debit on concurrent requests

SELECT FOR UPDATE was missing in debit(). Two concurrent requests could
both read balance=1000 and both debit 500, resulting in -0 balance.
```

```
chore(deps): upgrade TypeORM to 0.3.20

Fixes CVE-2024-12345 (SQL injection via query builder).
No API changes — compatible upgrade.
```

```
docs(specs): add flash-sale-engine spec (L4)
```

### ❌ Bad

```
fix: fixed the bug                   ← not imperative + too vague
Update stuff                         ← no type, no scope, too vague
feat(order): Add Order Idempotency Key To Prevent Duplicate Submissions   ← 75 chars, capitalized
feat: wip                            ← too short, no scope
chore: update core config for wallet-service + AI workflow routing        ← 74 chars ❌
```

---

## Breaking Changes

Hai cách khai báo breaking change:

```
feat(payment)!: replace ZaloPay with Stripe

BREAKING CHANGE: /webhooks/zalopay removed. Use /webhooks/stripe instead.
Refs migration guide: docs/payment-migration.md
```

---

## Revert

```
revert: feat(order): add idempotency key to POST /orders

Reverts commit abc1234.
Reason: caused timeout under high load — needs redis connection pooling first.
```

---

## Quick Reference Card (paste into IDE)

```
type(scope): subject ← max 72 chars, lowercase, imperative, no period

Types: feat fix docs chore refactor perf test style ci revert
Scopes: order payment wallet search feed live user ai web admin

Body: blank line + 72 chars/line + explain WHY
Footer: BREAKING CHANGE: ... | Closes #N
```

---

## AI Agent Rules (LCB v3)

When Copilot generates a commit message, it MUST:

1. Subject ≤ 72 characters — count before writing
2. Use one of the types above — no freestyle types
3. Use project scope from the scope list above
4. Imperative mood — `add` not `added`
5. No trailing period
6. If breaking change → use `!` suffix and `BREAKING CHANGE:` footer
7. Body lines wrap at 72 characters
8. Never use `update`, `change`, `modify` as the main verb — be specific: `add`, `fix`, `remove`, `replace`, `rename`, `wire`, `extract`, `migrate`

**Avoid these vague subjects:**

- `update X` → say what changed: `add X`, `fix X`, `remove X`
- `changes to X` → say what changed
- `WIP` → never commit WIP to main
- `fix: fixed` → imperative: `fix: resolve`

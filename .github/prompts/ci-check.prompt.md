---
description: 'Tham khảo: CI checks chạy hoàn toàn tự động, không cần agent'
---

# CI Checks — Chạy Local Không Cần Agent

> Agent không cần làm những việc này. Dùng tool local bên dưới.

## Cách chạy

### 1. Một lệnh — full CI gate

```bash
npm run ci:local
```

Chạy tuần tự: lint → type-check → format → audit. Exit 0 = pass.

### 2. Từng bước riêng lẻ

```bash
npm run lint:check       # ESLint — 0 errors mới pass
npm run format:check     # Prettier — all files clean mới pass
npm run type-check       # tsc --noEmit
npm run test             # Jest
npm audit --audit-level=critical --omit=dev
```

### 3. Auto-fix (không cần gõ tay)

```bash
npm run lint             # ESLint --fix
npm run format           # Prettier --write
```

## Tự động hóa đã cài sẵn (zero agent)

| Khi nào          | Tự động làm gì                     | Cấu hình                |
| ---------------- | ---------------------------------- | ----------------------- |
| **Ctrl+S**       | ESLint fix + Prettier format       | `.vscode/settings.json` |
| **`git commit`** | lint-staged: fix staged files only | `.husky/pre-commit`     |
| **`git push`**   | lint + type-check — block nếu lỗi  | `.husky/pre-push`       |
| **Ctrl+Shift+B** | `npm run ci:local`                 | `.vscode/tasks.json`    |
| **GitHub push**  | Full CI pipeline                   | `.github/workflows/`    |

## Agent chỉ được gọi khi

- Sinh code mới (`/add-feature`, `/refactor`)
- Debug lỗi phức tạp cần reasoning
- Không bao giờ gọi agent để chạy lint/format/tsc

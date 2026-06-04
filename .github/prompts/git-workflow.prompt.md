---
description: 'Tham khảo: Git workflow dùng VS Code UI hoặc terminal — không cần agent'
---

# Git Workflow — Không Cần Agent

> Dùng VS Code Source Control (Ctrl+Shift+G) hoặc terminal. Agent không cần tham gia.

## Terminal commands

```bash
# Stage + commit
git add -A
git commit -m "feat(scope): message"   # Husky tự chạy lint+type-check trước khi commit

# Push (Husky tự chạy lint+type-check trước khi push)
git push origin main

# Tạo branch mới
git checkout -b feat/my-feature

# Xem status / diff
git status
git diff --staged
```

## VS Code UI (zero terminal)

| Thao tác            | Shortcut                              |
| ------------------- | ------------------------------------- |
| Open Source Control | `Ctrl+Shift+G`                        |
| Stage all changes   | Click `+` trên Changes                |
| Commit              | Nhập message → `Ctrl+Enter`           |
| Push                | Click `⋯` → Push                      |
| Create branch       | Click branch name ở status bar        |
| View diff           | Click file trong Source Control panel |

## Husky tự động (không cần nhớ)

```
git commit → lint-staged chạy ESLint fix + Prettier trên staged files
git push   → lint:check + type-check — block nếu có lỗi
```

Nếu push bị block: sửa lỗi → `git add -A` → `git commit` → `git push`.

## Agent chỉ được gọi khi

- Viết commit message theo conventional commits từ diff phức tạp
- Resolve merge conflict cần reasoning
- Không bao giờ gọi agent cho `git status`, `git commit`, `git push`

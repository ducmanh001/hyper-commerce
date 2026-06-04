---
applyTo: .github/prompts/**
---

## Prompt Fragments — Auto-resolution Rule (LCB v3 L7)

When a prompt contains `+tag` tokens, resolve each by reading the corresponding fragment file **before** implementing. Fragments inherit into the prompt as if they were typed inline.

| Tag          | File                                      | Auto-include when                                          |
| ------------ | ----------------------------------------- | ---------------------------------------------------------- |
| `+base`      | `.github/prompts/fragments/+base.md`      | Always (every L2+ prompt)                                  |
| `+kafka`     | `.github/prompts/fragments/+kafka.md`     | Prompt mentions Kafka / event / consumer / producer        |
| `+redis`     | `.github/prompts/fragments/+redis.md`     | Prompt mentions Redis / cache / TTL / lock                 |
| `+tx`        | `.github/prompts/fragments/+tx.md`        | Prompt mentions transaction / debit / credit / multi-table |
| `+migration` | `.github/prompts/fragments/+migration.md` | Prompt mentions new table / migration / entity             |
| `+wrap`      | `.github/prompts/fragments/+wrap.md`      | Always when invoking a spec file (`#file:*.spec.md`)       |
| `+verify-L2` | `.github/prompts/fragments/+verify-L2.md` | Level 2 prompt                                             |
| `+verify-L3` | `.github/prompts/fragments/+verify-L3.md` | Level 3 prompt                                             |
| `+verify-L4` | `.github/prompts/fragments/+verify-L4.md` | Level 4 prompt                                             |

**Auto-include rule**: Even if `+tag` is not written explicitly, auto-include fragments whose "when" condition matches the prompt. Never ask — silently resolve.

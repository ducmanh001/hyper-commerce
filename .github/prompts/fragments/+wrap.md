Output wrapping — the IMPLEMENTING agent prints header BEFORE code and scorecard AFTER all code.
No separate review agent needed for L1–L3.
For L4 payment/auth/fraud only: optionally re-invoke with "review only" after self-report passes.

HEADER (before any code):

```
## 🔧 Implementation — {feature from spec}
Spec: .github/specs/{filename}.spec.md
Agent: @{domain}  |  Level: L{N}  |  Date: {today}

Reading:
- [ ] {file 1}
- [ ] {file 2}

Will touch: {list of files to create/modify}
New artifacts: {entities / events / migrations}
Fragments resolved: {+base +kafka ...}
```

FOOTER (after all code — run tsc first, then fill):

```
## ✅ Scorecard — {feature}
| Gate               | Result  | Score |
|--------------------|---------|-------|
| G0 Compile+Lint    | PASS/FAIL | —   |
| G1 Completeness    | {notes} | /4   |
| G2 Security        | {notes} | /3   |
| G3 Architecture    | {notes} | /4   |
| G4 Runtime Safety  | {notes} | /3   | ← L3+
| G5 Event Integrity | {notes} | /3   | ← L3+ skip if no Kafka
| G6 Observability   | {notes} | /3   | ← L4 only
Total: {X}/{max}  |  Threshold: {threshold}  |  Status: PASS ✅ / NEEDS FIX ❌

Missed: {gate} — {what} → fix: {one-line action}
```

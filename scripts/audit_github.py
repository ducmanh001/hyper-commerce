#!/usr/bin/env python3
import os, re

BASE = "/home/pham.van.manhb@sun-asterisk.com/work-space/hypercommerce"

def read(path):
    return open(os.path.join(BASE, path)).read()

def count_blocks(content):
    return len(re.findall(r"^```", content, re.MULTILINE)) // 2

def tokens(content):
    return len(content) // 4

print("=" * 65)
print("AGENT FILES — sorted by token cost")
print("=" * 65)
agents = sorted(os.listdir(os.path.join(BASE, ".github/agents")))
for fname in agents:
    if not fname.endswith(".md"):
        continue
    c = read(f".github/agents/{fname}")
    t = tokens(c)
    b = count_blocks(c)
    m = re.search(r'applyTo: "(.*?)"', c)
    ap = "MANUAL-LOAD" if not m else m.group(1)[:55]
    print(f"  {t:4d}t | {b:2d} code-blocks | {fname:<30} | {ap}")

print()
print("=" * 65)
print("INSTRUCTION FILES — applyTo scope check")
print("=" * 65)
insts = sorted(os.listdir(os.path.join(BASE, ".github/instructions")))
for fname in insts:
    if not fname.endswith(".md"):
        continue
    c = read(f".github/instructions/{fname}")
    t = tokens(c)
    b = count_blocks(c)
    m = re.search(r'applyTo: "(.*?)"', c)
    ap = m.group(1) if m else "NO applyTo!"
    print(f"  {t:4d}t | {b:2d} blocks | {fname:<38} | {ap}")

print()
print("=" * 65)
print("COVERAGE — apps/* paths vs agent applyTo")
print("=" * 65)
covered_patterns = []
for fname in os.listdir(os.path.join(BASE, ".github/agents")):
    if not fname.endswith(".md"):
        continue
    c = read(f".github/agents/{fname}")
    m = re.search(r'applyTo: "(.*?)"', c)
    if m:
        for p in m.group(1).split(","):
            covered_patterns.append((p.strip(), fname))

apps_dirs = sorted(d for d in os.listdir(os.path.join(BASE, "apps"))
                   if os.path.isdir(os.path.join(BASE, "apps", d)))

for app in apps_dirs:
    matched = []
    for pattern, agent in covered_patterns:
        # simple check: does pattern mention this app?
        if app in pattern or "*-service" in pattern or "web" in pattern:
            if app == "web" and "web" in pattern:
                matched.append(agent)
            elif app != "web" and ("*-service" in pattern or app in pattern):
                matched.append(agent)
    status = "✅" if matched else "❌ NOT COVERED"
    agent_name = matched[0] if matched else "NONE"
    print(f"  {status} apps/{app:<22} → {agent_name}")

print()
print("=" * 65)
print("TOKEN BUDGET PER SCENARIO")
print("=" * 65)

scenarios = {
    "Edit apps/web/src/app/page.tsx": [
        ("copilot-instructions.md", ".github/copilot-instructions.md"),
        ("frontend.agent.md", ".github/agents/frontend.agent.md"),
        ("nextjs.instructions.md", ".github/instructions/nextjs.instructions.md"),
    ],
    "Edit apps/order-service/src/order.service.ts": [
        ("copilot-instructions.md", ".github/copilot-instructions.md"),
        ("commerce.agent.md", ".github/agents/commerce.agent.md"),
        ("nestjs.instructions.md", ".github/instructions/nestjs.instructions.md"),
        ("security.instructions.md", ".github/instructions/security.instructions.md"),
    ],
    "Edit libs/kafka/src/kafka.service.ts": [
        ("copilot-instructions.md", ".github/copilot-instructions.md"),
        ("backend.agent.md", ".github/agents/backend.agent.md"),
        ("nestjs.instructions.md", ".github/instructions/nestjs.instructions.md"),
        ("security.instructions.md", ".github/instructions/security.instructions.md"),
    ],
    "Edit apps/ai-service/src/recommendation/": [
        ("copilot-instructions.md", ".github/copilot-instructions.md"),
        ("ai-ml.agent.md", ".github/agents/ai-ml.agent.md"),
        ("nestjs.instructions.md", ".github/instructions/nestjs.instructions.md"),
        ("security.instructions.md", ".github/instructions/security.instructions.md"),
    ],
    "Edit infrastructure/postgres/migrations/": [
        ("copilot-instructions.md", ".github/copilot-instructions.md"),
        ("infra.agent.md", ".github/agents/infra.agent.md"),
        ("database.instructions.md", ".github/instructions/database.instructions.md"),
    ],
}

for scenario, files in scenarios.items():
    total = 0
    print(f"\n  Scenario: {scenario}")
    for label, path in files:
        c = read(path)
        t = tokens(c)
        total += t
        print(f"    {t:4d}t  {label}")
    print(f"    {'─'*30}")
    print(f"    {total:4d}t  TOTAL auto-loaded")

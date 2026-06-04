---
description: Audit codebase for hardcoded data, security issues, over-engineered features, dead code, and incomplete implementations. Run periodically before major releases.
---

You are a senior architect auditing the HyperCommerce codebase.

**Mode: Codebase Audit**

Systematically check the following categories and report findings with severity.

---

## Category 1 — Security vulnerabilities

```bash
# Find insecure random usage
grep -rn "Math.random()" apps/ libs/ --include="*.ts" | grep -v "node_modules\|spec\."

# Find hardcoded secrets
grep -rn "password\|secret\|api_key\|apikey" apps/ --include="*.ts" | grep "=\s*['\"]" | grep -v ".env\|process.env\|node_modules"

# Find raw SQL string interpolation
grep -rn "query(\`\|query(\"" apps/ --include="*.ts" | grep -v "node_modules\|spec\."
```

Report as: **[SECURITY-CRITICAL]** (must fix before deploy) or **[SECURITY-HIGH]**

## Category 2 — Mock / hardcoded data in production paths

```bash
# Find mock data imports
grep -rn "mock-data\|MOCK_\|Math.random().*price\|Math.random().*count" apps/web/src --include="*.ts" --include="*.tsx"

# Find hardcoded business values
grep -rn "hardcode\|TODO.*fetch\|placeholder" apps/ --include="*.ts" | grep -v "node_modules"
```

Report as: **[MOCK-DATA]** with the real API endpoint it should call instead

## Category 3 — Dead code / unused infrastructure

```bash
# Libs imported nowhere
for lib in bloom-filter consistent-hashing hyperloglog min-hash-lsh trie; do
  echo "=== $lib ===" && grep -rn "$lib" apps/ --include="*.ts" | grep "import" | grep -v "node_modules" | head -3
done

# gRPC: controllers without Transport.GRPC bootstrap
grep -rn "@GrpcMethod" apps/ --include="*.ts" | grep -v "node_modules" | wc -l
grep -rn "Transport.GRPC\|createMicroservice" apps/ --include="*.ts" | grep -v "node_modules"
```

Report as: **[DEAD-CODE]** or **[INFRA-UNUSED]**

## Category 4 — Incomplete implementations

```bash
# Stub returns
grep -rn "return \[\]\|return null\|throw new Error.*not.*implement" apps/ --include="*.ts" | grep -v "node_modules\|spec\.\|// valid"

# TODO/FIXME markers
grep -rn "TODO\|FIXME\|HACK" apps/ libs/ --include="*.ts" | grep -v "node_modules"
```

Report as: **[INCOMPLETE]** with what the real implementation needs

## Category 5 — Over-engineered for current scale

Ask:

- Is this feature triggering with real traffic or only in edge cases?
- Does the complexity match the current user count / order volume?
- Can this be simplified without losing correctness?

Report as: **[OVER-ENGINEERED]** with simpler alternative

---

## Output format

```
[SECURITY-CRITICAL] apps/notification-service/src/channels/sms.channel.ts:109
  Math.random() used for OTP → replace with crypto.randomInt(100_000, 1_000_000)

[MOCK-DATA] apps/web/src/lib/api-client.ts:76
  searchProducts() falls back to MOCK_PRODUCTS → should throw and let UI show error state

[DEAD-CODE] apps/search-service/src/grpc/search.grpc.controller.ts
  @GrpcMethod decorators defined but Transport.GRPC never registered in main.ts
```

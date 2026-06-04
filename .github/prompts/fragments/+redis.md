Redis rules (apply when reading/writing Redis):

- Every redis.set() MUST have TTL — no unbounded keys
- Key names MUST match patterns in infrastructure/postgres/SCHEMA.md Redis section
- Atomic counter ops: Lua script via RedisClientService — never two separate calls
- No SCAN or KEYS \* in hot path — O(N) blocks Redis
- Idempotency lock pattern: SET key 1 EX 10 NX — check return before proceeding

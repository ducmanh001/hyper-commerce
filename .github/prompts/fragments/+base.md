Constraints (always apply — do not repeat in prompt):

- All VND values: BIGINT integer dong — never float/decimal
- Secrets + URLs: process.env only — never hardcode
- Input validation: class-validator decorators at DTO boundary
- Output: TypeScript only, no prose explanation, no comments on unchanged code
- Soft delete: use deletedAt (BaseEntity) — never hard DELETE
- Admin service: bind 127.0.0.1 only, never 0.0.0.0

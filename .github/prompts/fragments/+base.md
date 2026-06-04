## Session Protocol (chạy mọi task, không bỏ qua)

### Đầu task

1. Nếu là continuation → đọc `/memories/session/{task}.md` trước
2. Đọc `.github/PATTERNS.md` — kiểm tra anti-pattern liên quan đến task này
3. Xác định task type → map vào Context Recipe (xem copilot-instructions.md)
   - Nếu không map được rõ ràng → STOP, chuyển qua Discovery Agent, không implement thẳng
4. Chọn đúng +fragment theo task type trước khi viết bất kỳ dòng code nào

### Cuối task

1. Tự chạy verify fragment tương ứng complexity:
   - L2 (simple/single file) → +verify-L2
   - L3 (cross-module/multi-file) → +verify-L3
   - L4 (full feature/saga) → +verify-L4
2. Nếu fix recurring bug hoặc phát hiện anti-pattern → thêm vào `.github/PATTERNS.md` ngay, không để sau
3. Nếu task chưa xong → ghi state vào `/memories/session/{task}.md`

---

Constraints (always apply — do not repeat in prompt):

- All VND values: BIGINT integer dong — never float/decimal
- Secrets + URLs: process.env only — never hardcode
- Input validation: class-validator decorators at DTO boundary
- Output: TypeScript only, no prose explanation, no comments on unchanged code
- Soft delete: use deletedAt (BaseEntity) — never hard DELETE
- Admin service: bind 127.0.0.1 only, never 0.0.0.0

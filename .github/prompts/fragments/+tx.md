DB transaction rules (apply when writing to multiple tables):

- Use QueryRunner for all multi-table writes — never two separate repo.save() calls
- Pattern: connect → startTransaction → save entities → commitTransaction
- Always rollback in catch, always release in finally
- SELECT ... FOR UPDATE before any balance/stock debit (prevent race condition)

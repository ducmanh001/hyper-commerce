Migration rules (apply when adding new DB tables or columns):

- Read infrastructure/postgres/SCHEMA.md for the next migration number FIRST
- File: infrastructure/postgres/migrations/{N}\_{description}.sql
- Include -- ROLLBACK: DROP TABLE ... at bottom of file
- Create indexes for: all foreign keys + columns used in WHERE clauses
- Update SCHEMA.md table map after creating the entity
- Run: make context:index to refresh SCHEMA.md automatically

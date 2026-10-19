# task-api

A tiny in-memory REST API for managing tasks. Powers the internal dashboard prototype.

## Routes

- `GET /api/tasks?page=2&perPage=3` — paginated task list
- `GET /api/tasks/:id` — single task

## Development

```bash
bun test        # run the test suite
bun run start   # serve on http://localhost:8080
```

Tasks are seeded from `src/store.ts`. No external dependencies.

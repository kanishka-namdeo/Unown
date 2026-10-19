# AGENTS.md — task-api

A tiny in-memory REST API (no external dependencies, runs on Bun).

## Commands

- Run tests: `bun test` (bun:test, files in `test/`)
- Start server: `bun run start` (serves on :8080)

## Layout

- `src/server.ts` — HTTP router (node:http)
- `src/store.ts` — seeded in-memory task store
- `src/pagination.ts` — shared pagination helper

## Conventions

- TypeScript strict style, no default exports
- Every endpoint has a test in `test/`; keep pagination behavior in sync with `paginate()`
- Do not add dependencies without asking

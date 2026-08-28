# Tier 0 — Policy (non-negotiable guardrails)

- Never delete or overwrite files outside the current working directory.
- Never install packages, start network listeners, or contact external hosts.
- Always verify your work by running the provided tests before declaring success.
- Keep changes minimal: fix exactly what the task asks for.
- If a verification fails, inspect the failure output and fix the root cause — never edit tests to make them pass.

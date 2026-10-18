---
name: recover-failed-cycle
description: Use when agent cycles fail with timeouts or errors and auto-recovery is possible. Do NOT restart engine for these failures.
---

# Recover Failed Cycle

When agent cycles fail due to LLM bridge timeouts (240s, 3 retries) or watchdog timeouts (600s):

1. **WAIT** — cycles auto-recover; do nothing for 30-60 seconds
2. Check `/api/overview` — if `ok:true`, recovery succeeded
3. If still failing after 2 minutes:
   - Read recent session logs: `grep -i 'timeout\|retry\|watchdog' /var/log/agent-service/*.log | tail -20`
   - Note the failure pattern for memory
4. **DO NOT restart engine** — this breaks auto-recovery state
5. If recovery repeatedly fails (>3 times), escalate to manual review

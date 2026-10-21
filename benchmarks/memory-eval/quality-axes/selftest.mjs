#!/usr/bin/env bun
/**
 * quality-axes/selftest.mjs — NO-LLM deterministic self-test of the runner's
 * line classifiers (the scoring logic the whole suite rests on). Pins the
 * expected classification of representative dream-output phrasings so the
 * regex semantics can't drift silently. Run: bun selftest.mjs (exit 0 = all
 * expectations hold). This file never touches the bridge.
 */
import { classifyPair, classifyRevoked, SUPERSEDED_RE, WINNER_KILLER_RE } from "./runner.mjs";

let failed = 0;
function check(name, got, want) {
        const ok = JSON.stringify(got) === JSON.stringify(want);
        if (!ok) {
                failed++;
                console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
        } else {
                console.log(`ok   ${name}`);
        }
}
function counts(result) {
        return { loserCurrentCount: result.loserCurrentCount, winnerCurrentCount: result.winnerCurrentCount };
}

// --- contradiction: alphabet (loser) vs type-grouping (winner) ---
const L_ALPHA = /alphabet\w*/i;
const W_GROUP = /group\w*(?:\s+(?:by\s+)?type|\s+imports?)|type[- ]group\w*|imports?\s+group\w*/i;
const pair = (text) => counts(classifyPair(text, L_ALPHA, W_GROUP, SUPERSEDED_RE, WINNER_KILLER_RE));

check(
        "good: winner current, loser transition-marked",
        pair(`# Tier 1 — Project Memory\n## Workflow\n- Import statements are grouped by type: node builtins, external packages, internal aliases, then relative [note 7].\n## Known pitfalls\n- The alphabetical import sort was replaced by type grouping [note 7].\n`),
        { loserCurrentCount: 0, winnerCurrentCount: 2 },
);
check(
        "bad: both stated as current",
        pair(`- Imports are sorted alphabetically within each file [note 2].\n- Imports are grouped by type [note 7].\n`),
        { loserCurrentCount: 1, winnerCurrentCount: 1 },
);
check("bad: stale old rule only", pair("- Import order is enforced alphabetically [note 6].\n"), { loserCurrentCount: 1, winnerCurrentCount: 0 });
check("good: nothing relevant", pair("- Prefer standard library functions [note 2].\n"), { loserCurrentCount: 0, winnerCurrentCount: 0 });
check(
        "transition: 'changed from alphabetical to grouping by type' keeps only the winner",
        pair("- Import order changed from alphabetical to grouping by type in S07 [note 7].\n"),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);

// --- staleness: zod 3 (loser) vs zod 4 (winner) ---
const L_ZOD3 = /zod\s*(?:v\.?\s*)?3\b|zod@3/i;
const W_ZOD4 = /zod\s*(?:v\.?\s*)?4\b|zod@4/i;
const zpair = (text) => counts(classifyPair(text, L_ZOD3, W_ZOD4, SUPERSEDED_RE, WINNER_KILLER_RE));
check("good: zod 4 current + migration line", zpair("- Validation uses zod 4 with z.strictObject() [note 6].\n- Upgraded from zod 3 to zod 4 in S06 [note 6].\n"), {
        loserCurrentCount: 0,
        winnerCurrentCount: 2,
});
check("bad: stale zod 3 bullet", zpair("- Invoice schemas use zod 3 with .strict() [note 3].\n"), { loserCurrentCount: 1, winnerCurrentCount: 0 });
check("good: historical zod 3 (past tense)", zpair("- zod 3 was the validation library before the S06 upgrade [note 6].\n"), {
        loserCurrentCount: 0,
        winnerCurrentCount: 0,
});
check(
        "good: imperative migration framing 'Replace zod 3 .strict() with z.strictObject() in zod 4' (live-run phrasing)",
        zpair("- Replace zod 3 .strict() with z.strictObject() in zod 4 [note qa-s06].\n"),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
check("good: 'Upgrade zod 3 to zod 4' migration line", zpair("- Upgrade zod 3 to zod 4 in S06; error utilities renamed [note 6].\n"), {
        loserCurrentCount: 0,
        winnerCurrentCount: 1,
});

// --- forgetting: axios (revoked) vs fetch (replacement) ---
const R_AXIOS = /axios/i;
const W_FETCH = /fetch/i;
const rev = (text) => classifyRevoked(text, R_AXIOS, W_FETCH);
check("good: revocation stated, fetch current", rev("- Outbound HTTP uses plain fetch only; axios is forbidden [note 10].\n").revokedCurrentCount, 0);
check("good: axios historical", rev("- The axios experiment was reverted; fetch is the standing choice [note 12].\n").revokedCurrentCount, 0);
check("bad: approval stated as current", rev("- The team approved axios for outbound HTTP calls [note 2].\n").revokedCurrentCount, 1);
check("bad: stale axios usage", rev("- axios retries are logged through winston at warn level [note 5].\n").revokedCurrentCount, 1);
check("good: 'fetch replaced axios' is exempt", rev("- BillingClient: fetch replaced axios after the security review [note 10].\n").revokedCurrentCount, 0);
// 2026-10-22 pins — the live agnes-3.0-flash forgetting failure (results/agnes-3.0-flash/forgetting.json,
// 2026-10-21): the dream's only counted violation was "parity with old axios client" — a
// migration-outcome comparison (historical), not a current-rule statement. D5 (old-attribute)
// must exempt it; the classifier gap, not the dream, was the failure.
check(
        "good (2026-10-21 live line): 'parity with old axios client' is a historical comparison (D5)",
        rev(
                "- BillingClient uses a hand-rolled retry wrapper on fetch; integration suite verified parity with old axios client [note 10].\n",
        ).revokedCurrentCount,
        0,
);
check(
        "good: 'the old axios client' attribute framing is exempt (D5)",
        rev("- Migration finished: the old axios client is gone from src/http. [note 11].\n").revokedCurrentCount,
        0,
);
check(
        "good (D1 present-tense): 'axios is no longer used' is exempt",
        rev("- Outbound HTTP: axios is no longer used after the security review [note 10].\n").revokedCurrentCount,
        0,
);
check(
        "bad (negative pin): 'axios is the standing choice' still counts as current",
        rev("- The axios client is the standing choice for outbound HTTP [note 4].\n").revokedCurrentCount,
        1,
);
check(
        "good (D6 negation): 'never axios' explicit rejection is exempt",
        rev("- Outbound HTTP uses plain fetch; never axios for cardholder data [note 10].\n").revokedCurrentCount,
        0,
);

// --- interference: pino vs winston (symmetric, narrow killer) ---
const A_WINSTON = /winston/i;
const B_PINO = /pino/i;
const ipair = (text) => counts(classifyPair(text, A_WINSTON, B_PINO, WINNER_KILLER_RE, WINNER_KILLER_RE));
check(
        "good: pino current, winston removed (must not flip on the '; winston was removed' clause)",
        ipair("- Logging uses pino; winston was removed after two data-loss incidents [note 15].\n"),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
check(
        "bad: both current",
        ipair("- Structured logging uses pino [note 4].\n- The winston-based logger is the current setup [note 9].\n"),
        { loserCurrentCount: 1, winnerCurrentCount: 1 },
);
check("good: reversed direction marks the winner as replaced", ipair("- pino was replaced by winston again [note 9].\n"), {
        loserCurrentCount: 1,
        winnerCurrentCount: 0,
});
check(
        "good: 'removed pino and adopted winston' direction (pino losing, winston current)",
        ipair("- S05 removed pino and adopted winston for dashboard parity [note 5].\n"),
        { loserCurrentCount: 1, winnerCurrentCount: 0 },
);
check(
        "good: pitfall framing 'winston dropped lines under load' is NOT a winston current-statement (live-run line, run 1)",
        ipair(
                "- Pino for logging: passed 10-minute soak test with zero log loss; winston dropped lines under load [note 6, note 2026-10-11T09:19:00.000Z].\n",
        ),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
check(
        "good: 'winston's async transport dropped log lines' pitfall (single-match)",
        ipair("- winston's async transport dropped log lines under load [note 10].\n"),
        { loserCurrentCount: 0, winnerCurrentCount: 0 },
);
check(
        "good: 'pino ... zero log loss' must NOT flip pino to failing (no bare 'loss' verb)",
        ipair("- Pino for logging: passed the soak test with zero log loss [note 15].\n"),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
// 2026-10-22 pins — the live agnes-3.0-flash interference failure (results/agnes-3.0-flash/
// interference.json, 2026-10-21): the dream resolved to pino and marked winston
// "is permanently retired" — present-tense passive, invisible to the old was/were-only
// D1, so both rules counted as current. D1's new present-tense + adverb slot must read it
// as a transition line; the classifier gap, not the dream, was the failure.
check(
        "good (2026-10-21 live line): 'winston is permanently retired' is a transition (D1 present-tense passive)",
        ipair(
                "- Use pino for structured logging in all modules; winston is permanently retired due to data-loss issues under load [note 5, 10, 11, 12].\n",
        ),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
check(
        "good (D2 deprecat): 'we deprecated winston' with both tokens in line",
        ipair(
                "- Structured logging runs on pino; we deprecated winston after the data-loss incidents [note 10].\n",
        ),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
check(
        "good: 'winston is banned by the security policy' present-tense exemption",
        ipair("- Logging stays on pino; winston is banned by the security policy [note 12].\n"),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
check(
        "bad (negative pin): 'pino is the default logger' stays winner-current, not banned",
        ipair("- pino is the default logger for all new modules [note 11].\n"),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
check(
        "bad (negative pin): 'winston is under evaluation' stays loser-current (no false D1 match)",
        ipair("- winston is under evaluation for the retry service [note 3].\n"),
        { loserCurrentCount: 1, winnerCurrentCount: 0 },
);

// 2026-10-22 pins — D6 negation direction. The live agnes contradiction run (2026-10-22)
// produced "Group imports by type (...), not alphabetically" — winner stated, loser
// explicitly negated — which the D1-D5 set read as "both current". The negated token is
// the LOSING side; and a reversed line ("loser is current, not winner") must keep the
// loser counted as a violation.
check(
        "good (2026-10-22 live line): 'grouped by type, not alphabetically' reads loser-negated (D6)",
        pair(
                "- Group imports by type (node builtins → external packages → internal aliases → relative paths), not alphabetically [qa-s07].\n",
        ),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
check(
        "good (D6 never): 'never zod 3' rejection with both tokens",
        zpair("- Validate query params with zod 4, never zod 3 schemas [note 7].\n"),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
check(
        "good (D6 rather-than): 'grouping rather than alphabetical'",
        pair("- Import order is grouping by type rather than alphabetically [note 7].\n"),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);
check(
        "bad (negative pin): 'loser is current, NOT winner' keeps the loser counted",
        ipair("- The winston-based logger is the current setup, not pino [note 9].\n"),
        { loserCurrentCount: 1, winnerCurrentCount: 0 },
);
check(
        "good (D6 not-only guard): 'alphabetical not only in src' is NOT read as negation",
        pair("- Sorting stays alphabetical not only in src but in every package [note 3].\n"),
        { loserCurrentCount: 1, winnerCurrentCount: 0 },
);

// 2026-10-22 pins — D7 comparative-observation exemption. The live agnes
// interference run (2026-10-22, post rule-2 hardening) resolved correctly
// ("winston is removed after repeated data-loss incidents") but kept a stale
// redaction-config comparison mentioning both loggers; the strict classifier
// read it as "both current". A config-difference line is not a current-rule
// statement — but an IMPERATIVE naming both tokens still is.
check(
        "good (2026-10-22 live line): redaction config comparison is not a both-current statement (D7)",
        ipair(
                "- Redact card-number paths in log transports; pino and winston require separate configuration for redaction paths [note 13].\n",
        ),
        { loserCurrentCount: 0, winnerCurrentCount: 0 },
);
check(
        "bad (negative pin): 'Use pino and winston' imperative stays both-current",
        ipair("- Use pino and winston for structured logging in all modules [note 5].\n"),
        { loserCurrentCount: 1, winnerCurrentCount: 1 },
);
check(
        "good: comparative line plus a real winner line still resolves to the winner",
        ipair(
                "- Redact card-number paths in log transports; pino and winston require separate configuration for redaction paths [note 13].\n- Use pino for structured logging; winston is removed [note 14].\n",
        ),
        { loserCurrentCount: 0, winnerCurrentCount: 1 },
);

if (failed) {
        console.error(`\n${failed} classifier expectation(s) FAILED`);
        process.exit(1);
}
console.log("\nall classifier expectations hold");

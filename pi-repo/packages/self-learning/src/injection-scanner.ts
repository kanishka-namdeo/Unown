/**
 * injection-scanner.ts — Prompt-Injection Pattern Scanner (Milestone 1.5).
 *
 * Pure-regex threat-pattern matcher with risk levels/categories, optionally
 * augmented by an ML classifier (HuggingFace Inference API) with a confidence
 * threshold. Reverse-engineered from goose's `patterns.rs` + `scanner.rs` +
 * `classification_client.rs` (`crates/goose/src/security/`).
 *
 * Composition with hooks.ts: `decideInjection` is the third guard in the
 * PreToolUse chain — invoked after `decideBash`/`jailPath`/`decideAdversary`
 * (when those didn't already block). The scanner returns `{block:false}` for
 * read tools (reading is safe) and for unknown tool shapes that have no scan
 * target. When the config master-switch is off (`enabled:false` in
 * `injection-scanner.json` or `UNOWN_INJECTION_SCANNER=0` env var), the
 * scanner is a no-op.
 *
 * Patterns are pre-compiled at module load (RegExp literals). `decideInjection`
 * is SYNCHRONOUS — no LLM call, no async I/O on the hot path. The optional ML
 * classifier is injected via `_setMlClassifierForTests` for tests; the
 * production TODO is to wire up the HuggingFace Inference API, which will
 * require making `decideInjection` async (a breaking change to the hooks.ts
 * call site — deferred until the classifier proves its worth).
 *
 * Purity: `node:fs` + `node:os` + `node:path` only. No pi imports, no bus,
 * no store. The decision type is structurally compatible with
 * `PreToolDecision` in `hooks.ts` (`{block: boolean; reason?: string}`).
 *
 * Spec: see Milestone 1.5 in `docs/sdlc-feature-roadmap.md` + the task spec
 * in `worklog.md` (Task ID M1-C).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Risk levels, ordered low < medium < high < critical. */
export type Risk = "low" | "medium" | "high" | "critical";

/** The 8 spec-defined pattern categories. */
export type Category =
        | "instruction-injection"
        | "data-exfiltration"
        | "path-traversal"
        | "credential-harvesting"
        | "code-execution"
        | "sandbox-escape"
        | "obfuscation"
        | "tool-impersonation";

/** A single threat pattern. */
export interface InjectionPattern {
        /** Short slug, e.g. `inj-ignore-previous`. */
        id: string;
        /** Pre-compiled RegExp (UNANCHORED — substring match). Use the `i` flag for case-insensitive. */
        pattern: RegExp;
        /** Risk level — drives the block decision. */
        risk: Risk;
        /** Category — one of the 8 spec-defined categories (typed as `string` per spec). */
        category: string;
        /** Short human-readable explanation shown to the model. */
        reason: string;
}

/**
 * Decision returned by `decideInjection`. Structurally compatible with
 * `PreToolDecision` in `hooks.ts` (same field names + types) so the caller
 * can assign the result directly without a remap.
 */
export interface PreToolDecision {
        block: boolean;
        reason?: string;
}

/** Optional ML classifier config (HuggingFace Inference API). */
export interface MlClassifier {
        /** Master kill-switch for the ML path. */
        enabled: boolean;
        /** Full URL template; `${model}` is replaced with `model` (TODO). */
        endpoint?: string;
        /** HuggingFace model id (e.g., `garak/...`). */
        model?: string;
        /** Env var name holding the API key (e.g., `HF_TOKEN`). */
        apiKeyEnv?: string;
        /** Confidence threshold above which the classifier blocks (default 0.75). */
        confidenceThreshold?: number;
        /** Per-call HTTP timeout in ms (default 5000). */
        timeoutMs?: number;
}

/** Scanner config — loaded from `injectionScannerPath()` JSON file. */
export interface ScannerConfig {
        /** Master kill-switch (env `UNOWN_INJECTION_SCANNER=0` also disables). */
        enabled: boolean;
        /** Risk levels that trigger a block (default: critical, high, medium). */
        blockOn: Risk[];
        /** Pattern IDs to skip (allowlist escape hatch). */
        excludePatternIds: string[];
        /** If non-empty, ONLY these pattern IDs are evaluated (override). */
        includePatternIds: string[];
        /** Optional ML classifier. */
        mlClassifier?: MlClassifier;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default block-on: critical/high/medium. Low never blocks (informational). */
const DEFAULT_BLOCK_ON: Risk[] = ["critical", "high", "medium"];

const DEFAULT_CONFIG: ScannerConfig = {
        enabled: true,
        blockOn: DEFAULT_BLOCK_ON,
        excludePatternIds: [],
        includePatternIds: [],
        mlClassifier: undefined,
};

/** Per-tool scan-target size caps (chars). */
const MAX_COMMAND_CHARS = 64 * 1024; // 64 KiB (defensive; spec doesn't specify for bash)
const MAX_CONTENT_CHARS = 64 * 1024; // 64 KiB (spec: write/edit content)
const MAX_JSON_CHARS = 8 * 1024; // 8 KiB (spec: other tools)
const MAX_PATH_CHARS = 1024; // 1 KiB (defensive; appended to content for write/edit)

/** Risk ordering for "highest wins" semantics. */
const RISK_RANK: Record<Risk, number> = {
        low: 0,
        medium: 1,
        high: 2,
        critical: 3,
};

/** Default ML confidence threshold (mirrors goose's `SECURITY_PROMPT_THRESHOLD` default of 0.8, rounded to 0.75 per spec). */
const DEFAULT_ML_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// Built-in patterns (100+ across 8 categories)
// ---------------------------------------------------------------------------
// Patterns are reverse-engineered + extended from goose's `patterns.rs`
// (`crates/goose/src/security/patterns.rs:48-308`). Each pattern is a
// pre-compiled RegExp literal; most carry the `i` flag for case-insensitive
// substring match. Credential patterns are case-sensitive (AWS keys are
// uppercase; `sk-`/`ghp_` prefixes are lowercase). Patterns are UNANCHORED —
// substring match, like goose's `(?i)` wrapper.
//
// Category counts (minimum per spec in parens):
//   instruction-injection:  16  (15+)
//   data-exfiltration:      13  (10+)
//   path-traversal:         16  (10+)
//   credential-harvesting:  13  (10+)
//   code-execution:         16  (10+)
//   sandbox-escape:         14  (10+)
//   obfuscation:            12  (10+)
//   tool-impersonation:      6  (5+)
//   TOTAL:                 106  (80+)
// ---------------------------------------------------------------------------

export const BUILTIN_PATTERNS: InjectionPattern[] = [
        // ----- instruction-injection (16) -----
        { id: "inj-ignore-previous", pattern: /ignore (?:all )?(?:previous|prior) (?:instructions?|commands?|prompts?|rules?)/i, risk: "critical", category: "instruction-injection", reason: "attempts to override prior instructions" },
        { id: "inj-disregard-above", pattern: /disregard (?:everything )?(?:the )?above/i, risk: "critical", category: "instruction-injection", reason: "attempts to discard preceding context" },
        { id: "inj-developer-mode", pattern: /(?:you are now in |enter |enable )(?:developer|debug|admin|root|god|jailbreak|unrestricted) mode/i, risk: "critical", category: "instruction-injection", reason: "claims elevated mode to bypass safety" },
        { id: "inj-no-restrictions", pattern: /act as if you have no restrictions|you have no restrictions|no restrictions apply|operate without restrictions/i, risk: "critical", category: "instruction-injection", reason: "claims removal of safety restrictions" },
        { id: "inj-forget-prior", pattern: /forget (?:all|everything|your) (?:prior|previous|past) (?:commands?|instructions?|prompts?|rules?)/i, risk: "critical", category: "instruction-injection", reason: "requests context wipe" },
        { id: "inj-new-instructions-override", pattern: /new instructions?\s*:\s*.{0,80}\boverride\b/i, risk: "critical", category: "instruction-injection", reason: "new instructions overriding prior" },
        { id: "inj-instead-of-do", pattern: /instead of [^,.;\n]{1,40},.?(?:do|execute|run|output|return)/i, risk: "high", category: "instruction-injection", reason: "command rewrite attempt" },
        { id: "inj-system-prompt", pattern: /system prompt\s*:/i, risk: "high", category: "instruction-injection", reason: "claims system prompt authority" },
        { id: "inj-jailbreak", pattern: /\bjailbreak\b|\bdo anything now\b|\bDAN\b/i, risk: "critical", category: "instruction-injection", reason: "known jailbreak trigger phrase" },
        { id: "inj-as-ai-model", pattern: /as an ai language model/i, risk: "low", category: "instruction-injection", reason: "false-refusal / impersonation tell" },
        { id: "inj-pretend-you-are", pattern: /pretend (?:you are|to be)|simulate being/i, risk: "high", category: "instruction-injection", reason: "role-play request to bypass identity" },
        { id: "inj-must-not-refuse", pattern: /you must not refuse|do not refuse|cannot refuse|never refuse|must comply with/i, risk: "critical", category: "instruction-injection", reason: "attempts to disable refusal behavior" },
        { id: "inj-override-safety", pattern: /override your safety|bypass your safety|disable your safety|ignore safety guidelines/i, risk: "critical", category: "instruction-injection", reason: "explicit safety override request" },
        { id: "inj-test-capabilities", pattern: /this is a test of your capabilities|test (?:of )?your (?:safety|restrictions|limits|boundaries)/i, risk: "high", category: "instruction-injection", reason: "social-engineering capability probe" },
        { id: "inj-ignore-system-prompt", pattern: /ignore (?:the |all )?(?:previous |prior )?system prompt/i, risk: "critical", category: "instruction-injection", reason: "attempts to discard system prompt" },
        { id: "inj-reveal-instructions", pattern: /reveal (?:your |the )?(?:initial |system )?instructions?|show me your (?:system )?prompt/i, risk: "medium", category: "instruction-injection", reason: "attempts to extract system instructions" },

        // ----- data-exfiltration (13) -----
        { id: "exfil-send-contents", pattern: /send (?:the )?contents of (?:the )?(?:file|directory|folder|~\/)/i, risk: "high", category: "data-exfiltration", reason: "exfiltrates file contents" },
        { id: "exfil-post-to-url", pattern: /(?:post|upload|send) (?:to|at) (?:https?:\/\/|ftp:\/\/|file:\/\/)/i, risk: "high", category: "data-exfiltration", reason: "exfiltrates data to remote URL" },
        { id: "exfil-curl-post", pattern: /curl\s+[^|;\n]*?(?:-X\s*POST|--request\s+POST)/i, risk: "high", category: "data-exfiltration", reason: "curl POST exfiltration" },
        { id: "exfil-wget-post-data", pattern: /wget\s+[^|;\n]*?--post-data/i, risk: "high", category: "data-exfiltration", reason: "wget POST exfiltration" },
        { id: "exfil-nc-listener-pipe", pattern: /nc\s+-l\w*\s+\d+\s*[<>]/i, risk: "high", category: "data-exfiltration", reason: "netcat listener with redirect" },
        { id: "exfil-base64-url", pattern: /echo\s+[A-Za-z0-9+\/=]{40,}\s*\|\s*(?:base64|b64)\s+-d/i, risk: "high", category: "data-exfiltration", reason: "base64-encoded payload to decode" },
        { id: "exfil-include-file-contents", pattern: /include (?:the )?file contents (?:in|with|to) (?:your|the) (?:response|output|message|reply)/i, risk: "high", category: "data-exfiltration", reason: "exfiltrates file via response" },
        { id: "exfil-print-secrets", pattern: /print (?:all|every|the) secrets?|list (?:all|every) secrets?/i, risk: "high", category: "data-exfiltration", reason: "attempts to enumerate secrets" },
        { id: "exfil-show-env-vars", pattern: /show (?:me )?(?:all|every)?\s*(?:the )?(?:env|environment)\s*(?:vars?|variables?)|\bprintenv\b/i, risk: "medium", category: "data-exfiltration", reason: "enumerates environment variables" },
        { id: "exfil-paste-ssh", pattern: /paste (?:the )?contents of ~\/\.ssh/i, risk: "high", category: "data-exfiltration", reason: "exfiltrates SSH keys" },
        { id: "exfil-cat-aws-creds", pattern: /cat\s+~?\/?\.aws\/credentials/i, risk: "high", category: "data-exfiltration", reason: "reads AWS credentials file" },
        { id: "exfil-post-api-key", pattern: /post (?:the )?(?:api[_ -]?key|secret|token) to/i, risk: "high", category: "data-exfiltration", reason: "exfiltrates API key to remote" },
        { id: "exfil-send-to-attacker", pattern: /send (?:to|at) (?:attacker|exfil|c2|command.?and.?control)/i, risk: "critical", category: "data-exfiltration", reason: "explicit exfiltration intent" },

        // ----- path-traversal (16) -----
        { id: "pt-etc-passwd", pattern: /\/etc\/passwd\b/i, risk: "high", category: "path-traversal", reason: "reads system password file" },
        { id: "pt-etc-shadow", pattern: /\/etc\/shadow\b/i, risk: "critical", category: "path-traversal", reason: "reads password hashes" },
        { id: "pt-etc-sudoers", pattern: /\/etc\/sudoers\b/i, risk: "critical", category: "path-traversal", reason: "reads sudo policy" },
        { id: "pt-dotdot-traversal", pattern: /\.\.[\/\\]\.\.[\/\\]\.\./, risk: "high", category: "path-traversal", reason: "directory traversal escape (3+ levels, Unix or Windows)" },
        { id: "pt-ssh-id-rsa", pattern: /\.ssh\/id_rsa/i, risk: "high", category: "path-traversal", reason: "reads SSH private key" },
        { id: "pt-aws-credentials", pattern: /\.aws\/credentials/i, risk: "high", category: "path-traversal", reason: "reads AWS credentials file" },
        { id: "pt-gcloud-config", pattern: /\.config\/gcloud/i, risk: "high", category: "path-traversal", reason: "reads gcloud config" },
        { id: "pt-kube-config", pattern: /\.kube\/config/i, risk: "high", category: "path-traversal", reason: "reads Kubernetes config" },
        { id: "pt-docker-config", pattern: /\.docker\/config\.json/i, risk: "high", category: "path-traversal", reason: "reads Docker config" },
        { id: "pt-proc-environ", pattern: /\/proc\/self\/environ/i, risk: "high", category: "path-traversal", reason: "reads process environment" },
        { id: "pt-proc-cmdline", pattern: /\/proc\/self\/cmdline/i, risk: "medium", category: "path-traversal", reason: "reads process command line" },
        { id: "pt-var-log-auth", pattern: /\/var\/log\/auth\.log/i, risk: "medium", category: "path-traversal", reason: "reads auth log" },
        { id: "pt-var-log-syslog", pattern: /\/var\/log\/syslog/i, risk: "medium", category: "path-traversal", reason: "reads syslog" },
        { id: "pt-windows-sam", pattern: /[\\/]Windows[\\/]System32[\\/]config[\\/]SAM\b/i, risk: "critical", category: "path-traversal", reason: "reads Windows SAM hive" },
        { id: "pt-windows-system32-config", pattern: /[\\/]Windows[\\/]System32[\\/]config\b/i, risk: "high", category: "path-traversal", reason: "reads Windows system config" },
        { id: "pt-bash-history", pattern: /(?:\.bash_history|\.zsh_history|\/root\/\.bash_history)/i, risk: "medium", category: "path-traversal", reason: "reads shell history" },

        // ----- credential-harvesting (13) -----
        { id: "cred-aws-access-key", pattern: /AKIA[0-9A-Z]{16}/, risk: "critical", category: "credential-harvesting", reason: "AWS access key ID exposed" },
        { id: "cred-openai-key", pattern: /sk-[a-zA-Z0-9]{20,}/, risk: "critical", category: "credential-harvesting", reason: "OpenAI-style secret exposed" },
        { id: "cred-github-pat", pattern: /ghp_[a-zA-Z0-9]{36,}/, risk: "critical", category: "credential-harvesting", reason: "GitHub PAT exposed" },
        { id: "cred-github-fine-grained", pattern: /github_pat_[a-zA-Z0-9_]{20,}/, risk: "critical", category: "credential-harvesting", reason: "GitHub fine-grained PAT exposed" },
        { id: "cred-slack-token", pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/, risk: "critical", category: "credential-harvesting", reason: "Slack token exposed" },
        { id: "cred-pem-private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, risk: "critical", category: "credential-harvesting", reason: "PEM private key block" },
        { id: "cred-bearer-token", pattern: /Bearer [a-zA-Z0-9._-]{20,}/i, risk: "high", category: "credential-harvesting", reason: "Bearer token exposed" },
        { id: "cred-api-key-label", pattern: /api[_ -]?key\s*:/i, risk: "medium", category: "credential-harvesting", reason: "labeled API key" },
        { id: "cred-secret-label", pattern: /(?:secret|password)\s*:/i, risk: "medium", category: "credential-harvesting", reason: "labeled secret/password" },
        { id: "cred-token-label", pattern: /token\s*:/i, risk: "medium", category: "credential-harvesting", reason: "labeled token" },
        { id: "cred-authz-bearer", pattern: /Authorization\s*:\s*Bearer/i, risk: "high", category: "credential-harvesting", reason: "Authorization Bearer header" },
        { id: "cred-jdbc-embedded", pattern: /jdbc:\w+:\/\/[^\s?]*\?[^\s]*password=/i, risk: "high", category: "credential-harvesting", reason: "JDBC URL with embedded password" },
        { id: "cred-google-api-key", pattern: /AIza[0-9A-Za-z_-]{35}/, risk: "critical", category: "credential-harvesting", reason: "Google API key exposed" },

        // ----- code-execution (16) -----
        { id: "ce-eval", pattern: /\beval\s*\(/, risk: "high", category: "code-execution", reason: "eval() invocation" },
        { id: "ce-function-constructor", pattern: /new\s+Function\s*\(|\bFunction\s*\(/, risk: "high", category: "code-execution", reason: "Function constructor invocation" },
        { id: "ce-child-process-exec", pattern: /child_process\.exec/i, risk: "critical", category: "code-execution", reason: "Node.js child_process.exec" },
        { id: "ce-subprocess-popen", pattern: /subprocess\.Popen|subprocess\.call|subprocess\.run/i, risk: "critical", category: "code-execution", reason: "Python subprocess invocation" },
        { id: "ce-os-system", pattern: /\bos\.system\s*\(/, risk: "critical", category: "code-execution", reason: "Python os.system invocation" },
        { id: "ce-exec-spawn", pattern: /\b(?:exec|spawn)\s*\(/, risk: "high", category: "code-execution", reason: "exec/spawn invocation" },
        { id: "ce-pickle-loads", pattern: /pickle\.loads/i, risk: "critical", category: "code-execution", reason: "pickle.loads (deserialization RCE)" },
        { id: "ce-marshal-loads", pattern: /marshal\.loads/i, risk: "critical", category: "code-execution", reason: "marshal.loads (deserialization RCE)" },
        { id: "ce-require-child-process", pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, risk: "high", category: "code-execution", reason: "requires child_process module" },
        { id: "ce-import-subprocess", pattern: /\bimport\s+subprocess\b/, risk: "high", category: "code-execution", reason: "imports Python subprocess" },
        { id: "ce-eval-atob", pattern: /eval\s*\(\s*atob\s*\(/i, risk: "critical", category: "code-execution", reason: "eval of base64-decoded code" },
        { id: "ce-eval-buffer-from", pattern: /eval\s*\(\s*Buffer\.from\s*\(/i, risk: "critical", category: "code-execution", reason: "eval of Buffer.from code" },
        { id: "ce-template-process-env", pattern: /\$\{process\.env/i, risk: "high", category: "code-execution", reason: "JS template injection of process.env" },
        { id: "ce-template-ssti", pattern: /\{\{[^}]*\}\}|<%[^%]*%>/, risk: "medium", category: "code-execution", reason: "template injection syntax" },
        { id: "ce-rm-rf-root", pattern: /rm\s+(-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)+['"]?\/(?:['"]|\s|$|[*;&|])/i, risk: "critical", category: "code-execution", reason: "recursive deletion of root filesystem" },
        { id: "ce-rm-rf-home", pattern: /rm\s+(-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)+['"]?(?:~|\$HOME|\/home|\/root)/i, risk: "critical", category: "code-execution", reason: "recursive deletion of home/root directory" },

        // ----- sandbox-escape (14) -----
        { id: "se-chroot", pattern: /\bchroot\b/i, risk: "high", category: "sandbox-escape", reason: "chroot sandbox escape" },
        { id: "se-unshare", pattern: /\bunshare\b/i, risk: "high", category: "sandbox-escape", reason: "unshare namespace escape" },
        { id: "se-nsenter", pattern: /\bnsenter\b/i, risk: "high", category: "sandbox-escape", reason: "nsenter namespace escape" },
        { id: "se-ld-preload", pattern: /LD_PRELOAD\s*=/i, risk: "critical", category: "sandbox-escape", reason: "LD_PRELOAD library injection" },
        { id: "se-ld-library-path", pattern: /LD_LIBRARY_PATH\s*=/i, risk: "high", category: "sandbox-escape", reason: "LD_LIBRARY_PATH override" },
        { id: "se-procfs-mount", pattern: /mount\s+-t\s+proc/i, risk: "high", category: "sandbox-escape", reason: "procfs mount" },
        { id: "se-sysrq-trigger", pattern: /\/proc\/sysrq-trigger/i, risk: "critical", category: "sandbox-escape", reason: "kernel SysRq trigger" },
        { id: "se-mount-remount-rw", pattern: /mount\s+-o\s+remount,rw/i, risk: "critical", category: "sandbox-escape", reason: "remount root as read-write" },
        { id: "se-capsh-caps", pattern: /\bcapsh\s+--caps=/i, risk: "critical", category: "sandbox-escape", reason: "Linux capability manipulation" },
        { id: "se-setcap", pattern: /\bsetcap\s+cap_/i, risk: "critical", category: "sandbox-escape", reason: "setcap capability escalation" },
        { id: "se-chmod-setuid", pattern: /chmod\s+[2467][0-7]{3}\b|chmod\s+\+s/i, risk: "high", category: "sandbox-escape", reason: "setuid/setgid binary creation" },
        { id: "se-docker-privileged", pattern: /docker\s+(?:run|exec)\s+[^|;\n]*?--privileged/i, risk: "critical", category: "sandbox-escape", reason: "docker privileged container" },
        { id: "se-podman-privileged", pattern: /podman\s+(?:run|exec)\s+[^|;\n]*?--privileged/i, risk: "critical", category: "sandbox-escape", reason: "podman privileged container" },
        { id: "se-cap-add-all", pattern: /(?:docker|podman)\s+(?:run|exec)\s+[^|;\n]*?--cap-add=ALL/i, risk: "critical", category: "sandbox-escape", reason: "all Linux capabilities granted" },

        // ----- obfuscation (12) -----
        { id: "obf-hex-escape", pattern: /(?:\\x[0-9a-fA-F]{2}){2,}/, risk: "medium", category: "obfuscation", reason: "hex-escape sequence (2+ consecutive)" },
        { id: "obf-octal-escape", pattern: /(?:\\[0-7]{3}){2,}/, risk: "medium", category: "obfuscation", reason: "octal-escape sequence (2+ consecutive)" },
        { id: "obf-unicode-escape", pattern: /(?:\\u[0-9a-fA-F]{4}|\\U[0-9a-fA-F]{8}){2,}/, risk: "medium", category: "obfuscation", reason: "unicode-escape sequence (2+ consecutive)" },
        { id: "obf-html-entity", pattern: /&#x[0-9a-fA-F]{2,4};|&#[0-9]{2,4};/, risk: "low", category: "obfuscation", reason: "HTML entity encoding" },
        { id: "obf-url-encoded", pattern: /(?:%[0-9a-fA-F]{2}){3,}/, risk: "low", category: "obfuscation", reason: "URL-encoded payload (3+)" },
        { id: "obf-base64-shell-pipe", pattern: /(?:echo|printf)\s+['"]?[A-Za-z0-9+\/=]{8,}['"]?\s*\|\s*base64\s+-d\s*\|\s*(?:bash|sh|zsh|fish|csh|ksh)/i, risk: "high", category: "obfuscation", reason: "base64-encoded shell payload" },
        { id: "obf-base64-decode-pipe", pattern: /\|\s*base64\s+-d\s*\|\s*(?:bash|sh|zsh|fish|csh|ksh)/i, risk: "high", category: "obfuscation", reason: "base64 decode piped to shell" },
        { id: "obf-string-concat", pattern: /['"][^'"]{0,40}['"]\s*\+\s*['"][^'"]{0,40}['"](?:\s*\+\s*['"][^'"]{0,40}['"]){1,}/, risk: "low", category: "obfuscation", reason: "string concatenation chain (3+)" },
        { id: "obf-bracket-char-class", pattern: /\[\$\(\([^)]*\)\)\]/, risk: "low", category: "obfuscation", reason: "bracketed command substitution" },
        { id: "obf-backtick-substitution", pattern: /`[^`]{0,80}`[^`]{0,40}`[^`]{0,40}`/, risk: "low", category: "obfuscation", reason: "chained backtick substitution" },
        { id: "obf-dollar-paren-chain", pattern: /\$\([^)]*\$\([^)]*\)[^)]*\)/, risk: "medium", category: "obfuscation", reason: "nested $() substitution chain" },
        { id: "obf-eval-buffer-from", pattern: /eval\s*\(\s*Buffer\.from\s*\([^)]*,\s*['"]base64['"]\s*\)/i, risk: "critical", category: "obfuscation", reason: "eval of base64 Buffer" },

        // ----- tool-impersonation (6) -----
        { id: "ti-helpful-assistant-destructive", pattern: /as a helpful assistant,[^.\n]{0,80}(?:delete|remove|wipe|destroy|exfiltrate|disable)/i, risk: "critical", category: "tool-impersonation", reason: "impersonates assistant to invoke destructive op" },
        { id: "ti-true-intent", pattern: /(?:the )?user'?s true intent(?:ion)? is/i, risk: "high", category: "tool-impersonation", reason: "claims privileged user intent knowledge" },
        { id: "ti-policy-rewrite", pattern: /actually,?\s+the policy is/i, risk: "high", category: "tool-impersonation", reason: "fabricates policy replacement" },
        { id: "ti-updated-allowed-commands", pattern: /here'?s? an? (?:updated|new) list of allowed commands/i, risk: "high", category: "tool-impersonation", reason: "fabricates allowed-command list" },
        { id: "ti-ignore-system-prompt", pattern: /ignore (?:the )?(?:previous |prior )?system prompt/i, risk: "critical", category: "tool-impersonation", reason: "attempts to discard system prompt" },
        { id: "ti-impersonate-system", pattern: /(?:you are|act as|simulate) (?:the |a )?system(?: administrator| root)?/i, risk: "high", category: "tool-impersonation", reason: "impersonates system role" },
];

// Sanity check at module load: ensure we have the spec-required minimum.
if (BUILTIN_PATTERNS.length < 80) {
        // Don't throw — that would crash the host process. Log a warning.
        console.warn(`[injection-scanner] WARNING: only ${BUILTIN_PATTERNS.length} builtin patterns (spec requires >= 80).`);
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Config dir for the scanner config file. `${UNOWN_HOME || ~/.config/unown}` —
 * mirrors `adversary.ts`'s `resolveConfigDir`. `||`, not `??`: same
 * empty-env-value rule as the rest of the codebase (see adversary.ts:83).
 *
 * Computed lazily inside `injectionScannerPath()` (NOT captured at module
 * load) so a long-running process that re-sets `UNOWN_HOME` (e.g. tests,
 * multi-tenant runners) sees the new path on the next call.
 */
function resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
        return env.UNOWN_HOME || join(homedir(), ".config", "unown");
}

/**
 * Resolve the default scanner config file path:
 * `${UNOWN_HOME || ~/.config/unown}/injection-scanner.json`. Cross-platform —
 * `node:path.join` picks the right separator; the `.config` prefix works on
 * Windows too (node doesn't care about dot-prefixed dirs).
 */
export function injectionScannerPath(): string {
        return join(resolveConfigDir(), "injection-scanner.json");
}

// ---------------------------------------------------------------------------
// Config loading (mtime-cached)
// ---------------------------------------------------------------------------

let cachedConfig: { path: string; mtimeMs: number; cfg: ScannerConfig } | null = null;

/** Merge a parsed JSON object with `DEFAULT_CONFIG`, validating each field. */
function mergeWithDefaults(parsed: unknown): ScannerConfig {
        if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_CONFIG };
        const p = parsed as Record<string, unknown>;
        const cfg: ScannerConfig = { ...DEFAULT_CONFIG };
        if (typeof p.enabled === "boolean") cfg.enabled = p.enabled;
        if (Array.isArray(p.blockOn)) {
                cfg.blockOn = p.blockOn.filter(
                        (r): r is Risk => r === "low" || r === "medium" || r === "high" || r === "critical",
                );
        }
        if (Array.isArray(p.excludePatternIds)) {
                cfg.excludePatternIds = p.excludePatternIds.filter((s): s is string => typeof s === "string");
        }
        if (Array.isArray(p.includePatternIds)) {
                cfg.includePatternIds = p.includePatternIds.filter((s): s is string => typeof s === "string");
        }
        if (typeof p.mlClassifier === "object" && p.mlClassifier !== null) {
                const m = p.mlClassifier as Record<string, unknown>;
                const ml: MlClassifier = { enabled: false };
                if (typeof m.enabled === "boolean") ml.enabled = m.enabled;
                if (typeof m.endpoint === "string") ml.endpoint = m.endpoint;
                if (typeof m.model === "string") ml.model = m.model;
                if (typeof m.apiKeyEnv === "string") ml.apiKeyEnv = m.apiKeyEnv;
                if (typeof m.confidenceThreshold === "number") ml.confidenceThreshold = m.confidenceThreshold;
                if (typeof m.timeoutMs === "number") ml.timeoutMs = m.timeoutMs;
                cfg.mlClassifier = ml;
        }
        return cfg;
}

/**
 * Load the scanner config from `injectionScannerPath()`. Mtime-cached so the
 * hot path (1000+ calls) doesn't re-stat the file. On cache miss, missing
 * file, or invalid JSON → returns `DEFAULT_CONFIG` (no throw). The negative
 * result is NOT cached, so a later file creation is picked up on the next
 * call.
 */
function loadConfig(): ScannerConfig {
        const p = injectionScannerPath();
        if (!existsSync(p)) return { ...DEFAULT_CONFIG };
        try {
                const st = statSync(p);
                if (cachedConfig && cachedConfig.path === p && cachedConfig.mtimeMs === st.mtimeMs) {
                        return cachedConfig.cfg;
                }
                const txt = readFileSync(p, "utf8");
                const parsed = JSON.parse(txt);
                const cfg = mergeWithDefaults(parsed);
                cachedConfig = { path: p, mtimeMs: st.mtimeMs, cfg };
                return cfg;
        } catch {
                return { ...DEFAULT_CONFIG };
        }
}

/**
 * Test-only: clear the config cache. Call after writing/changing the config
 * file or `UNOWN_HOME` to ensure the next `decideInjection` call re-reads.
 * Not for production use.
 */
export function _resetConfigCacheForTests(): void {
        cachedConfig = null;
}

// ---------------------------------------------------------------------------
// ML classifier mock injection (test-only escape hatch)
// ---------------------------------------------------------------------------

/** Synchronous ML classifier function shape (mock for tests; production TODO). */
export type MlClassifierFn = (text: string) => { score: number; label: string } | null;

let mlClassifierFn: MlClassifierFn | null = null;

/**
 * Test-only: inject a synchronous ML classifier mock. The production TODO is
 * to wire this up to the HuggingFace Inference API (which requires making
 * `decideInjection` async — a breaking change to the hooks.ts call site,
 * deferred until the classifier proves its worth). Pass `null` to reset.
 *
 * When `cfg.mlClassifier.enabled === true` AND this function is set, the
 * classifier is called AFTER the regex pass. If the regex already blocked
 * with high/critical risk, the ML call is skipped (latency saving). The ML
 * verdict is OR'd with the regex verdict: `finalBlock = regexBlock || (mlScore >= threshold)`.
 *
 * On classifier throw / null return → fall back to regex-only verdict.
 */
export function _setMlClassifierForTests(fn: MlClassifierFn | null): void {
        mlClassifierFn = fn;
}

// ---------------------------------------------------------------------------
// Scan target extraction
// ---------------------------------------------------------------------------

/** Cap `s` at `limit` chars (defensive against runaway inputs). */
function cap(s: string, limit: number): string {
        return s.length <= limit ? s : s.slice(0, limit);
}

/** Coerce any value to a scan-safe string (secrets are NOT redacted here — the scanner's job is to find them). */
function toScanString(v: unknown): string {
        if (typeof v === "string") return v;
        if (v === null || v === undefined) return "";
        if (typeof v === "number" || typeof v === "boolean") return String(v);
        try {
                return JSON.stringify(v) ?? String(v);
        } catch {
                return String(v);
        }
}

/**
 * Extract the text to scan for a given tool. Returns `{scanned: false}` for
 * read tools (spec: "reading is safe") and for empty inputs.
 *
 * Spec scan targets:
 *   - bash/powershell: input.command (defensive 64 KiB cap)
 *   - write/edit:      input.content (64 KiB) — also scans input.path
 *                      (defensive; catches writes to ~/.ssh/id_rsa etc.
 *                      even when content is empty/benign)
 *   - read:            skip
 *   - other:           JSON.stringify(input) (8 KiB)
 */
function extractScanText(tool: string, input: Record<string, unknown>): { text: string; scanned: boolean } {
        if (tool === "bash" || tool === "powershell") {
                const cmd = toScanString(input.command);
                return { text: cap(cmd, MAX_COMMAND_CHARS), scanned: true };
        }
        if (tool === "write" || tool === "edit") {
                const content = toScanString(input.content);
                const path = toScanString(input.path ?? input.file_path);
                // Spec says scan content; we ALSO scan path defensively so a write
                // to ~/.ssh/id_rsa (with empty/benign content) still blocks.
                return { text: cap(content, MAX_CONTENT_CHARS) + "\n" + cap(path, MAX_PATH_CHARS), scanned: true };
        }
        if (tool === "read") {
                return { text: "", scanned: false };
        }
        // All other tools: JSON.stringify(input) truncated to 8 KiB.
        let s: string;
        try {
                s = JSON.stringify(input) ?? "";
        } catch {
                s = String(input);
        }
        return { text: cap(s, MAX_JSON_CHARS), scanned: true };
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/**
 * Run the configured patterns against `text`. Excludes `excludePatternIds`;
 * if `includePatternIds` is non-empty, ONLY those IDs are evaluated. Returns
 * ALL matches (multi-match) — the caller picks the highest-risk one for the
 * block decision, but the reason lists every matched ID.
 *
 * Category filter: when `scanMode = "content"` (write/edit), only
 * prompt-injection-related categories are scanned — code-execution patterns
 * like `eval(`, `subprocess.Popen`, `child_process.exec` would false-positive
 * on legitimate user code (the agent is *writing* the user's code, not
 * executing attacker-supplied input). When `scanMode = "command"` (default),
 * all 106 patterns apply — bash/powershell commands ARE the threat surface.
 *
 * O(n) where n = pattern count (106 built-in). Each `pattern.test(text)` is
 * a single regex evaluation; no find_iter needed (we only need a boolean).
 */
function matchPatterns(
        text: string,
        cfg: ScannerConfig,
        scanMode: "command" | "content" = "command",
): InjectionPattern[] {
        const excludeSet = new Set(cfg.excludePatternIds);
        const includeSet = cfg.includePatternIds.length > 0 ? new Set(cfg.includePatternIds) : null;
        // When scanning write/edit content, only prompt-injection / data-exfil
        // / credential / sandbox-escape categories apply — NOT code-execution
        // patterns that match legitimate code the agent is writing for the user.
        const contentCategories = new Set([
                "instruction-injection",
                "data-exfiltration",
                "path-traversal",
                "credential-harvesting",
                "sandbox-escape",
                "tool-impersonation",
                "obfuscation",
        ]);
        const matched: InjectionPattern[] = [];
        for (const p of BUILTIN_PATTERNS) {
                if (excludeSet.has(p.id)) continue;
                if (includeSet !== null && !includeSet.has(p.id)) continue;
                if (scanMode === "content" && !contentCategories.has(p.category)) continue;
                if (p.pattern.test(text)) matched.push(p);
        }
        return matched;
}

/** Return the highest risk among `matched`, or `null` if empty. */
function topRisk(matched: InjectionPattern[]): Risk | null {
        if (matched.length === 0) return null;
        let top: Risk = "low";
        for (const m of matched) {
                if (RISK_RANK[m.risk] > RISK_RANK[top]) top = m.risk;
        }
        return top;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Decide whether to block a PreToolUse call via the prompt-injection scanner.
 *
 * Flow (matches the spec verbatim):
 * 1. Env kill-switch: `UNOWN_INJECTION_SCANNER=0` → `{block:false}`.
 * 2. Load config from `injectionScannerPath()`. If `enabled === false` →
 *    `{block:false}`.
 * 3. Extract the scan text for `tool`. If the tool is `read` (or has no
 *    scan target) → `{block:false}`.
 * 4. Run all matching patterns (excluding `excludePatternIds`).
 * 5. Determine block: highest-risk match wins; block iff that risk is in
 *    `cfg.blockOn` (and is NOT `low` — low never blocks per spec).
 * 6. Optional ML classifier: if `cfg.mlClassifier.enabled` AND a classifier
 *    fn is injected (via `_setMlClassifierForTests`), call it UNLESS the
 *    regex already blocked with high/critical (latency saving). The ML
 *    verdict is OR'd: `finalBlock = regexBlock || (mlScore >= threshold)`.
 * 7. On classifier throw / null → fall back to regex-only.
 * 8. Return `{block:false}` (no reason) or `{block:true, reason}` where
 *    `reason` lists ALL matched pattern IDs (so the model can see why).
 *
 * Synchronous — no LLM call, no async I/O on the hot path. The optional ML
 * classifier is a synchronous mock (test-only); the production TODO is to
 * wire up the HuggingFace Inference API (which will require making this
 * function async — deferred).
 *
 * `sandboxRoot` is accepted for API compatibility with `hooks.ts:468` but
 * unused (the scanner is a pure-text matcher; the path-jail guard is a
 * separate `jailPath` call in `hooks.ts:474`).
 */
export function decideInjection(
        tool: string,
        input: Record<string, unknown>,
        _sandboxRoot: string,
): PreToolDecision {
        // Step 1: env kill-switch.
        if (process.env.UNOWN_INJECTION_SCANNER === "0") return { block: false };

        // Step 2: config.
        const cfg = loadConfig();
        if (!cfg.enabled) return { block: false };

        // Step 3: extract scan text.
        const safeInput = input && typeof input === "object" ? input : {};
        const { text, scanned } = extractScanText(tool, safeInput);
        if (!scanned || text.length === 0) return { block: false };

        // Step 4: regex patterns — content mode for write/edit so legitimate
        // code (eval, subprocess, etc.) doesn't false-positive. The agent is
        // WRITING the user's code; only prompt-injection categories apply.
        const scanMode: "command" | "content" = tool === "write" || tool === "edit" ? "content" : "command";
        const matched = matchPatterns(text, cfg, scanMode);

        // Step 5: determine regex block.
        const top = topRisk(matched);
        let block: boolean;
        if (top === null) {
                block = false;
        } else if (top === "low") {
                // Spec: "low → never block (informational only)".
                block = false;
        } else {
                block = cfg.blockOn.includes(top);
        }

        // Step 6: optional ML classifier.
        const regexHighBlock = block && (top === "critical" || top === "high");
        if (!regexHighBlock && cfg.mlClassifier?.enabled && mlClassifierFn) {
                try {
                        const result = mlClassifierFn(text);
                        if (result && typeof result.score === "number") {
                                const threshold = cfg.mlClassifier.confidenceThreshold ?? DEFAULT_ML_THRESHOLD;
                                if (result.score >= threshold) {
                                        block = true;
                                        // Augment the matched list with a synthetic ML entry so the
                                        // reason surfaces the classifier's verdict.
                                        matched.push({
                                                id: `ml-classifier:${result.label || "injection"}`,
                                                pattern: /./,
                                                risk: "high",
                                                category: "ml-classifier",
                                                reason: `ML classifier flagged (score=${result.score.toFixed(3)}, label=${result.label || "injection"})`,
                                        });
                                }
                        }
                } catch {
                        // Fall back to regex-only verdict (block stays as-is).
                }
        }

        // Step 8: build the decision.
        if (!block) return { block: false };
        const finalTop = topRisk(matched) ?? "medium";
        const ids = matched.map((m) => m.id).join(",");
        return {
                block: true,
                reason: `injection-scanner: blocked (risk=${finalTop}, patterns=${ids})`,
        };
}

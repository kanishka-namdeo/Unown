/**
 * invisible.ts — invisible-character sanitization for prompt input (the Da
 * capo round, 2026-11-16).
 *
 * The Claude Code contract (changelog v2.1.314, fetched 2026-11-16): "Fixed
 * prompts containing invisible characters needing a second Enter to send;
 * plain prompts now send cleaned on the first Enter" — plus paste-time
 * stripping of invisible Unicode formatting characters. The threat class is
 * real: zero-width and bidi-override characters are the "trojan source"
 * obfuscation lane (code that reads differently from how it displays), and
 * tag characters can smuggle ASCII payloads inside emoji-flag sequences.
 *
 * What is stripped (and what deliberately is not):
 *   - U+200B..U+200F  zero-width space/joiner + LRM/RLM marks
 *   - U+202A..U+202E  bidi embedding/override controls (trojan source)
 *   - U+2060..U+2064  word joiner + invisible math operators
 *   - U+2066..U+2069  bidi isolates
 *   - U+FEFF          zero-width no-break space (BOM)
 *   - U+E0000..U+E007F tag characters (emoji-flag ASCII smuggling)
 *   - U+FFF9..U+FFFB  interlinear annotation anchors
 *
 * NOT stripped: every visible character, whitespace (space/tab/newline —
 * paste markers depend on real newlines), combining marks that attach to
 * visible text, and U+00AD (soft hyphen — visible when rendered mid-word).
 *
 * Purity contract: one pure function, unit-tested (node:test); the editor
 * and the submit lane both call it and report the stripped count.
 */

/** The single invisible-character class this module knows (u flag: \u{...} code points, not 4-digit escapes). */
const INVISIBLE_CHAR_REGEX =
        /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}\uFFF9-\uFFFB]/gu;

export interface SanitizeInvisibleResult {
        /** The cleaned text (always a new string when stripped > 0). */
        text: string;
        /** How many invisible characters were removed. */
        stripped: number;
}

/**
 * Strip invisible Unicode formatting characters from input text.
 * Pure: no process access, deterministic, never throws.
 */
export function sanitizeInvisibleCharacters(text: string): SanitizeInvisibleResult {
        if (!text) return { text, stripped: 0 };
        // Fast path: the regex scan is the only cost; skip when nothing matches.
        if (!INVISIBLE_CHAR_REGEX.test(text)) {
                INVISIBLE_CHAR_REGEX.lastIndex = 0;
                return { text, stripped: 0 };
        }
        INVISIBLE_CHAR_REGEX.lastIndex = 0;
        const stripped = text.match(INVISIBLE_CHAR_REGEX)?.length ?? 0;
        return { text: text.replace(INVISIBLE_CHAR_REGEX, ""), stripped };
}

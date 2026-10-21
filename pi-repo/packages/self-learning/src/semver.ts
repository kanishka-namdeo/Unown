/**
 * semver.ts — the release-version comparison the update paths share.
 *
 * Extracted from update.ts so the release-feed (binary) updater can compare
 * versions without importing the git-based updater (and creating a cycle).
 * update.ts re-exports both names, so every existing caller keeps working.
 */

export interface ParsedSemver {
        major: number;
        minor: number;
        patch: number;
        pre: string[];
}

export function parseSemver(v: string): ParsedSemver | null {
        const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
        if (!m) return null;
        return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split(".") : [] };
}

/** >0 when a is newer, <0 older, 0 equal. Unparseable versions compare as 0-equal-but-last. */
export function compareSemver(a: string, b: string): number {
        const pa = parseSemver(a);
        const pb = parseSemver(b);
        if (!pa || !pb) {
                // unknown sorts below everything known
                if (!pa && !pb) return 0;
                return !pa ? -1 : 1;
        }
        for (const k of ["major", "minor", "patch"] as const) {
                if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1;
        }
        // release > prerelease; identifiers compare numerically when both numeric
        if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
        if (pa.pre.length === 0) return 1;
        if (pb.pre.length === 0) return -1;
        const n = Math.max(pa.pre.length, pb.pre.length);
        for (let i = 0; i < n; i++) {
                const x = pa.pre[i];
                const y = pb.pre[i];
                if (x === undefined) return -1; // fewer fields = lower precedence
                if (y === undefined) return 1;
                const xn = /^\d+$/.test(x);
                const yn = /^\d+$/.test(y);
                if (xn && yn) {
                        if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1;
                } else if (xn !== yn) {
                        return xn ? -1 : 1; // numeric identifiers < alphanumeric
                } else if (x !== y) {
                        return x > y ? 1 : -1;
                }
        }
        return 0;
}

// url-trim.ts — trailing-slash hygiene for URL-shaped and path-shaped strings.
//
// One linear-time helper replacing the eleven `.replace(/\/+$/, "")` call
// sites that used to live inline (setup.ts ×2, providers-cli.ts, term.ts ×2,
// server.ts ×2, usage-cli.ts, websearch.ts, uninstall.ts ×2).
//
// Why not the regex: CodeQL's js/polynomial-redos flags `/\/+$/` applied to
// uncontrolled input (a pasted --base-url, PI_BRIDGE_URL, UNOWN_SEARXNG_URL,
// a request's Origin header). On a run of N trailing slashes the regex engine
// rescans the run from every start offset — O(N²) character comparisons for
// what is a single backward scan. This helper does the backward scan with no
// regex engine at all, and the result is byte-identical to the regex it
// replaces: "" stays "", "/" becomes "", "https://x.com/v1/" trims to
// "https://x.com/v1", no interior slash is touched.

/** Strip every trailing "/" from the end of `url`. O(length), allocation-free
 *  when there is nothing to trim (the same string object is returned). */
export function trimTrailingSlashes(url: string): string {
	let end = url.length;
	while (end > 0 && url.charCodeAt(end - 1) === 47 /* "/" */) end--;
	return end === url.length ? url : url.slice(0, end);
}

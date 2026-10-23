/**
 * Host-based URL matching.
 *
 * Checking a raw URL string for a domain with `url.includes("api.example.com")`
 * matches the domain anywhere in the URL, including the path and query string,
 * so `https://evil.net/api.example.com` would pass. Parsing the URL and
 * comparing hostnames avoids those false positives and cannot be bypassed by
 * embedding the domain in an unexpected location.
 */

/** True when rawUrl's parsed hostname is host, or a subdomain of it. Fails closed on unparseable URLs. */
export function urlHostMatches(rawUrl: string, host: string): boolean {
	let hostname: string;
	try {
		hostname = new URL(rawUrl).hostname.toLowerCase();
	} catch {
		return false;
	}
	const h = host.toLowerCase();
	return hostname === h || hostname.endsWith(`.${h}`);
}

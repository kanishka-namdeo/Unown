/**
 * Live GitHub star count, fetched at build time rather than in the browser.
 *
 * Why not the browser: `api.github.com` sends `Access-Control-Allow-Origin: *`
 * so a client fetch *would* work, but the unauthenticated limit is 60 requests
 * per hour per IP — one per visitor, which is fine at this project's traffic
 * and fragile under a shared office NAT. Fetching during static generation means
 * one request per deploy, the number lands in the initial HTML (so it is in the
 * OG card and in view for crawlers), and it costs zero client JavaScript.
 *
 * Failure is silent by design: any error, non-OK status, timeout or unexpected
 * shape renders the fallback count below and nothing else. A star counter must
 * never be able to fail a build or break the page.
 */

/** Last known count, shipped in the markup so the layout never collapses.
 *  It is the REPO'S ACTUAL count (0 as of 2026-10-23), not a rounded-up
 *  placeholder: the page's argument is that every number it prints is
 *  checkable, and a fallback that invents 128 stars would print a lie every
 *  time GitHub is unreachable at build time. Bump it only when the real
 *  count moves. */
const FALLBACK = 0;

const REPO = "kanishka-namdeo/Unown";

export async function getStars(): Promise<number> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(4000),
      // Hourly refresh on ISR; irrelevant on a fully static export.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return FALLBACK;
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "stargazers_count" in body) {
      const n = (body as { stargazers_count: unknown }).stargazers_count;
      if (typeof n === "number" && n >= 0) return n;
    }
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function compact(n: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/**
 * Server component. Renders the fallback immediately and the live count when
 * the fetch resolves, so the hero CTA keeps its width either way.
 */
export async function StarCount() {
  const stars = await getStars();
  return (
    <>
      <span aria-hidden="true" className="text-gold">
        ★
      </span>{" "}
      {compact(stars)}
    </>
  );
}
import { FAQ } from "./faq-data";
import { DEX } from "./dex-data";
import { SITE } from "@/lib/site";
import pkg from "../../../package.json";

/**
 * The page's structured data — one JSON-LD graph, server-rendered, no
 * `next/script` (that is for executable scripts; this is data in a Server
 * Component, per the Next.js JSON-LD guide).
 *
 * Three node types, each with a stated reason to exist:
 *
 *  - `Organization` — the maintainer entity. Google's Organization markup has
 *    no required properties ("add the properties that apply"); `sameAs` wires
 *    the GitHub repo to the site's entity graph, which is how an OSS project
 *    with no legal entity still consolidates into one knowledge-graph node.
 *  - `SoftwareApplication` — the product. `offers.price: 0` is REQUIRED for a
 *    free app ("If the app is available without payment, set offers.price to
 *    0") and `applicationCategory: "DeveloperApplication"` is the supported
 *    value for a developer tool. No `aggregateRating` is emitted because none
 *    exists — fabricating one is the exact self-serving-review spam Google
 *    excludes, on the one page whose argument is that its numbers are
 *    checkable.
 *  - `FAQPage` — the seven questions, serialized from `faq-data.ts`, the same
 *    module the accordion renders, so the markup cannot drift from the
 *    visible answers. Google removed the FAQ *rich result* in 2026 (no
 *    dropdown in SERPs anymore); the markup stays because the OTHER crawlers
 *    that now answer questions — AI assistants, answer engines — read
 *    structured data first, and the content is already authored.
 *
 * Every URL resolves against `SITE`; the version is read from `package.json`
 * at build time so a release moves it without an edit here; `featureList` is
 * the dex's own first practice line per entry — the canonical capability copy,
 * machine-readable, never a hand-typed third summary. The serializer
 * escapes `<` (Next.js's own convention) so a `</script>` inside a string can
 * never terminate the tag early. Pinned by `e2e/seo.spec.ts`, which parses
 * every emitted graph and asserts the required properties.
 */
const ORG_ID = `${SITE.url}/#organization`;

const graph: Record<string, unknown>[] = [
  {
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE.name,
    url: SITE.url,
    logo: `${SITE.url}/logo.svg`,
    sameAs: [SITE.repo],
    description:
      "The maintainers of Unown, an open-source terminal coding agent with tiered memory and a verify-gated self-improving harness.",
  },
  {
    "@type": "SoftwareApplication",
    name: SITE.name,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Linux, macOS, Windows",
    softwareVersion: pkg.version,
    url: SITE.url,
    codeRepository: SITE.repo,
    license: SITE.license,
    isAccessibleForFree: true,
    description:
      "An open-source terminal coding agent with four-tier memory, AutoDreaming and a verify-gated self-improving harness, built on the pi coding agent. Works with any OpenAI-compatible model.",
    image: `${SITE.url}${SITE.ogImage.url}`,
    screenshot: `${SITE.url}${SITE.ogImage.url}`,
    featureList: DEX.map((e) => e.practice[0]),
    author: { "@id": ORG_ID },
    offers: {
      "@type": "Offer",
      price: 0,
      priceCurrency: "USD",
      url: SITE.url,
    },
  },
  {
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  },
];

/** Serialize with `<` escaped — see the module comment. */
const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(
  /</g,
  "\\u003c",
);

export function LandingJsonLd() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

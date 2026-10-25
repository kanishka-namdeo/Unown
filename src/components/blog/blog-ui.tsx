import type { BlogPost, BlogType } from "./blog-data";
import { SITE } from "@/lib/site";

/* ------------------------------------------------------------------ */
/* small shared pieces (server components — no client islands needed)  */
/* ------------------------------------------------------------------ */

/** The type chip: one word in the console grammar. Colors stay in the
 *  palette tokens (gold text on panel) instead of per-type hues — the type
 *  is metadata, not a section theme. */
export function TypeChip({ type }: { type: BlogType }) {
  return <span className="gb-label text-[8px] text-gold">{type}</span>;
}

/** Tags print as plain chips, not links: with a handful of posts there is no
 *  tag page worth its own URL yet (the decision, with the field survey
 *  behind it, is in docs/landing-research.md — "2026-10-25 — the blog"). */
export function TagChips({ tags }: { tags: string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Tags">
      {tags.map((t) => (
        <li key={t} className="gb-label text-[8px] text-faint">
          #{t}
        </li>
      ))}
    </ul>
  );
}

/** `2026-10-25` -> `25 Oct 2026`, built by hand the way the changelog rail
 *  does it: `toLocaleDateString` reads the runtime locale, so a prerender on
 *  a UTC server and a hydration in another-locale browser could disagree. */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]?.slice(0, 3)} ${y}`;
}

/** The meta row every post surface prints: date, reading time, type. */
export function PostMeta({ post }: { post: BlogPost }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11.5px] text-faint">
      <time dateTime={post.lastmod ?? post.date} className="text-dim">
        {shortDate(post.date)}
      </time>
      <span>{post.readingMinutes} min read</span>
      <TypeChip type={post.type} />
      {post.lastmod && post.lastmod !== post.date ? (
        <span title={`Updated ${post.lastmod}`}>updated {shortDate(post.lastmod)}</span>
      ) : null}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* structured data                                                     */
/* ------------------------------------------------------------------ */

/**
 * One BlogPosting node per post page, server-rendered the way the landing
 * page's graph is (`<` escaped so the script tag can never break out of
 * itself). Same refusal as the landing: no invented numbers, no aggregate
 * ratings — the node says what a post factually is and links the repo.
 */
export function BlogPostingJsonLd({ post }: { post: BlogPost }) {
  const node = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.lastmod ?? post.date,
    keywords: post.tags.join(", "),
    articleSection: post.type,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE.url}/blog/${post.slug}`,
    },
    author: {
      "@type": "Organization",
      name: SITE.name,
      url: SITE.url,
    },
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      url: SITE.url,
      logo: { "@type": "ImageObject", url: `${SITE.url}/logo.svg` },
    },
    isPartOf: { "@type": "Blog", name: "Unown blog", "@id": `${SITE.url}/blog` },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(node).replace(/</g, "\\u003c"),
      }}
    />
  );
}

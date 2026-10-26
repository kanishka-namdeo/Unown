// Blog page tests — the index and post pages, pinned against the generated
// data the way the landing suites pin their bands.
//
// What these pin:
//   - the index lists every published post, newest first, each entry
//     carrying its date/reading-time/type meta row, its title link, its
//     description and its tags;
//   - the RSS chip points at the generated static feed;
//   - the post page renders the title as the h1, the body HTML inside the
//     prose wrapper, the BlogPosting JSON-LD, and prev/next links that walk
//     the SAME order the index lists;
//   - generateStaticParams enumerates the data and the metadata carries the
//     per-post title/description/canonical (the SEO surface e2e/seo.spec.ts
//     and blog.spec.ts pin against the served page).
//
// Rendered under the global happy-dom preload. The pages are server
// components with no client islands except the shared chrome, so they render
// synchronously; the layout's CSS imports are bun-test-safe (the landing
// composition root already imports landing.css under this preload).

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

const BlogIndexPage = (await import("../page")).default;
const BlogPostPage = (await import("../[slug]/page")).default;
const { generateStaticParams, generateMetadata } = await import("../[slug]/page");
const BlogLayout = (await import("../layout")).default;
const { metadata: blogMetadata } = await import("../layout");
const { BLOG_POSTS, BLOG_TOTAL_POSTS } = await import("@/components/blog/blog-data");

afterEach(() => {
  cleanup();
});

describe("blog layout (the chrome every blog route shares)", () => {
  test("the compact header, the prefixed footer, and the shared metadata", () => {
    const { container } = render(
      <BlogLayout>
        <p>the article goes here</p>
      </BlogLayout>,
    );

    // The header: the wordmark is the way home and carries the beta badge
    // and the blog tag — the same console, not a second design system.
    const home = container.querySelector('a[href="/"]');
    expect(home?.textContent).toContain("Beta");
    expect(home?.textContent).toContain("blog");
    // The CTA jumps to the landing page's quickstart, not a blog-local one.
    expect(container.querySelector('a[href="/#quickstart"]')).toBeTruthy();

    // The footer renders with the anchorPrefix: every in-page anchor the
    // landing footer owns resolves to the landing page from /blog/* — the
    // whole reason the prop exists (a bare #showcase would die as
    // /blog#showcase).
    expect(container.querySelector('a[href="/#showcase"]')).toBeTruthy();
    expect(container.querySelector('a[href="/#alphabet"]')).toBeTruthy();
    expect(container.querySelector('a[href="/#quickstart"]')).toBeTruthy();
    expect(container.querySelector('a[href="/#changelog"]')).toBeTruthy();
    // The blog link itself stays absolute — no prefix.
    expect(container.querySelector('a[href="/blog"]')).toBeTruthy();

    // The shared metadata: the /blog canonical and the RSS alternate that
    // makes the generated static feed discoverable.
    expect(blogMetadata.alternates?.canonical).toBe("/blog");
    expect(blogMetadata.alternates?.types?.["application/rss+xml"]).toBe("/feed.xml");
  });
});

const renderPost = async (slug: string) => {
  return render(await BlogPostPage({ params: Promise.resolve({ slug }) }));
};

describe("blog index (/blog)", () => {
  test("one h1, every published post listed, newest first", () => {
    const { container } = render(<BlogIndexPage />);
    const h1 = container.querySelector("h1");
    expect(h1?.textContent?.trim()).toBe("Blog");
    const entries = [...container.querySelectorAll("li.blog-entry")];
    expect(entries.length).toBe(BLOG_TOTAL_POSTS);
    // The list is date-desc (slug-asc inside a day): the rendered order IS
    // the data order — a reshuffled index would fail here.
    const listedTitles = entries.map((e) => e.querySelector("h2 a")?.textContent?.trim());
    expect(listedTitles).toEqual(BLOG_POSTS.map((p) => p.title));
  });

  test("each entry carries the meta row, the title link, the description and the tags", () => {
    const { container } = render(<BlogIndexPage />);
    for (const post of BLOG_POSTS) {
      const entry = [...container.querySelectorAll("li.blog-entry")].find(
        (e) => e.querySelector("h2 a")?.getAttribute("href") === `/blog/${post.slug}`,
      );
      expect(entry).toBeTruthy();
      // The meta row prints the ISO date as a <time datetime=...> and the
      // derived reading time.
      expect(entry!.querySelector(`time[dateTime="${post.date}"]`)).toBeTruthy();
      expect(entry!.textContent).toContain(`${post.readingMinutes} min read`);
      expect(entry!.textContent).toContain(post.type);
      expect(entry!.textContent).toContain(post.description);
      for (const t of post.tags) expect(entry!.textContent).toContain(`#${t}`);
    }
  });

  test("the RSS chip points at the generated static feed", () => {
    const { container } = render(<BlogIndexPage />);
    const feed = container.querySelector('a[href="/feed.xml"]');
    expect(feed?.textContent).toContain("RSS");
  });
});

describe("blog post (/blog/[slug])", () => {
  test("the newest post's title is the h1 and its body renders inside the prose wrapper", async () => {
    const post = BLOG_POSTS[0];
    const { container } = await renderPost(post.slug);
    const h1 = container.querySelector("h1");
    expect(h1?.textContent?.trim()).toBe(post.title);
    // The rendered markdown reached the DOM — structural pins, not byte
    // equality: a DOM serializer's quoting of text nodes and pre-block
    // whitespace is the serializer's business, and pinning it buys nothing.
    // (happy-dom was observed re-escaping apostrophes and reflowing <pre>
    // interior whitespace; the landing suites pin content, not bytes.)
    const prose = container.querySelector(".prose-unown");
    expect(prose?.innerHTML.length).toBeGreaterThan(200);
    expect(prose?.querySelectorAll("h2").length).toBeGreaterThan(1);
    // The embeds the post declares actually render.
    if (post.media.some((m) => m.endsWith(".mp4"))) {
      expect(prose?.querySelector("video")).toBeTruthy();
    }
  });

  test("the markdown renderer's feature set is exercised on a post that carries it", async () => {
    // This gate must not ride BLOG_POSTS[0]: a release post can legitimately
    // land without a table (2026-10-26, the chaos round did, and the old
    // newest-post coupling turned that into a red suite). The rich fixture is
    // pinned by slug so an authoring choice cannot hollow the renderer gate.
    const post = BLOG_POSTS.find((p) => p.slug === "2026-10-26-the-sota-memory-eval-round");
    expect(post).toBeTruthy();
    const { container } = await renderPost(post!.slug);
    const prose = container.querySelector(".prose-unown");
    expect(prose?.querySelectorAll("h2").length).toBeGreaterThan(1);
    expect(prose?.querySelector("table")).toBeTruthy();
    expect(prose?.querySelector("pre code")).toBeTruthy();
    expect(prose?.querySelector("img")).toBeTruthy();
    // And the rendered body is THIS post's: a distinctive sentence survives.
    expect(prose?.textContent).toContain("four-tier");
  });

  test("the BlogPosting JSON-LD rides the page, escaped and complete", async () => {
    const post = BLOG_POSTS[0];
    const { container } = await renderPost(post.slug);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).toBeTruthy();
    const parsed = JSON.parse(script!.textContent ?? "");
    expect(parsed["@type"]).toBe("BlogPosting");
    expect(parsed.headline).toBe(post.title);
    expect(parsed.datePublished).toBe(post.date);
    expect(parsed.dateModified).toBe(post.lastmod ?? post.date);
    // The `<` escape the landing graph uses — the script can never break
    // out of itself.
    expect(script!.textContent).not.toContain("<mainEntity");
  });

  test("prev/next walk the index order; the newest post has no newer neighbour", async () => {
    // BLOG_POSTS is date-desc: index+1 is OLDER (prev), index-1 NEWER (next).
    const newest = BLOG_POSTS[0];
    const second = BLOG_POSTS[1];
    const oldest = BLOG_POSTS[BLOG_POSTS.length - 1];

    const { container } = await renderPost(newest.slug);
    const nav = container.querySelector('nav[aria-label="Post navigation"]');
    expect(nav?.querySelector('a[rel="next"]')).toBeNull();
    expect(nav?.querySelector('a[rel="prev"]')?.getAttribute("href")).toBe(`/blog/${second.slug}`);

    cleanup();
    const oldestRender = await renderPost(oldest.slug);
    const oldestNav = oldestRender.container.querySelector('nav[aria-label="Post navigation"]');
    expect(oldestNav?.querySelector('a[rel="prev"]')).toBeNull();
  });

  test("an unknown slug 404s through notFound", async () => {
    expect(async () => {
      await renderPost("1999-01-01-no-such-post");
    }).toThrow();
  });
});

describe("blog post routing + metadata contracts", () => {
  test("generateStaticParams enumerates the data — no invented routes, none missed", () => {
    const params = generateStaticParams();
    expect(params).toEqual(BLOG_POSTS.map((p) => ({ slug: p.slug })));
  });

  test("generateMetadata carries the per-post title, description and canonical", async () => {
    const post = BLOG_POSTS[0];
    const meta = await generateMetadata({ params: Promise.resolve({ slug: post.slug }) });
    expect(meta.title).toBe(post.title);
    expect(meta.description).toBe(post.description);
    expect(meta.alternates?.canonical).toBe(`/blog/${post.slug}`);
    // Next's Metadata.openGraph is a website|article union; the article-only
    // members need the narrow the union never gives a caller for free.
    const og = meta.openGraph as { type?: string; publishedTime?: string; tags?: string[] };
    expect(og.type).toBe("article");
    expect(og.publishedTime).toBe(post.date);
    expect(og.tags).toEqual(post.tags);
  });
});

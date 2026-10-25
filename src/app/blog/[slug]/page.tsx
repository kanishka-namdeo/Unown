import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BLOG_POSTS } from "@/components/blog/blog-data";
import { BlogPostingJsonLd, PostMeta, TagChips } from "@/components/blog/blog-ui";

/**
 * One post. Static by construction: `generateStaticParams` enumerates the
 * generated data and `dynamicParams = false` turns every unknown slug into
 * a 404 at the edge — there is no post-rendering at request time anywhere,
 * which is what lets the standalone build (the e2e lane boots it) and the
 * Vercel deploy serve byte-identical pages.
 *
 * Next 16 note: `params` is a Promise — awaited in both the page and
 * `generateMetadata` (the async Request APIs codemod's whole lesson).
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      publishedTime: post.date,
      modifiedTime: post.lastmod ?? post.date,
      authors: ["Unown"],
      tags: post.tags,
      // og:image comes from the colocated opengraph-image.tsx route — the
      // file convention owns the image set so metadata never fights it.
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const index = BLOG_POSTS.findIndex((p) => p.slug === slug);
  if (index === -1) notFound();
  const post = BLOG_POSTS[index];

  // The list is date-desc; "previous" walks OLDER, "next" walks NEWER —
  // the pair of directions every blog convention agrees on.
  const previous = BLOG_POSTS[index + 1] ?? null;
  const next = BLOG_POSTS[index - 1] ?? null;

  return (
    <article className="py-14 pb-20 sm:py-16">
      {/* The structured data first in the body, the landing page's rule:
          a script tag that never paints. */}
      <BlogPostingJsonLd post={post} />

      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <p className="gb-label text-[9px] text-faint">
            <Link href="/blog" className="hover:text-gold">
              Blog
            </Link>
          </p>

          <div className="mt-4">
            <PostMeta post={post} />
          </div>

          <h1 className="mt-3 text-balance font-display text-3xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-4xl">
            {post.title}
          </h1>

          <p className="mt-4 max-w-2xl text-pretty text-lg leading-relaxed text-dim">
            {post.description}
          </p>

          <div className="mt-4">
            <TagChips tags={post.tags} />
          </div>

          {/* The rendered markdown body. Repo-authored, PR-reviewed content —
              the same trust boundary MDX output has; the generator validated
              every declared media path at build time. */}
          <div
            className="prose-unown mt-10"
            dangerouslySetInnerHTML={{ __html: post.html }}
          />

          {/* Where the conversation happens: the repo. */}
          <p className="mt-12 border-t border-line pt-5 font-mono text-[12px] text-faint">
            Spotted something wrong or worth adding? The record is the repo —{" "}
            <a
              href="https://github.com/kanishka-namdeo/Unown/issues"
              target="_blank"
              rel="noreferrer noopener"
              className="text-gold underline underline-offset-2 hover:text-gold-soft"
            >
              open an issue
            </a>
            .
          </p>

          <nav
            aria-label="Post navigation"
            className="mt-8 grid gap-3 border-t border-line pt-6 sm:grid-cols-2 sm:gap-6"
          >
            {previous ? (
              <Link
                href={`/blog/${previous.slug}`}
                rel="prev"
                className="group border border-line bg-panel-2/40 p-4 transition-colors hover:border-gold"
              >
                <span className="gb-label text-[8px] text-faint">← older</span>
                <span className="mt-1.5 block font-display text-[15px] font-semibold leading-snug text-dim group-hover:text-ink">
                  {previous.title}
                </span>
              </Link>
            ) : (
              <span aria-hidden="true" className="hidden sm:block" />
            )}
            {next ? (
              <Link
                href={`/blog/${next.slug}`}
                rel="next"
                className="group border border-line bg-panel-2/40 p-4 text-right transition-colors hover:border-gold sm:col-start-2"
              >
                <span className="gb-label text-[8px] text-faint">newer →</span>
                <span className="mt-1.5 block font-display text-[15px] font-semibold leading-snug text-dim group-hover:text-ink">
                  {next.title}
                </span>
              </Link>
            ) : null}
          </nav>

          <p className="mt-8">
            <Link
              href="/blog"
              className="link-sweep px-1 font-mono text-[12px] text-dim transition-colors hover:text-ink"
            >
              All posts
            </Link>
          </p>
        </div>
      </div>
    </article>
  );
}

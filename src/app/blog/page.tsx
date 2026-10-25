import Link from "next/link";
import { BLOG_POSTS, BLOG_TOTAL_POSTS } from "@/components/blog/blog-data";
import { PostMeta, TagChips } from "@/components/blog/blog-ui";

/**
 * The blog index: newest first, dates in the margin voice, titles as the
 * links. The list-with-dates shape (the pattern Tailwind's and Lee
 * Robinson's blogs standardized, and the one this repo's own research round
 * settled on — see docs/landing-research.md, "2026-10-25 — the blog"):
 * covers and category tiles earn their complexity when a blog has dozens of
 * posts; a project whose post count is still single-digit owes the reader
 * the whole list, scannable, above the fold.
 *
 * `BLOG_POSTS` is generated from content/blog/ (scripts/landing_blog.mjs) —
 * the page renders data, it never hardcodes a post.
 */
export default function BlogIndexPage() {
  return (
    <section className="border-b border-line py-14 pb-20 sm:py-16">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="max-w-2xl">
          <p className="gb-label text-[10px] text-gold">
            The longhand record · {BLOG_TOTAL_POSTS} posts
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            Blog
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-dim">
            Each feature and release, what it does, and the receipts behind it.
            Written from the repo&rsquo;s own artifacts — the changelog, the docs,
            the benchmark receipts — never beside them.
          </p>
          <p className="mt-4">
            <a
              href="/feed.xml"
              className="gb-label inline-flex items-center border border-gold px-2 py-1 text-[8px] text-gold hover:text-gold-soft"
            >
              RSS feed
            </a>
          </p>
        </div>

        <ol reversed className="mt-12 max-w-3xl" aria-label="Posts, newest first">
          {BLOG_POSTS.map((post) => (
            <li key={post.slug} className="blog-entry">
              <PostMeta post={post} />
              <h2 className="mt-2.5">
                <Link
                  href={`/blog/${post.slug}`}
                  className="font-display text-2xl font-semibold leading-tight text-ink transition-colors hover:text-gold focus:outline-none focus-visible:text-gold"
                >
                  {post.title}
                </Link>
              </h2>
              <p className="mt-2.5 text-pretty leading-relaxed text-dim">
                {post.description}
              </p>
              <div className="mt-3">
                <TagChips tags={post.tags} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

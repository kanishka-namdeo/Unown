import Link from "next/link";
import { Glyph } from "@/components/landing/glyph";
import { BetaBadge, GITHUB_URL, GithubMark, ThemeToggle } from "@/components/landing/shell";

/**
 * The blog's own header: the landing wordmark (which is also the way home),
 * the beta badge the landing header carries, and the same right-hand actions
 * minus the seven in-page anchors — those belong to the one-page marketing
 * argument, not to an article. A visitor reading a post is one click from the
 * home page (the wordmark), one click from the install panel ("Get started"
 * jumps to /#quickstart), and never loses the theme toggle.
 *
 * Server component on purpose: the blog carries no page-level framer motion
 * (no reveal animations to honour or restore), so the only client islands on
 * a blog page are `ThemeToggle` and the footer's Konami hook. A no-JS visitor
 * gets the complete article — the contract the landing page's `<noscript>`
 * restore works for, bought here for free by not animating.
 */
export function BlogNav() {
  return (
    <header className="sticky top-0 z-50 border-b-[3px] border-gold bg-panel/92 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <Glyph
            id="U"
            weight="heavy"
            className="size-7 text-gold"
            label="Unown"
          />
          <span className="gb-label text-[13px] text-ink">unown</span>
          <BetaBadge />
          <span className="gb-label hidden text-[8px] text-faint min-[430px]:inline">
            blog
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2.5">
          <Link
            href="/blog"
            className="gb-label px-1 text-[10px] text-gold"
            aria-current="page"
          >
            Blog
          </Link>
          <ThemeToggle />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Unown on GitHub"
            className="hidden size-9 items-center justify-center text-dim transition-colors hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold lg:inline-flex"
          >
            <GithubMark className="size-[18px]" />
          </a>
          <a
            href="/#quickstart"
            className="gb-btn gb-label hidden px-4 py-2.5 text-[9px] font-normal lg:inline-flex"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}

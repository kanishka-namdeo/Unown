import { ImageResponse } from "next/og";
import { BLOG_POSTS } from "@/components/blog/blog-data";
import { shortDate } from "@/components/blog/blog-ui";

/**
 * The post's social card, drawn at build time (the route prerenders for
 * every generateStaticParams slug). next/og's ImageResponse — the platform
 * primitive on Vercel, no added dependency.
 *
 * The palette is the landing page's own tokens, spelled as literals because
 * Satori resolves styles itself (no CSS cascade, so no var(--color-*)) —
 * every hex below is a palette token that already sits on the GBA 5-bit
 * grid, which keeps the "no hand-picked colours" contract honest even
 * though the palette gate only scans the landing component tree.
 *
 * The font is @vercel/og's bundled default (Noto Sans): the retro faces are
 * OFL webfonts fetched by next/font/google at build time and have no stable
 * file path to read from here — the card reads "unown" through palette,
 * border and layout instead of through a bitmap face.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "The unown blog — how each feature and release works, with the receipts behind it";

/** Palette tokens from src/app/globals.css (the dark scheme — the card is
 *  brand-dark regardless of the viewer's scheme, the way the OG screenshot
 *  of the landing page is). */
const CANVAS = "#102039";
const PANEL = "#182952";
const LINE = "#414a6a";
const INK = "#dee6ee";
const DIM = "#bdcde6";
const FAINT = "#9cb4de";
const GOLD = "#ffc55a";

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export default async function PostOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  // Unknown slugs never reach here (dynamicParams = false on the page); the
  // fallback keeps the route total even if that ever changes.
  const title = post?.title ?? "The Unown blog";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: CANVAS,
          padding: 56,
        }}
      >
        {/* the gold frame bar, the landing header's own furniture */}
        <div style={{ display: "flex", height: 12, backgroundColor: GOLD }} />

        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            backgroundColor: PANEL,
            border: `4px solid ${LINE}`,
            padding: "48px 56px",
            marginTop: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                color: GOLD,
                fontSize: 30,
                letterSpacing: 6,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              unown
            </span>
            <span style={{ color: FAINT, fontSize: 24 }}>
              {post ? shortDate(post.date) : "the blog"}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
            }}
          >
            <span
              style={{
                display: "flex",
                flexWrap: "wrap",
                color: INK,
                fontSize: title.length > 64 ? 46 : 56,
                fontWeight: 700,
                lineHeight: 1.18,
                letterSpacing: -0.5,
                maxWidth: 940,
              }}
            >
              {title}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 18,
              color: DIM,
              fontSize: 22,
            }}
          >
            <span style={{ color: GOLD, textTransform: "uppercase", letterSpacing: 3, fontSize: 18 }}>
              {post?.type ?? "post"}
            </span>
            {post?.tags.map((t) => (
              <span key={t} style={{ color: FAINT }}>
                #{t}
              </span>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            paddingTop: 24,
            color: FAINT,
            fontSize: 20,
          }}
        >
          <span>unown-nine.vercel.app/blog</span>
          <span>{post ? `${post.readingMinutes} min read` : "the longhand record"}</span>
        </div>
      </div>
    ),
    { ...size },
  );
}

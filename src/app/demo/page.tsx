import { AppShell } from "@/components/sigil/app-shell";

/**
 * The live-demo route. `searchParams` is read HERE, server-side, so the
 * `?embed=1` flag reaches the client tree as a PROP — the server render and
 * the hydration render agree and React #418 never fires (the standalone app
 * learned this the hard way: reading window.location.search inside a
 * useState initializer made every ?embed=1 visit a hydration mismatch).
 *
 * Reading searchParams makes this route dynamic (ƒ) — the landing page
 * itself stays fully static.
 */
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.embed) ? params.embed[0] : params.embed;
  const initialEmbed = raw === "1" || raw === "true";
  return <AppShell initialEmbed={initialEmbed} />;
}

import { Suspense } from "react";
import { BazaarProvider } from "@/lib/bazaar/store";
import { BazaarShell } from "@/components/bazaar/shell";

/**
 * The /bazaar live-demo route. Identical contract to /demo (the Sigil Focus
 * app): `?embed=1` is read HERE, server-side, so the flag reaches the client
 * tree as a PROP — the server render and the hydration render agree and
 * React #418 never fires (the standalone app learned this the hard way).
 *
 * In the embedded copy the flag also arms the frame reset channel: the
 * store mounts an embed-only `message` listener for the landing page's
 * Reset button (see store.tsx) — never in the standalone app.
 */
async function PageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const embed = sp.embed === "1";
  return (
    <BazaarProvider embed={embed}>
      <BazaarShell embed={embed} />
    </BazaarProvider>
  );
}

export default function Page(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="min-h-full" />}>
      <PageInner {...props} />
    </Suspense>
  );
}

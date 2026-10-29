import { Suspense } from "react";
import { LedgerShell } from "@/components/ledger/shell";
import { TXNS } from "@/lib/ledger/seed";

/**
 * The /ledger route (the encore page pattern): `?embed=1` is read HERE,
 * server-side, so the flag reaches the client tree as a PROP — the
 * server render and the hydration render agree and React #418 never
 * fires. No cookies, no session: the fixture is a static import, the
 * reset handshake is the shell's window-message listener.
 */
async function PageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const embed = sp.embed === "1";
  return <LedgerShell embed={embed} txns={TXNS} />;
}

export default function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={null}>
      <PageInner searchParams={searchParams} />
    </Suspense>
  );
}

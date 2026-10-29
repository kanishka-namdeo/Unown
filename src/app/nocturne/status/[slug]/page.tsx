import { PublicStatusPage } from "@/components/nocturne/public-status";
import { NocturneProvider } from "@/components/nocturne/nocturne-provider";

/**
 * The PUBLIC status-page route (plan §3.7's tenancy exception) — the
 * one surface that reads WITHOUT authentication. It is mounted
 * under its own `NocturneProvider` with `publicStatus={true}` (the
 * F13 pin, part 3): the anonymous surface must NEVER probe the
 * session at all (a 401 that would log to the console — the live
 * ui-pass lane's zero-console-errors bar); its client path only
 * fetches the public status data. No session cookie is read.
 *
 * The slug is read from the route's params (`/nocturne/status/
 * <slug>` → the matching tenant's status; an unknown slug is the
 * public route's 404 — pinned by the API test).
 */
export default async function NocturneStatusPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <NocturneProvider isPublic>
      <PublicStatusPage slug={slug} />
    </NocturneProvider>
  );
}

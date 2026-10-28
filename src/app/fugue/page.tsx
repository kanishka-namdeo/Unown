import { redirect } from "next/navigation";
import FugueShell from "@/components/fugue/Shell";

/**
 * /fugue - embed entry (PLAN.md sec.7, R2 bazaar hydration pattern).
 * ?embed=1 read server-side and passed as a prop.
 * Without embed, redirect to /fugue/flows.
 */
export default function FuguePage({
  searchParams,
}: {
  searchParams: { embed?: string };
}) {
  const embed = searchParams.embed === "1";
  if (!embed) redirect("/fugue/flows");
  return (
    <FugueShell embed={embed}>
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">
        Fugue embed - switch between Flows / Runs / Stats from your host nav.
      </div>
    </FugueShell>
  );
}

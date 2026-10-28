import { RunsEntry } from "@/components/fugue/entries";

/**
 * /fugue/runs — PLAN.md sec.7. ?embed=1 read server-side, passed as a prop.
 */
export default function RunsPage({
  searchParams,
}: {
  searchParams: { embed?: string };
}) {
  const embed = searchParams.embed === "1";
  return <RunsEntry embed={embed} />;
}

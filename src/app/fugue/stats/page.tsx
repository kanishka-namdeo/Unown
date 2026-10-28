import { StatsEntry } from "@/components/fugue/entries";

/**
 * /fugue/stats — PLAN.md sec.7. ?embed=1 read server-side, passed as a prop.
 */
export default function StatsPage({
  searchParams,
}: {
  searchParams: { embed?: string };
}) {
  const embed = searchParams.embed === "1";
  return <StatsEntry embed={embed} />;
}

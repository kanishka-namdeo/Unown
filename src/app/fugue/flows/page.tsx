import { FlowsEntry } from "@/components/fugue/entries";

/**
 * /fugue/flows - PLAN.md section 7. ?embed=1 read server-side (bazaar hydration
 * pattern) and passed as a prop to the client tree.
 */
export default function FlowsPage({
  searchParams,
}: {
  searchParams: { embed?: string };
}) {
  const embed = searchParams.embed === "1";
  return <FlowsEntry embed={embed} />;
}

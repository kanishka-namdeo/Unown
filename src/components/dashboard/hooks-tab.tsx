"use client";

// Hooks tab: guardrail policy explainer + decision log.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api, qk } from "@/lib/agent-api";
import { timeAgo } from "@/lib/agent-format";
import type { HookName } from "@/lib/agent-types";
import { DecisionBadge, EmptyState, Mono, SectionHeading, StatChip } from "./bits";
import { cn } from "@/lib/utils";

const cardCls = "border-zinc-800 bg-zinc-900/60";

const hookPolicy: { name: HookName; what: string }[] = [
  { name: "SessionStart", what: "Injects the resolved tiered memory into the session context." },
  { name: "UserPromptSubmit", what: "Logs every task prompt and tags the run for note capture." },
  { name: "PreToolUse", what: "Jails paths to the sandbox and denies dangerous bash commands." },
  { name: "PostToolUse", what: "Runs a JS/TS syntax gate on every write/edit and feeds errors back to the agent." },
  { name: "Stop", what: "Harvests a learning note from the finished run and schedules dream checks." },
  { name: "SubagentStop", what: "Same harvest for subagent sessions." },
];

function prettyDetails(raw: string | null): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function HooksTab() {
  const { data } = useQuery({ queryKey: qk.hooks, queryFn: () => api.hooks(200), refetchInterval: 8000 });
  const hooks = data?.hooks ?? [];

  const byHook = React.useMemo(() => {
    const acc = new Map<string, number>();
    for (const h of hooks) acc.set(h.hook, (acc.get(h.hook) ?? 0) + 1);
    return acc;
  }, [hooks]);

  const denies = hooks.filter((h) => h.decision === "deny").length;
  const augments = hooks.filter((h) => h.decision === "augment").length;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="hook policy">
        <SectionHeading
          title="Policy — 6 hook layers"
          sub="every prompt, tool call and stop passes through the guardrails"
        />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {hookPolicy.map((p) => (
            <Card key={p.name} className={cardCls}>
              <CardContent className="flex flex-col gap-1.5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Mono className="text-xs font-semibold text-emerald-400">{p.name}</Mono>
                  <Mono className="text-zinc-400">{byHook.get(p.name) ?? 0}×</Mono>
                </div>
                <p className="text-[11px] leading-4 text-zinc-400">{p.what}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="decision log">
        <SectionHeading
          title="Decision log"
          sub="latest tool-level decisions"
          right={
            <div className="flex flex-wrap items-center gap-1.5">
              <StatChip label="events" value={hooks.length} />
              <StatChip label="denies" value={denies} tone="rose" />
              <StatChip label="augments" value={augments} tone="amber" />
            </div>
          }
        />
        <Card className={cn(cardCls, "mt-3")}>
          <CardContent className="p-0">
            {hooks.length === 0 ? (
              <EmptyState className="m-4" icon={<ShieldCheck />} title="No hook decisions yet" hint="They appear as soon as the agent runs." />
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-[11px] tracking-wider text-zinc-400 uppercase">
                      <th className="px-4 py-2.5 font-medium">When</th>
                      <th className="px-4 py-2.5 font-medium">Hook</th>
                      <th className="px-4 py-2.5 font-medium">Tool</th>
                      <th className="px-4 py-2.5 font-medium">Decision</th>
                      <th className="px-4 py-2.5 font-medium">Reason</th>
                      <th className="px-4 py-2.5 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hooks.map((h, i) => {
                      const hasDetails = !!h.details;
                      return (
                        <tr key={`${h.ts}-${i}`} className="border-b border-zinc-800/60 align-top last:border-0 hover:bg-zinc-900/70">
                          <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-zinc-400 tabular-nums">{timeAgo(h.ts)}</td>
                          <td className="px-4 py-2.5"><Mono className="text-zinc-300">{h.hook}</Mono></td>
                          <td className="px-4 py-2.5"><Mono className="text-zinc-400">{h.tool ?? "—"}</Mono></td>
                          <td className="px-4 py-2.5"><DecisionBadge decision={h.decision} /></td>
                          <td className="max-w-[280px] px-4 py-2.5">
                            <span className={cn("block truncate text-xs", h.decision === "deny" ? "text-rose-300/80" : "text-zinc-400")} title={h.reason ?? ""}>
                              {h.reason ?? "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            {hasDetails ? (
                              <Collapsible>
                                <CollapsibleTrigger className="inline-flex min-h-6 items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
                                  <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                                  json
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <pre className="scroll-thin my-2 max-h-48 max-w-md overflow-auto rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-zinc-400">
                                    {prettyDetails(h.details)}
                                  </pre>
                                </CollapsibleContent>
                              </Collapsible>
                            ) : (
                              <Mono className="text-zinc-400">—</Mono>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

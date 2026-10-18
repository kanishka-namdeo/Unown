"use client";

// Learning Lab tab: self-improvement cycles, proposed patches, and runs.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Play, RefreshCw, Sparkles, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, qk } from "@/lib/agent-api";
import { formatDuration, formatTokens, timeAgo, truncateMiddle } from "@/lib/agent-format";
import type { Improvement } from "@/lib/agent-types";
import {
  CycleStatusBadge,
  EmptyState,
  ImprovementStatusBadge,
  Mono,
  Pill,
  RunKindBadge,
  RunStatusBadge,
  SectionHeading,
} from "./bits";
import { RunDetailDialog } from "./run-detail";
import { cn } from "@/lib/utils";

const cardCls = "border-zinc-800 bg-zinc-900/60";

function ImprovementCard({ imp }: { imp: Improvement }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <Card className={cardCls}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ImprovementStatusBadge status={imp.status} />
          <Mono className="text-zinc-400">{imp.task_id}</Mono>
          <Pill tone="zinc">iter {imp.iteration}</Pill>
          <Pill tone="emerald">→ {imp.target_tier}</Pill>
          <span className="ml-auto font-mono text-[10px] text-zinc-400">{timeAgo(imp.created_at)}</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">diagnosis</p>
            <p
              className={cn(
                "mt-1 text-xs leading-5 text-zinc-300",
                !expanded && "line-clamp-4"
              )}
            >
              {imp.diagnosis}
            </p>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
            >
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {expanded ? "collapse" : "expand"}
            </button>
          </div>
          <div>
            <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">proposal</p>
            <p className="mt-1 text-xs leading-5 text-zinc-300">{imp.proposal}</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">memory patch</p>
            <span className="font-mono text-[10px] text-zinc-400">
              {imp.score_before} → {imp.score_after}
            </span>
          </div>
          <pre className="scroll-thin mt-1 max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-emerald-300/90">
            {imp.patch}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

export function LearningLabTab() {
  const { data: cyclesData } = useQuery({ queryKey: qk.cycles, queryFn: api.cycles, refetchInterval: 8000 });
  const { data: improvementsData } = useQuery({ queryKey: qk.improvements, queryFn: api.improvements, refetchInterval: 8000 });
  const { data: runsData } = useQuery({ queryKey: qk.runs, queryFn: () => api.runs({ limit: 200 }), refetchInterval: 8000 });

  const [selectedCycleId, setSelectedCycleId] = React.useState<string | null>(null);
  const [runDialogId, setRunDialogId] = React.useState<string | null>(null);
  const [runDialogOpen, setRunDialogOpen] = React.useState(false);

  const cycles = cyclesData?.cycles ?? [];
  const selectedCycle = cycles.find((c) => c.id === selectedCycleId) ?? null;
  const improvements = (improvementsData?.improvements ?? []).filter(
    (i) => !selectedCycleId || i.cycle_id === selectedCycleId
  );
  const runs = (runsData?.runs ?? []).filter(
    (r) => !selectedCycleId || r.cycle_id === selectedCycleId || (selectedCycle && r.task_id === selectedCycle.task_id)
  );

  const openRun = (id: string) => {
    setRunDialogId(id);
    setRunDialogOpen(true);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Cycles timeline (left) */}
      <section aria-label="improvement cycles" className="lg:col-span-1">
        <SectionHeading
          title="Cycles"
          sub={selectedCycle ? "filtered — click again to clear" : "mine → patch → validate → ship"}
          right={
            selectedCycle && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setSelectedCycleId(null)}>
                clear
              </Button>
            )
          }
        />
        <div className="mt-3 flex flex-col gap-2">
          {cycles.length === 0 ? (
            <EmptyState icon={<RefreshCw />} title="No cycles yet" hint="Trigger a task from Overview to start learning." />
          ) : (
            cycles.map((c) => {
              const active = c.id === selectedCycleId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCycleId(active ? null : c.id)}
                  className={cn(
                    "relative rounded-lg border p-3 text-left transition-colors",
                    active
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <CycleStatusBadge status={c.status} />
                    <span className="text-xs font-medium text-zinc-200">{c.task_name ?? c.task_id}</span>
                    <Mono className="text-zinc-400">iter {c.iteration}</Mono>
                  </div>
                  {c.summary && <p className="mt-1.5 text-[11px] leading-4 text-zinc-400">{c.summary}</p>}
                  <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-zinc-400">
                    <span>{timeAgo(c.created_at)}</span>
                    {c.shipped > 0 && <span className="text-emerald-500/80">{c.shipped} shipped</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* Improvements + runs (right) */}
      <section className="flex flex-col gap-6 lg:col-span-2">
        <div aria-label="improvements">
          <SectionHeading
            title="Improvements"
            sub={selectedCycle ? `patches from ${selectedCycle.task_name ?? selectedCycle.task_id}` : "every memory patch the harness proposed"}
          />
          <div className="mt-3 flex flex-col gap-3">
            {improvements.length === 0 ? (
              <EmptyState
                icon={<Sparkles />}
                title="No improvements yet"
                hint="When a baseline fails, the harness diagnoses it and proposes a memory patch."
              />
            ) : (
              improvements.map((imp) => <ImprovementCard key={imp.id} imp={imp} />)
            )}
          </div>
        </div>

        <div aria-label="runs">
          <SectionHeading
            title="Runs"
            sub={selectedCycle ? "runs of the selected cycle" : "baseline · candidate · regression · interactive"}
            right={<Mono className="text-zinc-400">{runs.length} runs</Mono>}
          />
          <Card className={cn(cardCls, "mt-3")}>
            <CardContent className="p-0">
              {runs.length === 0 ? (
                <EmptyState className="m-4" icon={<Play />} title="No runs yet — trigger a task from Overview" />
              ) : (
                <div className="scroll-thin overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-left text-[11px] tracking-wider text-zinc-400 uppercase">
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Kind</th>
                        <th className="px-4 py-2.5 font-medium">Task</th>
                        <th className="px-4 py-2.5 font-medium">Tools</th>
                        <th className="px-4 py-2.5 font-medium">Tokens</th>
                        <th className="px-4 py-2.5 font-medium">Duration</th>
                        <th className="px-4 py-2.5 font-medium">Sandbox</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr
                          key={r.id}
                          onClick={() => openRun(r.id)}
                          className="cursor-pointer border-b border-zinc-800/60 last:border-0 hover:bg-zinc-900/70"
                        >
                          <td className="px-4 py-2.5"><RunStatusBadge status={r.status} /></td>
                          <td className="px-4 py-2.5"><RunKindBadge kind={r.kind} /></td>
                          <td className="px-4 py-2.5"><Mono className="text-zinc-300">{r.task_id}</Mono></td>
                          <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-zinc-400">{r.tool_calls}</td>
                          <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-zinc-400">
                            {formatTokens(r.tokens_in)}/{formatTokens(r.tokens_out)}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-zinc-400">
                            {formatDuration((r.ended_at ?? Date.now()) - r.started_at)}
                          </td>
                          <td className="px-4 py-2.5" title={r.sandbox_id ?? ""}>
                            <Mono className="text-zinc-400">{truncateMiddle(r.sandbox_id, 20)}</Mono>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
            <TerminalSquare className="size-3.5" />
            click a row for the full transcript, prompt and verification log
          </p>
        </div>
      </section>

      <RunDetailDialog runId={runDialogId} open={runDialogOpen} onOpenChange={setRunDialogOpen} />
    </div>
  );
}

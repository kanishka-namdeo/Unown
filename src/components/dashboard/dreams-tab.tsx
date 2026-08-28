"use client";

// Dreams tab: AutoDream runs, their outputs and consumed notes.

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Moon, Notebook, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, mutations, qk } from "@/lib/agent-api";
import { timeAgo } from "@/lib/agent-format";
import type { Dream } from "@/lib/agent-types";
import { DreamStatusBadge, EmptyState, Mono, Pill, SectionHeading, StatChip } from "./bits";
import { cn } from "@/lib/utils";

const cardCls = "border-zinc-800 bg-zinc-900/60";

function DreamCard({ dream }: { dream: Dream }) {
  const [expanded, setExpanded] = React.useState(false);
  const { data: notesData } = useQuery({
    queryKey: qk.dreamNotes(dream.id),
    queryFn: () => api.dreamNotes(dream.id),
    enabled: expanded,
  });

  const notes = notesData?.notes ?? [];

  return (
    <Card className={cardCls}>
      <CardContent className="flex flex-col gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-wrap items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <DreamStatusBadge status={dream.status} />
          <Mono className="text-zinc-500">{dream.id.slice(0, 8)}</Mono>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300">
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {expanded ? "collapse" : "expand"}
          </span>
          <Mono className="text-zinc-600">{timeAgo(dream.started_at)}</Mono>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <StatChip label="notes in" value={dream.notes_in} tone="zinc" />
          <StatChip label="merged" value={dream.entries_merged} tone="emerald" />
          <StatChip label="pruned" value={dream.entries_pruned} tone="rose" />
          <StatChip label="added" value={dream.entries_added} tone="amber" />
        </div>

        {dream.note && <p className="text-xs text-zinc-400">{dream.note}</p>}

        {expanded && (
          <div className="flex flex-col gap-3 border-t border-zinc-800 pt-3">
            {dream.output && (
              <div>
                <p className="mb-1 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">dream output</p>
                <pre className="scroll-thin max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-300">
                  {dream.output}
                </pre>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
                consumed notes <span className="text-zinc-700">({notes.length})</span>
              </p>
              {notes.length === 0 ? (
                <p className="text-xs text-zinc-600">no notes recorded for this dream</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {notes.map((n) => (
                    <li key={n.id} className="rounded-md border border-zinc-800/70 bg-zinc-950/50 px-3 py-2">
                      <p className="text-[11px] leading-4 text-zinc-400">{n.content}</p>
                      <Mono className="mt-1 block text-zinc-700">run {n.run_id.slice(0, 8)} · {timeAgo(n.created_at)}</Mono>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DreamsTab() {
  const queryClient = useQueryClient();
  const { data: dreamsData } = useQuery({ queryKey: qk.dreams, queryFn: api.dreams, refetchInterval: 8000 });
  const { data: notesData } = useQuery({ queryKey: qk.notes, queryFn: () => api.notes(40), refetchInterval: 8000 });

  const runDream = useMutation({
    mutationFn: () => mutations.dreamRun(),
    onSuccess: (d) => {
      if ("skipped" in d && d.skipped) {
        toast.info("AutoDream skipped", { description: String(d.skipped) });
      } else {
        toast.success("AutoDream started", { description: `Consolidating ${d.pendingNotes ?? 0} pending notes.` });
      }
      queryClient.invalidateQueries({ queryKey: qk.dreams });
      queryClient.invalidateQueries({ queryKey: qk.notes });
      queryClient.invalidateQueries({ queryKey: qk.overview });
    },
    onError: (err: Error) => toast.error("AutoDream failed", { description: err.message }),
  });

  const dreams = dreamsData?.dreams ?? [];
  const pendingNotes = (notesData?.notes ?? []).filter((n) => n.dream_id === null);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="flex flex-col gap-3 lg:col-span-2" aria-label="dreams">
        <SectionHeading
          title="Dreams"
          sub="AutoDream consolidates session notes into memory while the agent idles"
          right={
            <Button
              size="sm"
              variant="outline"
              disabled={runDream.isPending}
              onClick={() => runDream.mutate()}
              className="h-9 gap-2 border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            >
              <Play className="size-3.5" />
              Run AutoDream
            </Button>
          }
        />
        {dreams.length === 0 ? (
          <EmptyState
            icon={<Moon />}
            title="No dreams yet"
            hint="Dreams trigger when ≥3 undreamed notes accumulate, or press Run AutoDream."
          />
        ) : (
          dreams.map((d) => <DreamCard key={d.id} dream={d} />)
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="pending notes">
        <SectionHeading
          title="Pending notes"
          sub="undreamed observations from recent runs"
          right={<Pill tone={pendingNotes.length > 0 ? "amber" : "zinc"}>{pendingNotes.length} waiting</Pill>}
        />
        {pendingNotes.length === 0 ? (
          <EmptyState icon={<Notebook />} title="No pending notes" hint="Notes are captured after each run completes." />
        ) : (
          <div className="scroll-thin flex max-h-[640px] flex-col gap-2 overflow-y-auto pr-1">
            {pendingNotes.map((n) => (
              <Card key={n.id} className={cn(cardCls, "py-0")}>
                <CardContent className="p-3">
                  <p className="text-[11px] leading-4 text-zinc-400">{n.content}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Mono className="text-zinc-700">run {n.run_id.slice(0, 8)}</Mono>
                    <Mono className="text-zinc-700">· {timeAgo(n.created_at)}</Mono>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <p className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600">
          <Sparkles className="size-3.5" />
          merged notes become project-memory rules; stale ones get pruned
        </p>
      </section>
    </div>
  );
}

"use client";

// Memory tab: tiered memory cards, version history, rollback, dream-now.

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, History, Layers, Moon, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, mutations, qk } from "@/lib/agent-api";
import { timeAgo } from "@/lib/agent-format";
import type { MemoryTier, MemoryTierInfo } from "@/lib/agent-types";
import { ChangedByBadge, EmptyState, Mono, Pill, SectionHeading } from "./bits";
import { cn } from "@/lib/utils";

const cardCls = "border-zinc-800 bg-zinc-900/60";

const tierMeta: Record<MemoryTier, { label: string; hint: string }> = {
  policy: { label: "Tier 0 · Policy", hint: "non-negotiable guardrails — always applied" },
  project: { label: "Tier 1 · Project", hint: "shared lessons for this repo" },
  user: { label: "Tier 2 · User", hint: "per-user preferences across projects" },
  local: { label: "Tier 3 · Local", hint: "most specific wins — highest precedence" },
};

function TierCard({
  tier,
  selected,
  onSelect,
}: {
  tier: MemoryTierInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const meta = tierMeta[tier.tier];
  return (
    <Card
      className={cn(
        "cursor-pointer transition-colors",
        selected ? "border-emerald-500/50 bg-emerald-500/5" : cn(cardCls, "hover:border-zinc-700")
      )}
      onClick={onSelect}
    >
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Layers className={cn("size-4", selected ? "text-emerald-400" : "text-zinc-500")} />
            {meta.label}
          </span>
          <Pill tone={selected ? "emerald" : "zinc"}>v{tier.version}</Pill>
        </div>
        <p className="text-[11px] text-zinc-500">{meta.hint}</p>
        <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-600">
          <span>{tier.chars} chars</span>
          <span>·</span>
          <span>updated {timeAgo(tier.updatedAt)}</span>
        </div>
        <div>
          <pre
            className={cn(
              "scroll-thin overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-zinc-400",
              expanded ? "max-h-96" : "max-h-24 [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
            )}
          >
            {tier.content}
          </pre>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {expanded ? "collapse" : "expand"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export function MemoryTab() {
  const queryClient = useQueryClient();
  const { data: overview } = useQuery({ queryKey: qk.overview, queryFn: api.overview, refetchInterval: 5000 });
  const { data: memoryData } = useQuery({ queryKey: qk.memory, queryFn: api.memory, refetchInterval: 8000 });
  const [selectedTier, setSelectedTier] = React.useState<MemoryTier>("project");

  const { data: historyData } = useQuery({
    queryKey: qk.memoryHistory(selectedTier),
    queryFn: () => api.memoryHistory(selectedTier),
    refetchInterval: 8000,
  });

  const [confirmRollback, setConfirmRollback] = React.useState<{ tier: MemoryTier; version: number } | null>(null);

  const rollback = useMutation({
    mutationFn: (v: { tier: MemoryTier; version: number }) => mutations.rollback(v.tier, v.version),
    onSuccess: (_d, v) => {
      toast.success("Rolled back", { description: `${v.tier} memory restored to v${v.version}.` });
      queryClient.invalidateQueries({ queryKey: qk.memory });
      queryClient.invalidateQueries({ queryKey: qk.overview });
      // history for every tier is cheap to refresh
      (["policy", "project", "user", "local"] as MemoryTier[]).forEach((t) =>
        queryClient.invalidateQueries({ queryKey: qk.memoryHistory(t) })
      );
    },
    onError: (err: Error) => toast.error("Rollback failed", { description: err.message }),
  });

  const dreamNow = useMutation({
    mutationFn: () => mutations.dreamRun(),
    onSuccess: (d) => {
      if ("skipped" in d && d.skipped) {
        toast.info("AutoDream skipped", { description: String(d.skipped) });
      } else {
        toast.success("AutoDream started", { description: `Consolidating ${d.pendingNotes ?? 0} pending notes.` });
      }
      queryClient.invalidateQueries({ queryKey: qk.dreams });
      queryClient.invalidateQueries({ queryKey: qk.overview });
    },
    onError: (err: Error) => toast.error("AutoDream failed", { description: err.message }),
  });

  const tiers = memoryData?.tiers ?? [];
  const history = historyData?.history ?? [];
  const currentVersion = tiers.find((t) => t.tier === selectedTier)?.version;
  const pendingNotes = overview?.kpis.notes.pending ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Tiered memory"
        sub={`${memoryData?.resolvedChars ?? 0} chars resolved into every system prompt`}
        right={
          <Button
            size="sm"
            variant="outline"
            disabled={dreamNow.isPending}
            onClick={() => dreamNow.mutate()}
            className="h-9 gap-2 border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
          >
            <Moon className="size-3.5" />
            Dream now
            {pendingNotes > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">{pendingNotes}</span>
            )}
          </Button>
        }
      />

      <section aria-label="memory tiers" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tiers.length === 0 ? (
          <EmptyState className="md:col-span-2 xl:col-span-4" icon={<Layers />} title="No memory loaded" />
        ) : (
          tiers.map((t) => (
            <TierCard
              key={t.tier}
              tier={t}
              selected={t.tier === selectedTier}
              onSelect={() => setSelectedTier(t.tier)}
            />
          ))
        )}
      </section>

      <section aria-label="version history">
        <SectionHeading
          title={`${selectedTier} history`}
          sub="who changed what — seed · harness · autodream · manual · rollback"
          right={<Mono className="text-zinc-600">{history.length} versions</Mono>}
        />
        <div className="mt-3 flex flex-col gap-3">
          {history.length === 0 ? (
            <EmptyState icon={<History />} title="No history for this tier yet" />
          ) : (
            history.map((h) => {
              const isCurrent = h.version === currentVersion;
              const canRollback = !isCurrent;
              return (
                <Card key={h.id} className={cn(cardCls, isCurrent && "border-emerald-500/30")}>
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={isCurrent ? "emerald" : "zinc"}>v{h.version}</Pill>
                      {isCurrent && <Pill tone="outline">current</Pill>}
                      <ChangedByBadge changedBy={h.changed_by} />
                      <Mono className="text-zinc-600">{timeAgo(h.created_at)}</Mono>
                      {canRollback && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-8 gap-1.5 px-2 text-xs text-zinc-400 hover:text-zinc-100"
                          disabled={rollback.isPending}
                          onClick={() => setConfirmRollback({ tier: h.tier, version: h.version })}
                        >
                          <RotateCcw className="size-3.5" />
                          Rollback
                        </Button>
                      )}
                    </div>
                    {h.note && <p className="text-xs text-zinc-400">{h.note}</p>}
                    <pre className="scroll-thin max-h-28 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-zinc-500">
                      {h.content}
                    </pre>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </section>

      <AlertDialog open={confirmRollback !== null} onOpenChange={(v) => !v && setConfirmRollback(null)}>
        <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback {confirmRollback?.tier} memory to v{confirmRollback?.version}?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              A new version will be created with the old content. The current content stays in history, so this is
              always reversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
              onClick={() => {
                if (confirmRollback) rollback.mutate(confirmRollback);
                setConfirmRollback(null);
              }}
            >
              Rollback
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

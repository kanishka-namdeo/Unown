"use client";

// Sandboxes tab: isolated workspaces where verified agent runs execute.
// The engine caps the list at 60; the sandbox-gc router job prunes stale ones.

import { useQuery } from "@tanstack/react-query";
import { Box, FileIcon, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, qk } from "@/lib/agent-api";
import { timeAgo } from "@/lib/agent-format";
import type { Sandbox } from "@/lib/agent-types";
import { EmptyState, Mono, SectionHeading, StatChip } from "./bits";

const cardCls = "border-zinc-800 bg-zinc-900/60";

function SandboxCard({ sandbox }: { sandbox: Sandbox }) {
  // Unlabeled workspaces (console-spun agents) fall back to the id prefix.
  const label = sandbox.label || sandbox.id.slice(0, 12);
  return (
    <Card className={cardCls}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10">
            <Box className="size-4 text-emerald-400" />
          </span>
          <p className="min-w-0 truncate font-mono text-sm font-semibold text-zinc-200" title={sandbox.id}>
            {label}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Mono className="min-w-0 truncate text-zinc-400">{sandbox.id}</Mono>
          <span className="inline-flex items-center gap-1 text-xs text-zinc-300">
            <FileIcon className="size-3.5 shrink-0 text-emerald-400/80" />
            <span className="font-mono tabular-nums">{sandbox.files}</span>
            <span className="text-zinc-400">files</span>
          </span>
          <Mono className="text-zinc-400">{timeAgo(sandbox.createdAt)}</Mono>
        </div>
      </CardContent>
    </Card>
  );
}

export function SandboxesTab() {
  const { data: sandboxesData, isLoading } = useQuery({
    queryKey: qk.sandboxes,
    queryFn: api.sandboxes,
    refetchInterval: 8000,
  });

  const sandboxes = sandboxesData?.sandboxes ?? [];
  const totalFiles = sandboxes.reduce((acc, s) => acc + s.files, 0);
  const oldestCreatedAt =
    sandboxes.length > 0 ? Math.min(...sandboxes.map((s) => s.createdAt)) : null;

  return (
    <section className="flex flex-col gap-3" aria-label="sandboxes">
      <SectionHeading
        title="Sandboxes"
        sub="isolated workspaces where verified agent runs execute"
      />
      <p className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
        <Timer className="size-3.5 shrink-0" />
        the sandbox-gc router job prunes stale workspaces every 15 minutes
      </p>

      {isLoading ? (
        <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-24" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <StatChip label="sandboxes" value={sandboxes.length} tone="emerald" />
          <StatChip label="total files" value={totalFiles} tone="zinc" />
          <StatChip
            label="oldest"
            value={oldestCreatedAt === null ? "—" : timeAgo(oldestCreatedAt)}
            tone="zinc"
          />
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className={cardCls}>
              <CardContent className="flex flex-col gap-3 p-4">
                <Skeleton className="h-7 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : sandboxes.length === 0 ? (
        <EmptyState
          icon={<Box />}
          title="No sandboxes yet"
          hint="Workspaces appear when the harness runs a task cycle or the console spins up an agent."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sandboxes.map((s) => (
            <SandboxCard key={s.id} sandbox={s} />
          ))}
        </div>
      )}
    </section>
  );
}

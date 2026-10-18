"use client";

// Task detail dialog: the full benchmark task — description, provenance,
// seeded files and the tamper-checked verify script — from GET /api/tasks/:id.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, FlaskConical, ListChecks, Play, ScrollText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, qk } from "@/lib/agent-api";
import { timeAgo } from "@/lib/agent-format";
import { DifficultyStars, Mono, Pill } from "./bits";
import { cn } from "@/lib/utils";

const cardCls = "border-zinc-800 bg-zinc-900/60";

export function TaskDetailDialog({
  taskId,
  open,
  onOpenChange,
  onRunCycle,
  runPending,
}: {
  taskId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRunCycle?: (taskId: string) => void;
  runPending?: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: qk.task(taskId ?? ""),
    queryFn: () => api.task(taskId as string),
    enabled: open && !!taskId,
  });

  const task = data?.task;
  const fileEntries = Object.entries(task?.files ?? {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-thin max-h-[88vh] max-w-3xl overflow-y-auto border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 font-mono text-sm">
            <FlaskConical className="size-4 text-emerald-400" />
            <span className="text-zinc-200">{task?.name ?? (taskId ? `${taskId.slice(0, 12)}` : "task")}</span>
            {task && <Pill tone="zinc">{task.category}</Pill>}
            {task?.origin && task.origin !== "seed" && <Pill tone="violet">{task.origin}</Pill>}
            {task?.status && <Pill tone={task.status === "regression" ? "emerald" : task.status === "capability" ? "amber" : "zinc"}>{task.status}</Pill>}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-400">
            {task && (
              <>
                <span className="inline-flex items-center gap-1">
                  <DifficultyStars level={task.difficulty} />
                </span>
                <span>created: {timeAgo(task.created_at)}</span>
                <span className="text-emerald-400">{task.passes} passes</span>
                <span className="text-rose-400/90">{task.fails} fails</span>
                <span>{task.improvements} improvements</span>
                {task.source_run_id && (
                  <span title="the failed run this task was mined from">mined from run {task.source_run_id.slice(0, 8)}</span>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading && !task && <p className="py-8 text-center text-sm text-zinc-400">loading task…</p>}
        {task && (
          <div className="flex flex-col gap-4">
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">description</h3>
              <p className="rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-zinc-300">
                {task.description || "(no description)"}
              </p>
            </section>

            {task.prompt && (
              <section>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
                  <ScrollText className="size-3.5" />
                  agent prompt
                </h3>
                <pre className="scroll-thin max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-300">
                  {task.prompt}
                </pre>
              </section>
            )}

            {onRunCycle && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={runPending}
                  onClick={() => onRunCycle(task.id)}
                  className="h-9 gap-1.5 bg-emerald-500 font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
                >
                  <Play className="size-3.5" />
                  Run self-improvement cycle
                </Button>
              </div>
            )}

            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
                <FileCode2 className="size-3.5" />
                seeded files
                <span className="ml-1 normal-case">({fileEntries.length})</span>
              </h3>
              {fileEntries.length === 0 ? (
                <p className="rounded-md border border-dashed border-zinc-800 px-4 py-4 text-center text-xs text-zinc-400">
                  no files — the agent authors everything from the prompt
                </p>
              ) : (
                <div className="scroll-thin flex max-h-[40vh] flex-col gap-2 overflow-y-auto pr-1">
                  {fileEntries.map(([path, content]) => (
                    <div key={path} className={cn(cardCls, "rounded-lg border")}>
                      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1.5">
                        <Mono className="text-xs text-emerald-400/90">{path}</Mono>
                        <Mono className="text-[10px] text-zinc-400">{content.length} chars</Mono>
                      </div>
                      <pre className="scroll-thin max-h-40 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-400">
                        {content.length > 2000 ? `${content.slice(0, 2000)}\n… (${content.length - 2000} more chars)` : content}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
                <ListChecks className="size-3.5" />
                verification script
              </h3>
              <pre className="scroll-thin max-h-56 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-400">
                {task.verify}
              </pre>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

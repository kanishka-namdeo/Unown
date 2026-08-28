"use client";

// Full run detail dialog: prompt, terminal-style transcript, verify output.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, TerminalSquare, TriangleAlert, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { api, qk } from "@/lib/agent-api";
import { formatDuration, formatTokens, timeAgo } from "@/lib/agent-format";
import type { TranscriptEntry } from "@/lib/agent-types";
import { RunKindBadge, RunStatusBadge } from "./bits";
import { cn } from "@/lib/utils";

export function TranscriptLine({ entry }: { entry: TranscriptEntry }) {
  if (entry.type === "text") {
    return (
      <div className="border-l-2 border-emerald-500/40 py-1 pl-3">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-300">{entry.text}</p>
      </div>
    );
  }
  if (entry.type === "tool_start") {
    let pretty = entry.input ?? "";
    try {
      const parsed = JSON.parse(pretty);
      pretty = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    } catch {
      // keep raw
    }
    return (
      <div className="py-1 font-mono text-xs">
        <span className="mr-1.5 select-none text-emerald-500">$</span>
        <span className="text-zinc-200">{entry.tool}</span>
        {pretty && <span className="ml-1.5 break-all text-zinc-500">{pretty.length > 300 ? `${pretty.slice(0, 300)}…` : pretty}</span>}
      </div>
    );
  }
  // tool_end
  const out = entry.output ?? "";
  const truncated = out.length > 4000 ? `${out.slice(0, 4000)}\n… (${out.length - 4000} more chars)` : out;
  return (
    <pre
      className={cn(
        "scroll-thin my-1 max-h-64 overflow-auto rounded-md border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap",
        entry.isError ? "border-rose-500/30 bg-rose-500/5 text-rose-300" : "border-zinc-800 bg-zinc-950/80 text-zinc-400"
      )}
    >
      {truncated || "(empty output)"}
    </pre>
  );
}

export function RunDetailDialog({
  runId,
  open,
  onOpenChange,
}: {
  runId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: qk.run(runId ?? ""),
    queryFn: () => api.run(runId as string),
    enabled: open && !!runId,
    refetchInterval: (query) => (query.state.data?.run.status === "running" ? 3000 : false),
  });

  const run = data?.run;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-thin max-h-[88vh] max-w-3xl overflow-y-auto border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 font-mono text-sm">
            <TerminalSquare className="size-4 text-emerald-400" />
            <span className="text-zinc-300">{runId ? `${runId.slice(0, 8)}` : "run"}</span>
            {run && <RunKindBadge kind={run.kind} />}
            {run && <RunStatusBadge status={run.status} />}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-500">
            {run && (
              <>
                <span>task: {run.task_id}</span>
                <span>started: {timeAgo(run.started_at)}</span>
                <span>duration: {formatDuration((run.ended_at ?? Date.now()) - run.started_at)}</span>
                <span>tools: {run.tool_calls}</span>
                <span>turns: {run.turns}</span>
                <span>tokens: {formatTokens(run.tokens_in)} in / {formatTokens(run.tokens_out)} out</span>
                {run.sandbox_id && <span className="text-zinc-600">sandbox: {run.sandbox_id}</span>}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading && !run && <p className="py-8 text-center text-sm text-zinc-500">loading run…</p>}
        {run && (
          <div className="flex flex-col gap-4">
            {run.prompt && (
              <section>
                <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">prompt</h3>
                <pre className="scroll-thin max-h-32 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-300">
                  {run.prompt}
                </pre>
              </section>
            )}

            {run.verify_output && (
              <section>
                <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">verification</h3>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                    run.verify_output.passed
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                  )}
                >
                  {run.verify_output.passed ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                  <span className="font-medium">{run.verify_output.passed ? "PASSED" : "FAILED"}</span>
                  {run.verify_output.summary && (
                    <span className="text-xs opacity-80">— {run.verify_output.summary}</span>
                  )}
                </div>
                {run.verify_output.log && (
                  <pre className="scroll-thin mt-2 max-h-56 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-400">
                    {run.verify_output.log}
                  </pre>
                )}
              </section>
            )}

            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
                transcript <span className="ml-1 normal-case text-zinc-600">({run.transcript.length} entries)</span>
              </h3>
              {run.transcript.length === 0 ? (
                <p className="rounded-md border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-600">
                  {run.status === "running" ? "transcript streaming…" : "no transcript entries"}
                </p>
              ) : (
                <div className="scroll-thin max-h-[46vh] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                  {run.transcript.map((entry, i) => (
                    <TranscriptLine key={i} entry={entry} />
                  ))}
                </div>
              )}
            </section>

            {run.error && (
              <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <pre className="whitespace-pre-wrap font-mono">{run.error}</pre>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

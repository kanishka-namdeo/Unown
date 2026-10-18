"use client";

// Console tab: talk to the agent directly; live transcript streaming.

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, History, Play, Send, SquareTerminal, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api, mutations, qk } from "@/lib/agent-api";
import { formatDuration, formatTokens, timeAgo } from "@/lib/agent-format";
import { EmptyState, Mono, RunStatusBadge, SectionHeading } from "./bits";
import { TranscriptLine } from "./run-detail";
import { cn } from "@/lib/utils";

const cardCls = "border-zinc-800 bg-zinc-900/60";

export function ConsoleTab() {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = React.useState("");
  const [baselineRunId, setBaselineRunId] = React.useState<string | null | undefined>(undefined); // undefined = not searching
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { data: interactiveData } = useQuery({
    queryKey: ["runs", "interactive"],
    queryFn: () => api.runs({ kind: "interactive", limit: 20 }),
    refetchInterval: 3000,
  });
  const interactiveRuns = interactiveData?.runs ?? [];

  // Once a prompt is submitted, watch for the new interactive run to appear.
  React.useEffect(() => {
    if (baselineRunId === undefined) return;
    const newest = interactiveRuns[0];
    if (newest && newest.id !== baselineRunId) {
      setActiveRunId(newest.id);
      setBaselineRunId(undefined);
    }
  }, [interactiveRuns, baselineRunId]);

  const activeRun = useQuery({
    queryKey: qk.run(activeRunId ?? ""),
    queryFn: () => api.run(activeRunId as string),
    enabled: !!activeRunId,
    refetchInterval: (query) => (query.state.data?.run.status === "running" ? 3000 : false),
  });

  const run = activeRun.data?.run;
  const isRunning = run?.status === "running";
  const searching = baselineRunId !== undefined;

  // Auto-scroll transcript while streaming.
  const transcriptLen = run?.transcript.length ?? 0;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && isRunning) el.scrollTop = el.scrollHeight;
  }, [transcriptLen, isRunning]);

  const sendPrompt = useMutation({
    mutationFn: (p: string) => mutations.prompt(p),
    onSuccess: () => {
      // remember the current newest run so we can detect the new one
      setBaselineRunId(interactiveRuns[0]?.id ?? null);
      toast.success("Prompt submitted", { description: "The agent is spinning up…" });
      queryClient.invalidateQueries({ queryKey: ["runs", "interactive"] });
    },
    onError: (err: Error & { status?: number }) => {
      if (err.status === 409) {
        toast.warning("Engine busy — a background job is learning right now", {
          description: "Wait for the current cycle to finish, then try again.",
        });
      } else {
        toast.error("Failed to start agent", { description: err.message });
      }
    },
  });

  const onSubmit = () => {
    const p = prompt.trim();
    if (!p) return;
    sendPrompt.mutate(p);
  };

  const busy = sendPrompt.isPending || searching || isRunning;

  return (
    <div className="grid gap-6 lg:grid-cols-4">
      {/* session history */}
      <section className="flex flex-col gap-3 lg:col-span-1" aria-label="interactive sessions">
        <SectionHeading title="Sessions" sub="past interactive runs" />
        {interactiveRuns.length === 0 ? (
          <EmptyState icon={<History />} title="No sessions yet" hint="Send your first prompt." />
        ) : (
          <div className="scroll-thin flex max-h-[560px] flex-col gap-2 overflow-y-auto pr-1">
            {interactiveRuns.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setActiveRunId(r.id)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  r.id === activeRunId
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <RunStatusBadge status={r.status} />
                  <Mono className="text-zinc-400">{timeAgo(r.started_at)}</Mono>
                </div>
                <Mono className="mt-1 block truncate text-zinc-400">{r.id.slice(0, 18)}</Mono>
                <div className="mt-1 flex gap-2 font-mono text-[10px] text-zinc-400">
                  <span>{r.tool_calls} tools</span>
                  <span>·</span>
                  <span>{formatTokens(r.tokens_in + r.tokens_out)} tok</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* prompt + live transcript */}
      <section className="flex flex-col gap-4 lg:col-span-3" aria-label="agent console">
        <Card className={cardCls}>
          <CardContent className="flex flex-col gap-3 p-4">
            <SectionHeading
              title="Console"
              sub="prompt the agent in a sandboxed workspace — hooks and notes still apply"
            />
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="e.g. Write a function that reverses a linked list, with tests…"
              aria-label="agent prompt"
              className="min-h-24 resize-y border-zinc-800 bg-zinc-950/80 font-mono text-sm text-zinc-200 placeholder:text-zinc-400 focus-visible:ring-emerald-500/40"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="hidden text-[11px] text-zinc-300 sm:block">
                {busy ? "agent working — transcripts stream below" : "Ctrl/⌘ + Enter to run"}
              </p>
              <Button
                onClick={onSubmit}
                disabled={busy || !prompt.trim()}
                className="h-10 gap-2 bg-emerald-500 font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                {busy ? (
                  <>
                    <span className="size-3.5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-950" />
                    working…
                  </>
                ) : (
                  <>
                    <Send className="size-3.5" />
                    Run agent
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className={cn(cardCls, "flex-1")}>
          <CardContent className="flex flex-col gap-3 p-4">
            <SectionHeading
              title="Live transcript"
              sub={activeRunId ? `run ${activeRunId.slice(0, 8)}` : "no active run"}
              right={
                run && (
                  <span className="flex items-center gap-2">
                    <RunStatusBadge status={run.status} />
                    <Mono className="text-zinc-400">
                      {formatDuration((run.ended_at ?? Date.now()) - run.started_at)} ·{" "}
                      {formatTokens(run.tokens_in)}/{formatTokens(run.tokens_out)} tok
                    </Mono>
                  </span>
                )
              }
            />

            {!activeRunId && (
              <EmptyState
                icon={<SquareTerminal />}
                title="Nothing streaming"
                hint="Run a prompt — the transcript appears here in real time."
                className="flex-1"
              />
            )}

            {activeRunId && activeRun.isLoading && (
              <p className="py-8 text-center text-sm text-zinc-400">loading run…</p>
            )}

            {run && (
              <>
                {run.prompt && (
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                    <Mono className="text-[10px] tracking-wider text-zinc-400 uppercase">prompt</Mono>
                    <p className="mt-0.5 font-mono text-xs whitespace-pre-wrap text-zinc-400">{run.prompt}</p>
                  </div>
                )}

                <div
                  ref={scrollRef}
                  className="scroll-thin max-h-[52vh] min-h-32 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2"
                  role="log"
                  aria-label="agent transcript"
                >
                  {run.transcript.length === 0 ? (
                    <p className="py-6 text-center font-mono text-xs text-zinc-400">
                      {isRunning ? "waiting for first token…" : "no transcript entries"}
                    </p>
                  ) : (
                    run.transcript.map((entry, i) => <TranscriptLine key={i} entry={entry} />)
                  )}
                </div>

                {run.verify_output && (
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                      run.verify_output.passed
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                    )}
                  >
                    {run.verify_output.passed ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                    <span className="font-medium">run finished</span>
                    {run.verify_output.summary && <span className="text-xs opacity-80">— {run.verify_output.summary}</span>}
                  </div>
                )}

                {run.status === "running" && !run.verify_output && (
                  <p className="inline-flex items-center gap-2 text-xs text-amber-400">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
                    </span>
                    run in progress — polling every 3s
                  </p>
                )}

                {run.error && (
                  <pre className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-rose-300">
                    {run.error}
                  </pre>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

"use client";

// Automations tab: scheduled recurring agent runs (zcode port) — cron rhythms
// and one-shots the engine dispatches as real headless sessions. Definitions
// live in the engine DB (never in repo files); read-only mode keeps every run
// observation-only.

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CirclePlay,
  Database,
  History,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, mutations, qk } from "@/lib/agent-api";
import { formatDuration, formatTokens, timeAgo, truncateEnd } from "@/lib/agent-format";
import type {
  Automation,
  AutomationLifecycle,
  AutomationMode,
  AutomationRun,
  AutomationRunStatus,
} from "@/lib/agent-types";
import { EmptyState, Mono, Pill, SectionHeading } from "./bits";
import { cn } from "@/lib/utils";

const cardCls = "border-zinc-800 bg-zinc-900/60";
// one-shot delay bounds, in minutes — the engine clamps to the same range
const DELAY_MIN_MINUTES = 1;
const DELAY_MAX_MINUTES = 525600;

type CreateBody = Parameters<typeof mutations.automationCreate>[0];
type PatchTarget = { id: string; title: string; lifecycle: "active" | "paused" };

// ---- badges ----

function LifecycleBadge({ lifecycle }: { lifecycle: AutomationLifecycle }) {
  switch (lifecycle) {
    case "active":
      return <Pill tone="emerald">active</Pill>;
    case "paused":
      return <Pill tone="amber">paused</Pill>;
    case "completed":
      return <Pill tone="zinc">completed</Pill>;
    case "failed":
      return <Pill tone="rose">failed</Pill>;
  }
}

function ModeBadge({ mode }: { mode: AutomationMode }) {
  if (mode === "standard") {
    return (
      <span title="standard mode may write to the workspace">
        <Pill tone="violet">standard</Pill>
      </span>
    );
  }
  return <Pill tone="zinc">read-only</Pill>;
}

function RunStatusBadge({ status }: { status: AutomationRunStatus }) {
  switch (status) {
    case "succeeded":
      return <Pill tone="emerald">succeeded</Pill>;
    case "failed":
      return <Pill tone="rose">failed</Pill>;
    case "running":
      return <Pill tone="amber" pulse>running</Pill>;
    case "skipped":
      return <Pill tone="zinc">skipped</Pill>;
  }
}

// ---- run history ----

function RunRow({ run }: { run: AutomationRun }) {
  const duration = run.ended_at !== null ? run.ended_at - run.started_at : null;
  const text = run.error ?? run.output;
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-zinc-800/70 bg-zinc-950/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <RunStatusBadge status={run.status} />
        <Mono className="text-zinc-400">{run.trigger_kind}</Mono>
        <Mono className="text-zinc-400">{timeAgo(run.started_at)}</Mono>
        <Mono className="text-zinc-400">{formatDuration(duration)}</Mono>
        <Mono className="text-zinc-400">{run.turns} turns</Mono>
        <Mono className="text-zinc-400">
          {formatTokens(run.tokens_in)} / {formatTokens(run.tokens_out)} tokens
        </Mono>
        <Mono className="text-zinc-400">exit {run.exit_code ?? "—"}</Mono>
      </div>
      {text && (
        <pre className="scroll-thin max-h-40 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-2 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-zinc-400">
          {truncateEnd(text, 2000)}
        </pre>
      )}
    </li>
  );
}

// ---- confirm dialogs (destructive actions confirm first, like the router's
// job toggles and memory rollbacks) ----

function LifecycleConfirm({
  automation,
  busy,
  onConfirm,
}: {
  automation: Automation;
  busy: boolean;
  onConfirm: () => void;
}) {
  const pausing = automation.lifecycle === "active";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={`${pausing ? "pause" : "resume"} ${automation.title}`}
          className={cn(
            "h-8 gap-1.5 px-2 text-xs",
            pausing ? "text-zinc-400 hover:text-rose-300" : "text-zinc-400 hover:text-emerald-300"
          )}
        >
          {pausing ? <Pause className="size-3.5" /> : <CirclePlay className="size-3.5" />}
          {pausing ? "Pause" : "Resume"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pausing ? `Pause "${automation.title}"?` : `Resume "${automation.title}"?`}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-zinc-400">
            {pausing
              ? "The engine stops scheduling this automation until it is resumed. Runs already in flight finish normally."
              : "The engine resumes dispatching this automation on its schedule."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={
              pausing
                ? "bg-rose-500 text-zinc-950 hover:bg-rose-400"
                : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
            }
          >
            {pausing ? "Pause" : "Resume"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteConfirm({
  automation,
  busy,
  onConfirm,
}: {
  automation: Automation;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={`delete ${automation.title}`}
          className="h-8 gap-1.5 px-2 text-xs text-zinc-400 hover:text-rose-300"
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{automation.title}"?</AlertDialogTitle>
          <AlertDialogDescription className="text-zinc-400">
            The definition is removed from the engine DB — nothing schedules it again. Past runs stay
            in the run history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-rose-500 text-zinc-950 hover:bg-rose-400"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---- automation card ----

function AutomationCard({
  automation,
  runNowPending,
  lifecyclePending,
  removePending,
  onRunNow,
  onLifecycle,
  onRemove,
}: {
  automation: Automation;
  runNowPending: boolean;
  lifecyclePending: boolean;
  removePending: boolean;
  onRunNow: (id: string) => void;
  onLifecycle: (target: PatchTarget) => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const { data: runsData } = useQuery({
    queryKey: qk.automationRuns(automation.id),
    queryFn: () => api.automationRuns(automation.id),
    enabled: expanded,
  });
  const runs = runsData?.runs ?? [];

  const scheduleHint = automation.schedule ?? (automation.cron_expr ?? "one-shot");
  const runCountLabel = `${automation.run_count}${automation.max_runs ? `/${automation.max_runs}` : ""} runs`;
  const lastRun = automation.lastRun ?? null;

  return (
    <Card className={cn(cardCls, automation.lifecycle === "paused" && "opacity-80")}>
      <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10">
              <Bot className="size-4 text-emerald-400" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-200" title={automation.title}>
                {automation.title}
              </p>
              <Mono className="text-zinc-400">{automation.id}</Mono>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <LifecycleBadge lifecycle={automation.lifecycle} />
            <ModeBadge mode={automation.mode} />
          </div>
        </div>

        <p className="text-xs leading-5 text-zinc-400" title={automation.prompt}>
          {truncateEnd(automation.prompt, 140)}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-zinc-400">
          <span className="inline-flex items-center gap-1.5" title={automation.cron_expr ?? undefined}>
            <CalendarClock className="size-3 shrink-0" />
            {scheduleHint}
          </span>
          <span className="tabular-nums">{runCountLabel}</span>
          {automation.lifecycle === "active" && automation.next_run_at !== null && (
            <span>next: {timeAgo(automation.next_run_at)}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[11px] text-zinc-400">last run</span>
          {lastRun ? (
            <>
              <RunStatusBadge status={lastRun.status} />
              <Mono className="text-zinc-400">{lastRun.trigger_kind}</Mono>
              <Mono className="text-zinc-400">exit {lastRun.exit_code ?? "—"}</Mono>
              <Mono className="text-zinc-400">
                {formatTokens(lastRun.tokens_in)} / {formatTokens(lastRun.tokens_out)} tokens
              </Mono>
              <Mono className="text-zinc-400">{timeAgo(lastRun.started_at)}</Mono>
            </>
          ) : (
            <span className="text-[11px] text-zinc-400">never ran</span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-2.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="h-8 gap-1.5 px-2 text-xs text-zinc-400 hover:text-zinc-100"
          >
            <History className="size-3.5" />
            {expanded ? "Hide run history" : "Run history"}
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </Button>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={runNowPending}
              onClick={() => onRunNow(automation.id)}
              className="h-8 gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            >
              <Play className="size-3.5" />
              Run now
            </Button>
            <LifecycleConfirm
              automation={automation}
              busy={lifecyclePending}
              onConfirm={() =>
                onLifecycle({
                  id: automation.id,
                  title: automation.title,
                  lifecycle: automation.lifecycle === "active" ? "paused" : "active",
                })
              }
            />
            <DeleteConfirm
              automation={automation}
              busy={removePending}
              onConfirm={() => onRemove(automation.id)}
            />
          </div>
        </div>

        {expanded && (
          <div
            aria-label="automation run history"
            className="flex flex-col gap-2 border-t border-zinc-800 pt-3"
          >
            <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
              run history <span className="ml-1 normal-case text-zinc-400">({runs.length || "…"})</span>
            </p>
            {runs.length === 0 ? (
              <p className="text-xs text-zinc-400">no runs recorded yet</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {runs.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- the tab ----

export function AutomationsTab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: qk.automations,
    queryFn: api.automations,
    refetchInterval: 8000,
  });
  const automations = data?.automations ?? [];

  // ---- create-dialog state (local, no form lib) ----
  const [createOpen, setCreateOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [scheduleKind, setScheduleKind] = React.useState<"cron" | "one-shot">("cron");
  const [cron, setCron] = React.useState("");
  const [delayMinutes, setDelayMinutes] = React.useState("");
  const [mode, setMode] = React.useState<AutomationMode>("read-only");
  const [model, setModel] = React.useState("");
  const [maxRuns, setMaxRuns] = React.useState("");

  const runNow = useMutation({
    mutationFn: (id: string) => mutations.automationRunNow(id),
    onSuccess: (_d, id) => {
      toast.success("Automation started", {
        description: "A headless session is dispatching — watch the run history.",
      });
      queryClient.invalidateQueries({ queryKey: qk.automations });
      queryClient.invalidateQueries({ queryKey: qk.automationRuns(id) });
    },
    onError: (err: Error & { status?: number }) => {
      if (err.status === 409 || err.status === 400) {
        toast.warning("Automation did not start", { description: err.message });
      } else {
        toast.error("Failed to run automation", { description: err.message });
      }
    },
  });

  const patchLifecycle = useMutation({
    mutationFn: (target: PatchTarget) =>
      mutations.automationPatch(target.id, { lifecycle: target.lifecycle }),
    onSuccess: (_d, target) => {
      toast.success(
        target.lifecycle === "paused" ? "Automation paused" : "Automation resumed",
        {
          description:
            target.lifecycle === "paused"
              ? `"${target.title}" stops firing until it is resumed.`
              : `"${target.title}" is back on its schedule.`,
        }
      );
      queryClient.invalidateQueries({ queryKey: qk.automations });
    },
    onError: (err: Error) => toast.error("Failed to update automation", { description: err.message }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => mutations.automationDelete(id),
    onSuccess: () => {
      toast.success("Automation deleted", {
        description: "The definition is gone from the engine DB — its run history stays.",
      });
      queryClient.invalidateQueries({ queryKey: qk.automations });
    },
    onError: (err: Error) => toast.error("Failed to delete automation", { description: err.message }),
  });

  const create = useMutation({
    mutationFn: (body: CreateBody) => mutations.automationCreate(body),
    onSuccess: () => {
      toast.success("Automation created", {
        description: "The engine dispatches it as a real headless session on its schedule.",
      });
      setCreateOpen(false);
      // reset the form for the next open
      setTitle("");
      setPrompt("");
      setScheduleKind("cron");
      setCron("");
      setDelayMinutes("");
      setMode("read-only");
      setModel("");
      setMaxRuns("");
      queryClient.invalidateQueries({ queryKey: qk.automations });
    },
    onError: (err: Error) => toast.error("Failed to create automation", { description: err.message }),
  });

  // client-side guards: cron required in cron mode; a numeric delay within
  // the engine's clamp in one-shot mode
  const delayNum = Number(delayMinutes);
  const scheduleOk =
    scheduleKind === "cron"
      ? cron.trim().length > 0
      : delayMinutes.trim() !== "" &&
        Number.isFinite(delayNum) &&
        delayNum >= DELAY_MIN_MINUTES &&
        delayNum <= DELAY_MAX_MINUTES;
  const maxRunsNum = Number(maxRuns);
  const canCreate = title.trim().length > 0 && prompt.trim().length > 0 && scheduleOk;

  const submitCreate = () => {
    if (!canCreate || create.isPending) return;
    create.mutate({
      title: title.trim(),
      prompt: prompt.trim(),
      mode,
      ...(scheduleKind === "cron" ? { cron: cron.trim() } : { delayMinutes: delayNum }),
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(maxRuns.trim() !== "" && Number.isFinite(maxRunsNum) && maxRunsNum > 0
        ? { maxRuns: Math.floor(maxRunsNum) }
        : {}),
    });
  };

  return (
    <section className="flex flex-col gap-3" aria-label="automations">
      <SectionHeading
        title="Automations"
        sub="scheduled recurring agent runs — the engine dispatches them as real headless sessions"
        right={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-2 border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
              >
                <Plus className="size-3.5" />
                New automation
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl border-zinc-800 bg-zinc-900 text-zinc-100">
              <DialogHeader>
                <DialogTitle className="text-zinc-100">New automation</DialogTitle>
                <DialogDescription className="text-zinc-400">
                  The engine stores the definition and dispatches a real headless session on the
                  schedule.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="automation-title" className="text-xs font-medium text-zinc-300">
                    Title
                  </label>
                  <Input
                    id="automation-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="morning brief"
                    aria-label="automation title"
                    className="border-zinc-800 bg-zinc-950/80 text-sm text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-violet-500/40"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="automation-prompt" className="text-xs font-medium text-zinc-300">
                    Prompt
                  </label>
                  <Textarea
                    id="automation-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="what should the headless session do on every run?"
                    aria-label="automation prompt"
                    className="min-h-24 resize-y border-zinc-800 bg-zinc-950/80 text-sm text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-violet-500/40"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-zinc-300">Schedule</span>
                  <div className="flex items-center gap-1.5" role="group" aria-label="schedule type">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-pressed={scheduleKind === "cron"}
                      onClick={() => setScheduleKind("cron")}
                      className={cn(
                        "h-8 px-3 text-xs",
                        scheduleKind === "cron"
                          ? "border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                          : "border-zinc-700 bg-transparent text-zinc-400 hover:text-zinc-100"
                      )}
                    >
                      cron
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-pressed={scheduleKind === "one-shot"}
                      onClick={() => setScheduleKind("one-shot")}
                      className={cn(
                        "h-8 px-3 text-xs",
                        scheduleKind === "one-shot"
                          ? "border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                          : "border-zinc-700 bg-transparent text-zinc-400 hover:text-zinc-100"
                      )}
                    >
                      one-shot
                    </Button>
                  </div>
                  {scheduleKind === "cron" ? (
                    <Input
                      value={cron}
                      onChange={(e) => setCron(e.target.value)}
                      placeholder="0 9 * * 1-5 — at 09:00, Mon–Fri"
                      aria-label="cron expression"
                      className="border-zinc-800 bg-zinc-950/80 font-mono text-sm text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-violet-500/40"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={DELAY_MIN_MINUTES}
                        max={DELAY_MAX_MINUTES}
                        value={delayMinutes}
                        onChange={(e) => setDelayMinutes(e.target.value)}
                        placeholder="30"
                        aria-label="delay minutes"
                        className="w-32 border-zinc-800 bg-zinc-950/80 text-sm tabular-nums text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-violet-500/40"
                      />
                      <span className="text-xs text-zinc-400">
                        minutes from now — fires once{mode === "read-only" ? ", observation-only" : ""}
                      </span>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-zinc-300">Mode</span>
                    <Select
                      value={mode}
                      onValueChange={(v) => setMode(v === "standard" ? "standard" : "read-only")}
                    >
                      <SelectTrigger
                        aria-label="automation mode"
                        className="w-full border-zinc-800 bg-zinc-950/80 text-zinc-200"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                        <SelectItem value="read-only">read-only</SelectItem>
                        <SelectItem value="standard">standard</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="automation-model" className="text-xs font-medium text-zinc-300">
                      Model <span className="font-normal text-zinc-400">(optional)</span>
                    </label>
                    <Input
                      id="automation-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="defaults to the bridge default model"
                      aria-label="automation model"
                      className="border-zinc-800 bg-zinc-950/80 text-sm text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-violet-500/40"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="automation-max-runs" className="text-xs font-medium text-zinc-300">
                    Max runs <span className="font-normal text-zinc-400">(optional — completes once reached)</span>
                  </label>
                  <Input
                    id="automation-max-runs"
                    type="number"
                    min={1}
                    value={maxRuns}
                    onChange={(e) => setMaxRuns(e.target.value)}
                    placeholder="10"
                    aria-label="max runs"
                    className="w-32 border-zinc-800 bg-zinc-950/80 text-sm tabular-nums text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-violet-500/40"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitCreate}
                  disabled={!canCreate || create.isPending}
                  className="gap-1.5 bg-violet-500 font-medium text-zinc-950 hover:bg-violet-400 disabled:opacity-40"
                >
                  <Plus className="size-3.5" />
                  {create.isPending ? "creating…" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className={cardCls}>
              <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : automations.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="No automations yet"
          hint="Schedule the agent to run on its own — cron rhythms or one-shots, read-only by default."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {automations.map((a) => (
            <AutomationCard
              key={a.id}
              automation={a}
              runNowPending={runNow.isPending}
              lifecyclePending={patchLifecycle.isPending}
              removePending={remove.isPending}
              onRunNow={(id) => runNow.mutate(id)}
              onLifecycle={(target) => patchLifecycle.mutate(target)}
              onRemove={(id) => remove.mutate(id)}
            />
          ))}
        </div>
      )}

      <p className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
        <Database className="size-3.5 shrink-0" />
        definitions live in the engine DB — never in repo files; read-only mode keeps every run
        observation-only.
      </p>
    </section>
  );
}

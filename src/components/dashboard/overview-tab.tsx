"use client";

// Overview tab: KPIs, the 5 patterns, cumulative pass chart, live feed, tasks.

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  Cpu,
  GraduationCap,
  Layers,
  Moon,
  Play,
  RefreshCw,
  Router,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, mutations, qk } from "@/lib/agent-api";
import { formatTokens } from "@/lib/agent-format";
import { useActivityStore } from "@/lib/agent-store";
import type { TaskOrigin, TaskStatus } from "@/lib/agent-types";
import { DifficultyStars, EmptyState, Mono, Pill, SectionHeading } from "./bits";
import { TaskDetailDialog } from "./task-detail";
import { ActivityFeed } from "./activity-feed";
import { cn } from "@/lib/utils";

const cardCls = "border-zinc-800 bg-zinc-900/60";

function KpiCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <Card className={cardCls}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium tracking-wider text-zinc-400 uppercase">{label}</p>
          <span className="text-zinc-400 [&_svg]:size-4">{icon}</span>
        </div>
        <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-zinc-100">{value}</p>
        {sub && <div className="mt-1 text-xs text-zinc-400">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function TaskOriginBadge({ origin }: { origin: TaskOrigin }) {
  return <Pill tone={origin === "minted" ? "violet" : "zinc"}>{origin}</Pill>;
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  switch (status) {
    case "capability":
      return <Pill tone="amber">capability</Pill>;
    case "discarded":
      return <Pill tone="outline">discarded</Pill>;
    default:
      return <Pill tone="violet">regression</Pill>;
  }
}

const patterns = [
  {
    icon: Layers,
    title: "Tiered Memory",
    line: "policy · project · user · local — most specific wins",
    metric: (d: OverviewLike) => `${d.memVersions} versions`,
  },
  {
    icon: RefreshCw,
    title: "Self-Improving Harness",
    line: "baseline → diagnose → patch → candidate → ship",
    metric: (d: OverviewLike) => `${d.improvements} shipped`,
  },
  {
    icon: Router,
    title: "Routing",
    line: "interval + event jobs schedule the learning loop",
    metric: (d: OverviewLike) => `${d.jobRuns} job runs`,
  },
  {
    icon: Moon,
    title: "Auto Dreaming",
    line: "consolidates session notes into project memory",
    metric: (d: OverviewLike) => `${d.dreams} dreams`,
  },
  {
    icon: ShieldCheck,
    title: "Hooks",
    line: "guardrails on every tool call, prompt and stop",
    metric: (d: OverviewLike) => `${d.hookTotal} decisions`,
  },
];

interface OverviewLike {
  memVersions: number;
  improvements: number;
  jobRuns: number;
  dreams: number;
  hookTotal: number;
}

function TrendChart({ data }: { data: { ts: number; cumulativePass: number }[] }) {
  if (data.length === 0) {
    return <EmptyState icon={<Activity />} title="No passes yet" hint="The trend line appears after the first verified run." />;
  }
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="passFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
            tick={{ fill: "#71717a", fontSize: 10 }}
            stroke="#3f3f46"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#71717a", fontSize: 10 }}
            stroke="#3f3f46"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              fontSize: 12,
              color: "#e4e4e7",
            }}
            labelFormatter={(ts) => new Date(Number(ts)).toLocaleString(undefined, { hour12: false })}
            formatter={(v) => [v, "cumulative passes"]}
          />
          <Area
            type="monotone"
            dataKey="cumulativePass"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#passFill)"
            isAnimationActive={false}
            dot={{ r: 2.5, fill: "#10b981" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OverviewTab() {
  const queryClient = useQueryClient();
  const [detailTaskId, setDetailTaskId] = React.useState<string | null>(null);
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: qk.overview,
    queryFn: api.overview,
    refetchInterval: 5000,
  });
  const { data: tasksData } = useQuery({ queryKey: qk.tasks, queryFn: api.tasks, refetchInterval: 8000 });
  const { data: jobsData } = useQuery({ queryKey: qk.jobs, queryFn: api.jobs, refetchInterval: 8000 });
  const connected = useActivityStore((s) => s.connected);

  const runTask = useMutation({
    mutationFn: (taskId: string) => mutations.runTask(taskId),
    onSuccess: (_d, taskId) => {
      toast.success("Cycle started", { description: `Self-improvement cycle for "${taskId}" is now running — watch Learning Lab.` });
      queryClient.invalidateQueries({ queryKey: qk.overview });
    },
    onError: (err: Error & { status?: number }) => {
      if (err.status === 409) {
        toast.warning("Engine busy — a background job is learning right now", {
          description: "Try again in a moment.",
        });
      } else {
        toast.error("Failed to start cycle", { description: err.message });
      }
    },
  });

  const k = overview?.kpis;
  const jobsRunCount = (jobsData?.jobs ?? []).reduce((acc, j) => acc + (j.run_count ?? 0), 0);
  const memVersionSum = overview
    ? Object.values(overview.memoryVersions).reduce((a, b) => a + b, 0)
    : 0;

  const patternData: OverviewLike = {
    memVersions: memVersionSum,
    improvements: k?.improvementsShipped ?? 0,
    jobRuns: jobsRunCount,
    dreams: k?.dreams ?? 0,
    hookTotal: k?.hooks.total ?? 0,
  };

  const tasks = tasksData?.tasks ?? [];

  const mintTask = useMutation({
    mutationFn: () => mutations.mintTask(),
    onSuccess: (d) => {
      const o = d.outcome;
      if (o.status === "minted") {
        toast.success(`Task minted — ${o.taskId ?? "new task"}`, {
          description: o.reason ?? `authored from ${o.source ?? "failure mining"}, validated by a real agent run`,
        });
      } else if (o.status === "skipped") {
        toast.info("Minting skipped", { description: o.reason ?? "no minable material right now" });
      } else if (o.status === "discarded") {
        toast.warning("Draft discarded", { description: o.reason ?? "validation rejected the draft" });
      } else {
        toast.error("Minting failed", { description: o.reason ?? "engine error" });
      }
      queryClient.invalidateQueries({ queryKey: qk.tasks });
      queryClient.invalidateQueries({ queryKey: qk.overview });
    },
    onError: (err: Error & { status?: number }) => {
      if (err.status === 409) {
        toast.warning("Engine busy — a background job is learning right now", {
          description: "Try minting again once the current cycle finishes.",
        });
      } else {
        toast.error("Failed to mint task", { description: err.message });
      }
    },
  });

  return (
    <div className="flex flex-col gap-6">
      {/* KPI row */}
      <section aria-label="key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        {overviewLoading && (
          <div className="col-span-2 grid grid-cols-2 gap-3 md:col-span-3 md:grid-cols-3 xl:col-span-7 xl:grid-cols-7" aria-hidden="true">
            {Array.from({ length: 7 }).map((_, i) => (
              <Card key={i} className={cardCls}>
                <CardContent className="flex flex-col gap-2.5 p-4">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-7 w-1/3" />
                  <Skeleton className="h-2.5 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {!overviewLoading && (
          <>
        <KpiCard
          label="Pass rate"
          value={`${k?.passRate ?? 0}%`}
          sub={
            <span className="inline-flex items-center gap-1.5">
              <span className="text-emerald-400">{k?.passed ?? 0} passed</span>
              <span className="text-zinc-400">·</span>
              <span className="text-rose-400">{k?.failed ?? 0} failed</span>
              <span className="text-zinc-400">·</span>
              <span>{k?.totalRuns ?? 0} runs</span>
              {(k?.errors ?? 0) > 0 && (
                <>
                  <span className="text-zinc-400">·</span>
                  <span className="text-amber-400" title="runs that errored before verification">{k?.errors ?? 0} errors</span>
                </>
              )}
            </span>
          }
          icon={<CheckCircle2 className="text-emerald-500/70" />}
        />
        <KpiCard
          label="Learning suite"
          value={k?.suite ? `${k.suite.passing}/${k.suite.total}` : "—"}
          sub={
            k?.suite ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className="text-amber-400">{k.suite.capability} capability</span>
                <span className="text-zinc-400">·</span>
                <span className="text-rose-400/90" title="tasks that regressed after passing">{k.suite.regression} regression</span>
                <span className="text-zinc-400">·</span>
                <span className="text-emerald-400">{k.suite.graduated} graduated</span>
                {k.suite.saturated && <Pill tone="amber">saturated</Pill>}
              </span>
            ) : (
              "awaiting engine task minting"
            )
          }
          icon={<GraduationCap className="text-emerald-500/70" />}
        />
        <KpiCard
          label="Improvements"
          value={k?.improvementsShipped ?? 0}
          sub={<span>memory patches shipped{(k?.notes.total ?? 0) > 0 && <span> · {k?.notes.total} notes total</span>}</span>}
          icon={<Sparkles className="text-emerald-500/70" />}
        />
        <KpiCard label="Dreams" value={k?.dreams ?? 0} sub={`${k?.notes.pending ?? 0} notes pending`} icon={<Moon className="text-amber-500/70" />} />
        <KpiCard
          label="Memory"
          value={`v${overview?.memoryVersions.project ?? 1}`}
          sub="project tier version"
          icon={<Layers className="text-emerald-500/70" />}
        />
        <KpiCard
          label="Hook decisions"
          value={k?.hooks.total ?? 0}
          sub={<span><span className="text-rose-400">{k?.hooks.denies ?? 0} denies</span> · guardrails</span>}
          icon={<ShieldCheck className="text-rose-500/70" />}
        />
        <KpiCard
          label="LLM requests"
          value={overview?.agent.bridge.requests ?? 0}
          sub={
            <span>
              {overview?.agent.bridge.errors ?? 0} errors · {formatTokens(k?.tokens.in ?? 0)} in / {formatTokens(k?.tokens.out ?? 0)} out
            </span>
          }
          icon={<Cpu className="text-emerald-500/70" />}
        />
          </>
        )}
      </section>

      {/* 5 patterns strip */}
      <section aria-label="the five patterns">
        <SectionHeading title="The 5 patterns" sub="self-learning layer wrapped around pi" />
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {patterns.map((p) => (
            <Card key={p.title} className={cn(cardCls, "transition-colors hover:border-emerald-500/40")}>
              <CardContent className="flex flex-col gap-1.5 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10">
                    <p.icon className="size-4 text-emerald-400" />
                  </span>
                  <p className="text-xs font-semibold text-zinc-200">{p.title}</p>
                </div>
                <p className="text-[11px] leading-4 text-zinc-400">{p.line}</p>
                <p className="mt-0.5 font-mono text-xs text-emerald-400">{p.metric(patternData)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* chart + activity */}
      <section className="grid gap-4 xl:grid-cols-3">
        <Card className={cn(cardCls, "xl:col-span-2")}>
          <CardContent className="p-4 sm:p-6">
            <SectionHeading title="Cumulative passes" sub="verified task completions over time" />
            <div className="mt-3">
              <TrendChart data={overview?.trend ?? []} />
            </div>
          </CardContent>
        </Card>
        <Card className={cardCls}>
          <CardContent className="p-4 sm:p-6">
            <SectionHeading
              title="Live activity"
              sub={connected ? "streaming from engine :3030" : "reconnecting…"}
              right={
                <span className={cn("size-2 rounded-full", connected ? "animate-pulse bg-emerald-400" : "bg-zinc-700")} />
              }
            />
            <div className="mt-3">
              <ActivityFeed maxHeight="max-h-[220px]" />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* tasks */}
      <section aria-label="benchmark tasks">
        <SectionHeading
          title="Benchmark tasks"
          sub="each row triggers a full self-improvement cycle"
          right={
            <Button
              size="sm"
              variant="outline"
              disabled={mintTask.isPending}
              onClick={() => mintTask.mutate()}
              title="Mine the latest unmined failed run into a new benchmark task (or author a curriculum variant when the suite is saturated)"
              className="h-8 gap-1.5 border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 disabled:opacity-40"
            >
              <Sparkles className="size-3.5" />
              {mintTask.isPending ? "minting…" : "Mint task"}
            </Button>
          }
        />
        <Card className={cn(cardCls, "mt-3")}>
          <CardContent className="p-0">
            {tasks.length === 0 ? (
              <EmptyState className="m-4" icon={<Play />} title="No tasks loaded" />
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-[11px] tracking-wider text-zinc-400 uppercase">
                      <th className="px-4 py-2.5 font-medium">Task</th>
                      <th className="px-4 py-2.5 font-medium">Difficulty</th>
                      <th className="px-4 py-2.5 font-medium">Pass / Fail</th>
                      <th className="px-4 py-2.5 font-medium">Improvements</th>
                      <th className="px-4 py-2.5 font-medium">Rate</th>
                      <th className="px-4 py-2.5 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => {
                      const total = t.passes + t.fails;
                      const rate = total === 0 ? null : Math.round((t.passes / total) * 100);
                      return (
                        <tr key={t.id} className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-900/70">
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setDetailTaskId(t.id)}
                                className="font-medium text-zinc-200 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-emerald-400 hover:decoration-emerald-500/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60"
                                title="inspect the task — prompt, seeded files, verify script"
                              >
                                {t.name}
                              </button>
                              <TaskOriginBadge origin={t.origin ?? "seed"} />
                              <TaskStatusBadge status={t.status ?? "regression"} />
                            </div>
                            <Mono className="text-zinc-400">{t.id}</Mono>
                          </td>
                          <td className="px-4 py-3"><DifficultyStars level={t.difficulty} /></td>
                          <td className="px-4 py-3 font-mono tabular-nums">
                            <span className="text-emerald-400">{t.passes}</span>
                            <span className="text-zinc-400"> / </span>
                            <span className="text-rose-400">{t.fails}</span>
                          </td>
                          <td className="px-4 py-3 font-mono tabular-nums text-zinc-300">{t.improvements}</td>
                          <td className="px-4 py-3">
                            {rate === null ? (
                              <span className="text-xs text-zinc-400">not run yet</span>
                            ) : (
                              <span className={cn("font-mono text-xs tabular-nums", rate >= 50 ? "text-emerald-400" : "text-amber-400")}>
                                {rate}%
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              disabled={runTask.isPending}
                              onClick={() => runTask.mutate(t.id)}
                              className="h-9 border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 sm:h-8"
                              variant="outline"
                            >
                              <Play className="size-3.5" />
                              Run cycle
                            </Button>
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
        <p className="mt-2 text-[11px] text-zinc-400">
          Cycles mine failures, propose memory patches, validate them against a candidate run and ship only what helps — details in Learning Lab. Task names open the full spec: prompt, seeded files and the verify script.
        </p>
      </section>

      <TaskDetailDialog
        taskId={detailTaskId}
        open={detailTaskId !== null}
        onOpenChange={(v) => !v && setDetailTaskId(null)}
        onRunCycle={(id) => runTask.mutate(id)}
        runPending={runTask.isPending}
      />
    </div>
  );
}

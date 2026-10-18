"use client";

// Gateway tab: the llm-bridge request log — every call the engine makes to the
// model provider, with per-model breakdown, latency sparkline and the raw log.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Clock, Network } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, qk } from "@/lib/agent-api";
import { formatAbsolute, formatDuration, formatTokens, timeAgo } from "@/lib/agent-format";
import type { BridgeLogEntry } from "@/lib/agent-types";
import { EmptyState, Mono, SectionHeading } from "./bits";
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

interface ModelGroup {
  model: string;
  count: number;
  tokens: number;
  avgDuration: number;
}

// Model ids can be `local:<id>` when the router picks the local lane — display
// them as-is, grouped by the raw id.
function groupByModel(log: BridgeLogEntry[]): ModelGroup[] {
  const groups = new Map<string, { count: number; tokens: number; duration: number }>();
  for (const e of log) {
    const g = groups.get(e.model) ?? { count: 0, tokens: 0, duration: 0 };
    g.count += 1;
    g.tokens += e.promptTokens + e.completionTokens;
    g.duration += e.durationMs;
    groups.set(e.model, g);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([model, g]) => ({
      model,
      count: g.count,
      tokens: g.tokens,
      avgDuration: g.duration / g.count,
    }));
}

function LatencyChart({ data }: { data: { ts: number; durationMs: number }[] }) {
  if (data.length < 2) {
    return (
      <EmptyState
        icon={<Activity />}
        title="No latency yet"
        hint="latency appears after the next request"
      />
    );
  }
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
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
            tickFormatter={(ts: number) =>
              new Date(ts).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })
            }
            tick={{ fill: "#71717a", fontSize: 10 }}
            stroke="#3f3f46"
          />
          <YAxis
            allowDecimals={false}
            tickFormatter={(v: number) => formatDuration(v)}
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
            formatter={(v) => [formatDuration(Number(v)), "duration"]}
          />
          <Area
            type="monotone"
            dataKey="durationMs"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#latencyFill)"
            isAnimationActive={false}
            dot={{ r: 2.5, fill: "#10b981" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function RequestLogTable({ log }: { log: BridgeLogEntry[] }) {
  return (
    <Card className={cardCls}>
      <CardContent className="p-0">
        <div className="scroll-thin max-h-[520px] overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-[11px] tracking-wider text-zinc-400 uppercase">
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Model</th>
                <th className="px-4 py-2.5 font-medium">Stream</th>
                <th className="px-4 py-2.5 font-medium">Finish</th>
                <th className="px-4 py-2.5 font-medium">Msgs/Tools</th>
                <th className="px-4 py-2.5 font-medium">Tokens</th>
                <th className="px-4 py-2.5 text-right font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {log.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-400">
                    no requests in the current window
                  </td>
                </tr>
              ) : (
                log.map((e, i) => (
                  <tr
                    key={`${e.ts}-${e.model}-${i}`}
                    className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-900/70"
                  >
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-zinc-400" title={formatAbsolute(e.ts)}>
                        {timeAgo(e.ts)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Mono className="text-zinc-300">{e.model}</Mono>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {e.stream ? (
                        <span className="text-emerald-400">yes</span>
                      ) : (
                        <span className="text-zinc-400">no</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-300">{e.finishReason}</td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-zinc-300">
                      {e.messages} · {e.tools}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-zinc-300">
                      {formatTokens(e.promptTokens)} / {formatTokens(e.completionTokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-300">
                      {formatDuration(e.durationMs)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function GatewayTab() {
  const { data: bridgeData, isLoading } = useQuery({
    queryKey: qk.bridge,
    queryFn: api.bridge,
    refetchInterval: 8000,
  });

  const log = bridgeData?.log ?? [];
  const requests = bridgeData?.requests ?? 0;
  const errors = bridgeData?.errors ?? 0;
  const tokensIn = log.reduce((acc, e) => acc + e.promptTokens, 0);
  const tokensOut = log.reduce((acc, e) => acc + e.completionTokens, 0);
  const avgDuration =
    log.length > 0 ? log.reduce((acc, e) => acc + e.durationMs, 0) / log.length : 0;
  const models = groupByModel(log);
  // The bridge log is a most-recent-first ring buffer — flip it so the chart
  // reads left → right (oldest → newest).
  const latencyData = [...log].reverse().map((e) => ({ ts: e.ts, durationMs: e.durationMs }));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-label="gateway">
        <SectionHeading
          title="Gateway"
          sub="llm-bridge request log — every call to the model provider"
          right={bridgeData?.url ? <Mono className="text-zinc-400">{bridgeData.url}</Mono> : undefined}
        />
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className={cardCls}>
                <CardContent className="flex flex-col gap-2.5 p-4">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-7 w-1/3" />
                  <Skeleton className="h-2.5 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard
              label="Requests"
              value={requests}
              sub={`${errors} errors`}
              icon={<Network className="text-emerald-500/70" />}
            />
            <KpiCard
              label="Tokens in"
              value={formatTokens(tokensIn)}
              sub="prompt tokens"
              icon={<ArrowDownToLine className="text-emerald-500/70" />}
            />
            <KpiCard
              label="Tokens out"
              value={formatTokens(tokensOut)}
              sub="completion tokens"
              icon={<ArrowUpFromLine className="text-emerald-500/70" />}
            />
            <KpiCard
              label="Avg duration"
              value={formatDuration(avgDuration)}
              sub={`${log.length} in window`}
              icon={<Clock className="text-emerald-500/70" />}
            />
          </div>
        )}
      </section>

      {isLoading ? (
        <div className="grid gap-4 xl:grid-cols-3" aria-hidden="true">
          <Card className={cardCls}>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
          <Card className={cn(cardCls, "xl:col-span-2")}>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-[220px] w-full" />
            </CardContent>
          </Card>
        </div>
      ) : log.length === 0 && requests === 0 ? (
        <EmptyState
          icon={<Network />}
          title="No requests yet"
          hint="Every model call the engine makes lands here — run a cycle or a console prompt."
        />
      ) : (
        <>
          <section className="grid gap-4 xl:grid-cols-3" aria-label="model breakdown">
            <Card className={cardCls}>
              <CardContent className="p-4 sm:p-6">
                <SectionHeading title="Model breakdown" sub="requests routed per model in the current window" />
                <div className="mt-3 flex flex-col divide-y divide-zinc-800/60">
                  {models.length === 0 ? (
                    <p className="py-2.5 text-xs text-zinc-400">no models in the current window</p>
                  ) : (
                    models.map((m) => (
                      <div key={m.model} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                        <Mono className="min-w-0 flex-1 truncate text-zinc-200">{m.model}</Mono>
                        <span className="font-mono text-xs tabular-nums text-zinc-300">{m.count} reqs</span>
                        <span className="font-mono text-xs tabular-nums text-zinc-300">
                          {formatTokens(m.tokens)} tokens
                        </span>
                        <span className="font-mono text-xs tabular-nums text-zinc-400">
                          {formatDuration(m.avgDuration)} avg
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
            <Card className={cn(cardCls, "xl:col-span-2")}>
              <CardContent className="p-4 sm:p-6">
                <SectionHeading title="Latency" sub="per-request duration across the log window" />
                <div className="mt-3">
                  <LatencyChart data={latencyData} />
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="flex flex-col gap-3" aria-label="request log">
            <SectionHeading title="Request log" sub={`${log.length} most recent calls — newest first`} />
            <RequestLogTable log={log} />
            <p className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Activity className="size-3.5 shrink-0" />
              the log is a ring buffer — it resets when the bridge restarts
            </p>
          </section>
        </>
      )}
    </div>
  );
}

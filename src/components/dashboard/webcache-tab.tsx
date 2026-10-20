"use client";

// Web Cache tab: the web results store — the persistent, cross-process cache
// behind web_search and webfetch. KPIs (hit rate, requests saved, bytes,
// entries), the freshness/config card (TTLs, stale-if-error windows, byte
// cap, store root), the observability feed (every hit/miss/revalidate/stale/
// evict event), per-provider traffic, and the two maintenance actions:
// clear (destructive — confirms first) and sweep (run the LRU byte-cap
// eviction on demand).

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Boxes,
  Database,
  Gauge,
  HardDrive,
  Network,
  Recycle,
  Trash2,
  Zap,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api, mutations, qk } from "@/lib/agent-api";
import { formatBytes, formatDuration, timeAgo } from "@/lib/agent-format";
import type { WebCacheEventKind, WebCacheStats } from "@/lib/agent-types";
import { EmptyState, Mono, Pill, SectionHeading, StatChip, type Tone } from "./bits";
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

// Event-kind → tone: hits are the win (emerald), revalidates moved the clock
// without paying for a body (violet), misses are neutral (zinc), stale is a
// flagged degradation (amber), evictions squeeze back under the cap (orange),
// clears are manual maintenance (violet), bypass/error are trouble (rose).
const kindTone: Record<WebCacheEventKind, Tone> = {
  hit: "emerald",
  revalidated: "violet",
  miss: "zinc",
  stale: "amber",
  evict: "orange",
  clear: "violet",
  bypass: "rose",
  error: "rose",
};

/** Compact human units for TTL / stale windows: 60m, 24h, 7d. */
function humanTtl(ms: number): string {
  if (ms === 0) return "always revalidate";
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return formatDuration(ms);
}

/** Clearing drops every cached result — destructive, so it confirms first
 * (the memory-rollback / job-toggle contract for destructive actions). */
function ClearStoreConfirm({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          className="h-8 gap-1.5 border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
          Clear store
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear the web results store?</AlertDialogTitle>
          <AlertDialogDescription>
            Every cached search result and fetched page on this machine is deleted. The next web call re-fetches from
            upstream — search history, memory and tasks are untouched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-rose-500 text-zinc-950 hover:bg-rose-400">
            Clear store
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SavedTrendChart({ data }: { data: { ts: number; saved: number }[] }) {
  if (data.length < 2) {
    return (
      <EmptyState
        icon={<Activity />}
        title="No saves yet"
        hint="The trend line appears after the first cached answer."
      />
    );
  }
  // Linear numeric axis (NOT scale="time"): on narrow windows — every save
  // inside the same minute, a fresh store's first hours — the d3 time scale
  // generates colliding ticks and React warns about duplicate tick keys.
  // A padded numeric domain with nice linear ticks is always distinct.
  const lo = Math.min(...data.map((d) => d.ts)) - 30_000;
  const hi = Math.max(...data.map((d) => d.ts)) + 30_000;
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="savedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={[lo, hi]}
            minTickGap={48}
            tickFormatter={(ts: number) =>
              new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
            }
            tick={{ fill: "#71717a", fontSize: 10 }}
            stroke="#3f3f46"
          />
          <YAxis allowDecimals={false} tick={{ fill: "#71717a", fontSize: 10 }} stroke="#3f3f46" />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              fontSize: 12,
              color: "#e4e4e7",
            }}
            labelFormatter={(ts) => new Date(Number(ts)).toLocaleString(undefined, { hour12: false })}
            formatter={(v) => [v, "requests saved"]}
          />
          <Area
            type="monotone"
            dataKey="saved"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#savedFill)"
            isAnimationActive={false}
            dot={{ r: 2.5, fill: "#10b981" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ConfigCard({ stats }: { stats: WebCacheStats }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: "Status",
      value: stats.enabled ? <Pill tone="emerald">enabled</Pill> : <Pill tone="zinc">disabled</Pill>,
    },
    { label: "Byte cap", value: <Mono className="text-zinc-200">{formatBytes(stats.maxBytes)}</Mono> },
    { label: "Search freshness", value: <Mono className="text-zinc-200">{humanTtl(stats.ttl.searchMs)}</Mono> },
    { label: "Fetch freshness", value: <Mono className="text-zinc-200">{humanTtl(stats.ttl.fetchMs)}</Mono> },
    { label: "Search stale-if-error", value: <Mono className="text-amber-300/90">{humanTtl(stats.ttl.searchStaleMs)}</Mono> },
    { label: "Fetch stale-if-error", value: <Mono className="text-amber-300/90">{humanTtl(stats.ttl.fetchStaleMs)}</Mono> },
  ];
  return (
    <Card className={cardCls}>
      <CardContent className="p-4 sm:p-6">
        <SectionHeading title="Store" sub="config as the engine resolved it" />
        <div className="mt-3 flex flex-col divide-y divide-zinc-800/60">
          {rows.map((r) => (
            <div key={r.label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <span className="text-xs text-zinc-400">{r.label}</span>
              {r.value}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="text-xs text-zinc-400">Root</span>
            <Mono className="min-w-0 max-w-full truncate text-zinc-400" >
              <span title={stats.root}>{stats.root}</span>
            </Mono>
          </div>
        </div>
        {!stats.enabled && (
          <p className="mt-2 text-[11px] text-zinc-400">
            The store is bypassed — set <Mono>UNOWN_WEB_CACHE=1</Mono> (default) to serve cached answers again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function WebCacheTab() {
  const queryClient = useQueryClient();
  const { data: stats, isLoading } = useQuery({
    queryKey: qk.webcache,
    queryFn: api.webCacheStats,
    refetchInterval: 8000,
  });

  const clearStore = useMutation({
    mutationFn: mutations.webCacheClear,
    onSuccess: (d) => {
      toast.success("Web cache cleared", {
        description: `${d.removed} ${d.removed === 1 ? "entry" : "entries"} dropped · ${formatBytes(d.bytes)} freed`,
      });
      queryClient.invalidateQueries({ queryKey: qk.webcache });
    },
    onError: (err: Error) => {
      toast.error("Failed to clear the web cache", { description: err.message });
    },
  });

  const sweepNow = useMutation({
    mutationFn: mutations.webCacheSweep,
    onSuccess: (d) => {
      if (d.evicted > 0) {
        toast.success("Sweep complete", {
          description: `${d.evicted} ${d.evicted === 1 ? "entry" : "entries"} evicted · ${formatBytes(d.freedBytes)} freed of ${formatBytes(d.totalBytes)}`,
        });
      } else {
        toast.info("Sweep complete", {
          description: `store is under the byte cap (${formatBytes(d.totalBytes)}) — nothing to evict`,
        });
      }
      queryClient.invalidateQueries({ queryKey: qk.webcache });
    },
    onError: (err: Error) => {
      toast.error("Failed to sweep the web cache", { description: err.message });
    },
  });

  const t = stats?.totals;
  const lookups = (t?.hit ?? 0) + (t?.revalidated ?? 0) + (t?.miss ?? 0);
  const hitRate = lookups > 0 ? Math.round(((t?.hit ?? 0) + (t?.revalidated ?? 0)) / lookups * 100) : null;

  const events = stats?.recentEvents ?? [];
  const savedTrend = React.useMemo(
    () =>
      [...events.filter((e) => e.kind === "hit" || e.kind === "revalidated")]
        .reverse()
        .map((e, i) => ({ ts: e.ts, saved: i + 1 })),
    [events],
  );
  const providers = React.useMemo(
    () =>
      Object.entries(stats?.byProvider ?? {})
        .map(([provider, count]) => ({ provider, count }))
        .sort((a, b) => b.count - a.count),
    [stats?.byProvider],
  );
  const providerTotal = providers.reduce((acc, p) => acc + p.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-label="web results store">
        <SectionHeading
          title="Web results store"
          sub="persistent cache behind web_search + webfetch — exact-key, TTL-fresh, revalidation-checked"
          right={
            <div className="flex flex-wrap items-center gap-2">
              <ClearStoreConfirm disabled={clearStore.isPending} onConfirm={() => clearStore.mutate()} />
              <Button
                size="sm"
                variant="outline"
                disabled={sweepNow.isPending}
                onClick={() => sweepNow.mutate()}
                title="Run the byte-capped LRU eviction now (otherwise it runs opportunistically on writes)"
                className="h-8 gap-1.5 border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40"
              >
                <Recycle className="size-3.5" />
                {sweepNow.isPending ? "sweeping…" : "Sweep now"}
              </Button>
            </div>
          }
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
              label="Hit rate"
              value={hitRate === null ? "—" : `${hitRate}%`}
              sub={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="text-emerald-400">{t?.hit ?? 0} hits</span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-violet-400">{t?.revalidated ?? 0} revalidated</span>
                  <span className="text-zinc-400">·</span>
                  <span>{t?.miss ?? 0} misses</span>
                </span>
              }
              icon={<Gauge className="text-emerald-500/70" />}
            />
            <KpiCard
              label="Requests saved"
              value={stats?.savedRequests ?? 0}
              sub="hits + revalidations that skipped an upstream call"
              icon={<Zap className="text-emerald-500/70" />}
            />
            <KpiCard
              label="Cached size"
              value={formatBytes(stats?.bytes ?? 0)}
              sub={`of ${formatBytes(stats?.maxBytes ?? 0)} cap`}
              icon={<HardDrive className="text-emerald-500/70" />}
            />
            <KpiCard
              label="Entries"
              value={stats?.entries ?? 0}
              sub={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {stats?.index?.approximate ? (
                    <>
                      <span className="text-zinc-500" title={`in-memory index, ${Math.round((stats.index.ageMs ?? 0) / 1000)}s old — counts are per-process approximations`}>
                        ≈ indexed
                      </span>
                      <span className="text-zinc-400">·</span>
                    </>
                  ) : null}
                  <span className="text-amber-400">{t?.stale ?? 0} stale</span>
                  <span className="text-zinc-400">·</span>
                  <span>{t?.bypass ?? 0} bypass</span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-rose-400">{t?.error ?? 0} errors</span>
                </span>
              }
              icon={<Boxes className="text-emerald-500/70" />}
            />
          </div>
        )}
      </section>

      {isLoading ? (
        <div className="grid gap-4 xl:grid-cols-3" aria-hidden="true">
          <Card className={cardCls}>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
          <Card className={cn(cardCls, "xl:col-span-2")}>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-[220px] w-full" />
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <section className="grid gap-4 xl:grid-cols-3" aria-label="store config and save trend">
            {stats ? <ConfigCard stats={stats} /> : (
              <Card className={cardCls}>
                <CardContent className="p-4 sm:p-6">
                  <SectionHeading title="Store" sub="config as the engine resolved it" />
                  <div className="mt-3">
                    <EmptyState icon={<Database />} title="Store stats unavailable" hint="The engine is unreachable — retrying every 8s." />
                  </div>
                </CardContent>
              </Card>
            )}
            <Card className={cn(cardCls, "xl:col-span-2")}>
              <CardContent className="p-4 sm:p-6">
                <SectionHeading title="Requests saved" sub="cumulative hits + revalidations across the recent-events window" />
                <div className="mt-3">
                  <SavedTrendChart data={savedTrend} />
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="flex flex-col gap-3" aria-label="cache activity">
            <SectionHeading
              title="Activity"
              sub={`${events.length} most recent events — newest first`}
              right={
                <div className="flex flex-wrap items-center gap-1.5">
                  {Object.entries(stats?.byTool ?? {}).map(([tool, count]) => (
                    <StatChip key={tool} label={tool} value={count} />
                  ))}
                </div>
              }
            />
            <Card className={cardCls}>
              <CardContent className="p-0">
                {events.length === 0 ? (
                  <EmptyState
                    className="m-4"
                    icon={<Database />}
                    title="No cache events yet"
                    hint="Run a web_search or webfetch — every lookup lands here."
                  />
                ) : (
                  <div className="scroll-thin overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800 text-left text-[11px] tracking-wider text-zinc-400 uppercase">
                          <th className="px-4 py-2.5 font-medium">When</th>
                          <th className="px-4 py-2.5 font-medium">Kind</th>
                          <th className="px-4 py-2.5 font-medium">Tool</th>
                          <th className="px-4 py-2.5 font-medium">Provider</th>
                          <th className="px-4 py-2.5 font-medium">Detail</th>
                          <th className="px-4 py-2.5 text-right font-medium">Entry age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((e, i) => (
                          <tr key={`${e.ts}-${i}`} className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-900/70">
                            <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-zinc-400 tabular-nums" title={new Date(e.ts).toLocaleString()}>
                              {timeAgo(e.ts)}
                            </td>
                            <td className="px-4 py-2.5">
                              <Pill tone={kindTone[e.kind] ?? "zinc"}>{e.kind}</Pill>
                            </td>
                            <td className="px-4 py-2.5"><Mono className="text-zinc-300">{e.tool}</Mono></td>
                            <td className="px-4 py-2.5"><Mono className="text-zinc-400">{e.provider ?? "—"}</Mono></td>
                            <td className="max-w-[280px] px-4 py-2.5">
                              <span className="block truncate text-xs text-zinc-400" title={e.detail ?? ""}>
                                {e.detail ?? "—"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap text-zinc-400 tabular-nums">
                              {e.ageMs !== undefined ? formatDuration(e.ageMs) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="flex flex-col gap-3" aria-label="provider traffic">
            <SectionHeading title="Provider traffic" sub="cache events per provider / fetch method — the quota each lane saved or spent" />
            <Card className={cardCls}>
              <CardContent className="p-0">
                {providers.length === 0 ? (
                  <EmptyState className="m-4" icon={<Network />} title="No provider traffic yet" hint="Provider counts appear with the first cached search or fetch." />
                ) : (
                  <div className="scroll-thin overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800 text-left text-[11px] tracking-wider text-zinc-400 uppercase">
                          <th className="px-4 py-2.5 font-medium">Provider</th>
                          <th className="px-4 py-2.5 font-medium">Events</th>
                          <th className="px-4 py-2.5 text-right font-medium">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {providers.map((p) => (
                          <tr key={p.provider} className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-900/70">
                            <td className="px-4 py-2.5"><Mono className="text-zinc-200">{p.provider}</Mono></td>
                            <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-zinc-300">{p.count}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-400">
                              {providerTotal > 0 ? `${Math.round((p.count / providerTotal) * 100)}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            <p className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Database className="size-3.5 shrink-0" />
              one shared on-disk store serves every surface (terminal sessions, subagents, engine runs) — hits and 304
              revalidations never re-burn provider quota; stale answers are only served after upstream errors, always flagged.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

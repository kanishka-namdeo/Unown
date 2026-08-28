"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Radio, ServerCog } from "lucide-react";
import { api, qk } from "@/lib/agent-api";
import { formatClock } from "@/lib/agent-format";
import { useActivityStore } from "@/lib/agent-store";
import { Pill } from "./bits";
import { cn } from "@/lib/utils";

function Clock() {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  // Render placeholder until mounted to avoid hydration mismatch.
  return <span className="font-mono text-sm text-zinc-400 tabular-nums">{now ? formatClock(now) : "--:--:--"}</span>;
}

export function Header() {
  const { data } = useQuery({ queryKey: qk.overview, queryFn: api.overview, refetchInterval: 5000 });
  const connected = useActivityStore((s) => s.connected);

  const bridgeOk = data?.agent.bridge.ok ?? false;
  const busy = data?.routerBusy ?? false;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/75">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
            <Bot className="size-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-zinc-100">pi · self-learning agent</h1>
              <span className="hidden shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">
                {data?.agent.layer ?? "self-learning"}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
              <span title="LLM provider" className="truncate font-mono">{data?.agent.provider ?? "provider"}</span>
              <span className="hidden items-center gap-1.5 sm:inline-flex" title={bridgeOk ? "bridge up" : "bridge down"}>
                <span className="relative flex size-2">
                  {bridgeOk && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                  )}
                  <span className={cn("relative inline-flex size-2 rounded-full", bridgeOk ? "bg-emerald-400" : "bg-rose-500")} />
                </span>
                bridge {bridgeOk ? "up" : "down"}
              </span>
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500" title="self-learning engine state">
            <ServerCog className="size-3.5" />
            <Pill tone={busy ? "amber" : "emerald"} pulse={busy}>
              {busy ? "engine busy" : "engine idle"}
            </Pill>
          </span>
          {connected ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold tracking-widest text-emerald-400"
              title="live event stream connected"
            >
              <Radio className="size-3.5 animate-pulse" />
              LIVE
            </span>
          ) : (
            <Clock />
          )}
        </div>
      </div>
    </header>
  );
}

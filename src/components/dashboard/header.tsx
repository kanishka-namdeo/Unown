"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Command, Home, Radio, RefreshCw, ServerCog, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, qk } from "@/lib/agent-api";
import { formatClock } from "@/lib/agent-format";
import { useActivityStore } from "@/lib/agent-store";
import { useCommandPaletteStore } from "./command-palette";
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
  const queryClient = useQueryClient();
  const setCommandOpen = useCommandPaletteStore((s) => s.setOpen);
  const { data, isError, isFetching } = useQuery({
    queryKey: qk.overview,
    queryFn: api.overview,
    refetchInterval: 5000,
  });
  const connected = useActivityStore((s) => s.connected);

  const bridgeOk = data?.agent.bridge.ok ?? false;
  const busy = data?.routerBusy ?? false;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/75">
      {isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-rose-500/40 bg-rose-500/10 px-4 py-1.5 text-xs text-rose-300 sm:px-6"
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="font-medium">engine unreachable</span>
          <span className="text-rose-300/80">— retrying every 5s; data below may be stale</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 gap-1.5 border-rose-500/40 bg-transparent text-[11px] text-rose-300 hover:bg-rose-500/20"
            onClick={() => queryClient.invalidateQueries()}
          >
            <RefreshCw className={cn("size-3", isFetching && "animate-spin")} />
            retry now
          </Button>
        </div>
      )}
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
            <Bot className="size-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-zinc-100">unown · self-learning agent</h1>
              <span className="hidden shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline">
                {data?.agent.layer ?? "self-learning"}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
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
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="hidden items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 md:inline-flex"
            title="open the command palette"
            aria-label="open command palette"
          >
            <Command className="size-3" />
            K
          </button>
          <a
            href="/"
            className="hidden items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 sm:inline-flex"
            title="back to the landing page"
          >
            <Home className="size-3" />
            home
          </a>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400" title="self-learning engine state">
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

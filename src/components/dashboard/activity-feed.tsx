"use client";

// Live activity feed driven by the zustand activity store (SSE events).

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  CheckCircle2,
  Layers,
  Moon,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  StickyNote,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useActivityStore } from "@/lib/agent-store";
import type { ActivityItem } from "@/lib/agent-types";
import { timeAgo } from "@/lib/agent-format";
import { EmptyState } from "./bits";
import { cn } from "@/lib/utils";

function iconFor(item: ActivityItem): React.ReactNode {
  const cls = "size-3.5 shrink-0";
  if (item.event.startsWith("run:")) {
    if (item.tone === "emerald") return <CheckCircle2 className={cn(cls, "text-emerald-400")} />;
    if (item.tone === "rose") return <XCircle className={cn(cls, "text-rose-400")} />;
    return <PlayCircle className={cn(cls, "text-amber-400")} />;
  }
  if (item.event.startsWith("cycle:")) return <RefreshCw className={cn(cls, "text-amber-400")} />;
  if (item.event.startsWith("improvement:"))
    return <Sparkles className={cn(cls, item.tone === "emerald" ? "text-emerald-400" : "text-amber-400")} />;
  if (item.event.startsWith("dream:")) return <Moon className={cn(cls, "text-amber-400")} />;
  if (item.event === "memory:changed") return <Layers className={cn(cls, "text-emerald-400")} />;
  if (item.event === "hook") return <ShieldCheck className={cn(cls, "text-zinc-400")} />;
  if (item.event === "note:created") return <StickyNote className={cn(cls, "text-zinc-400")} />;
  if (item.event.startsWith("job:")) return <CalendarClock className={cn(cls, item.tone === "rose" ? "text-rose-400" : "text-amber-400")} />;
  if (item.event === "router:error") return <TriangleAlert className={cn(cls, "text-rose-400")} />;
  return <PlayCircle className={cn(cls, "text-zinc-400")} />;
}

const toneText: Record<string, string> = {
  emerald: "text-emerald-300/90",
  amber: "text-amber-300/90",
  rose: "text-rose-300/90",
  zinc: "text-zinc-400",
};

export function ActivityFeed({
  filter,
  max = 30,
  className,
  maxHeight = "max-h-[420px]",
}: {
  filter?: (item: ActivityItem) => boolean;
  max?: number;
  className?: string;
  maxHeight?: string;
}) {
  const items = useActivityStore((s) => s.items);
  const filtered = React.useMemo(
    () => (filter ? items.filter(filter) : items).slice(0, max),
    [items, filter, max]
  );

  return (
    <div
      className={cn("scroll-thin overflow-y-auto pr-1", maxHeight, className)}
      role="log"
      aria-label="live activity feed"
    >
      {filtered.length === 0 ? (
        <EmptyState
          icon={<PlayCircle />}
          title="No live events yet"
          hint="Waiting for agent activity…"
          className="border-zinc-800/60 py-8"
        />
      ) : (
        <ul className="flex flex-col gap-0.5">
          <AnimatePresence initial={false}>
            {filtered.map((item) => (
              <motion.li
                key={item.key}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-900/70"
              >
                <span className="mt-0.5">{iconFor(item)}</span>
                <span className={cn("min-w-0 flex-1 text-xs leading-5", toneText[item.tone])}>{item.text}</span>
                <span className="shrink-0 pt-px font-mono text-[10px] text-zinc-400 tabular-nums">
                  {timeAgo(item.ts)}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

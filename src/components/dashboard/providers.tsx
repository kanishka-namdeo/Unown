"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { EVENTS_URL, qk } from "@/lib/agent-api";
import { useActivityStore } from "@/lib/agent-store";
import type { AgentEvent } from "@/lib/agent-types";

let eventSeq = 0;
let seenHello = false; // the backend greets every (re)connect — only surface it once per page load

type Tone = "emerald" | "amber" | "rose" | "zinc";

interface ActivityDesc {
  text: string;
  tone: Tone;
}

function str(p: Record<string, unknown>, k: string, fallback = "unknown"): string {
  const v = p[k];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}

function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k];
  return typeof v === "number" ? v : undefined;
}

// Translate an SSE event into a human-readable activity line.
function describe(ev: AgentEvent): ActivityDesc | null {
  const p = ev.payload ?? {};
  switch (ev.event) {
    case "hello":
      if (seenHello) return null;
      seenHello = true;
      return { text: "connected to agent event stream", tone: "emerald" };
    case "ping":
      return null;
    case "run:started":
      return { text: `run started · ${str(p, "taskId")} · ${str(p, "kind")}`, tone: "amber" };
    case "run:finished": {
      const status = str(p, "status");
      const dur = num(p, "durationMs");
      const tone: Tone = status === "passed" ? "emerald" : status === "running" ? "amber" : "rose";
      const durTxt = dur !== undefined ? ` · ${Math.round(dur / 1000)}s` : "";
      return { text: `run finished · ${str(p, "taskId")} · ${status}${durTxt}`, tone };
    }
    case "run:tool":
      return null;
    case "run:text":
      return null;
    case "cycle:started":
      return { text: `cycle started · ${str(p, "taskId")}`, tone: "amber" };
    case "cycle:finished":
      return {
        text: `cycle finished · ${str(p, "taskId")} · ${str(p, "status")}`,
        tone: str(p, "status") === "improved" ? "emerald" : "rose",
      };
    case "improvement:proposed":
      return { text: `improvement proposed · ${str(p, "taskId")} · iter ${str(p, "iteration")}`, tone: "amber" };
    case "improvement:shipped":
      return { text: `improvement shipped · ${str(p, "taskId")} → ${str(p, "tier")} memory`, tone: "emerald" };
    case "dream:started":
      return { text: `autodream started · ${str(p, "notesIn")} notes in`, tone: "amber" };
    case "dream:finished":
      return {
        text: `dream finished · ${str(p, "status")}${p.version !== undefined ? ` · memory v${str(p, "version")}` : ""}`,
        tone: str(p, "status") === "done" ? "emerald" : "rose",
      };
    case "memory:changed":
      return { text: `${str(p, "tier")} memory → v${str(p, "version")} · by ${str(p, "changedBy")}`, tone: "emerald" };
    case "hook": {
      const decision = str(p, "decision");
      const tone: Tone =
        decision === "deny" || decision === "log-error" ? "rose" : decision === "augment" ? "amber" : "zinc";
      const tool = p.tool ? ` · ${str(p, "tool")}` : "";
      return { text: `hook ${str(p, "hook")}${tool} · ${decision}`, tone };
    }
    case "note:created":
      return { text: "session note captured", tone: "zinc" };
    case "job:started":
      return { text: `job started · ${str(p, "name")}`, tone: "amber" };
    case "job:finished":
      return { text: `job finished · ${str(p, "name")}`, tone: "emerald" };
    case "job:error":
      return { text: `job error · ${str(p, "name")}`, tone: "rose" };
    case "router:error":
      return { text: `router error · ${str(p, "error", "unknown").slice(0, 80)}`, tone: "rose" };
    default:
      return { text: ev.event, tone: "zinc" };
  }
}

// Which queries to invalidate per event.
function invalidations(event: string): readonly (readonly unknown[])[] {
  switch (event) {
    case "run:started":
    case "run:finished":
      return [qk.runs, qk.overview, qk.tasks, qk.cycles, qk.sandboxes];
    case "cycle:started":
    case "cycle:finished":
      return [qk.cycles, qk.overview];
    case "improvement:proposed":
    case "improvement:shipped":
      return [qk.improvements, qk.cycles, qk.overview];
    case "dream:started":
    case "dream:finished":
      return [qk.dreams, qk.notes, qk.memory, qk.overview];
    case "memory:changed":
      return [qk.memory, qk.overview];
    case "hook":
      return [qk.hooks, qk.overview];
    case "note:created":
      return [qk.notes, qk.overview];
    case "job:started":
    case "job:finished":
    case "job:error":
      return [qk.jobs, qk.overview];
    case "router:error":
      return [qk.overview];
    default:
      return [];
  }
}

function SseBridge() {
  const queryClient = useQueryClient();
  const push = useActivityStore((s) => s.push);
  const setConnected = useActivityStore((s) => s.setConnected);

  React.useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;

    const handleMessage = (raw: string) => {
      try {
        const msg = JSON.parse(raw) as AgentEvent;
        const desc = describe(msg);
        if (desc) {
          push({
            key: `${msg.ts}-${eventSeq++}`,
            ts: msg.ts ?? Date.now(),
            event: msg.event,
            text: desc.text,
            tone: desc.tone,
          });
        }
        for (const key of invalidations(msg.event)) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        if (msg.event === "router:error") {
          const err = typeof msg.payload?.error === "string" ? msg.payload.error : "router error";
          toast.error("Router error", { description: err.slice(0, 140) });
        }
      } catch {
        // malformed frame — ignore
      }
    };

    const connect = () => {
      es = new EventSource(EVENTS_URL);
      es.onopen = () => setConnected(true);
      es.onmessage = (e: MessageEvent<string>) => handleMessage(e.data);
      es.onerror = () => {
        setConnected(false);
        // EventSource auto-reconnects; if it gave up (readyState CLOSED), retry manually.
        if (es && es.readyState === EventSource.CLOSED && !closed) {
          es.close();
          setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      es?.close();
      setConnected(false);
    };
  }, [queryClient, push, setConnected]);

  return null;
}

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 4000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      <SseBridge />
      {children}
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}

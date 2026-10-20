"use client";

// ⌘K command palette (cmdk): jump between tabs, open docs, refresh data.
// Tab jumps go through the shared tab store (tab-store.ts), which keeps the
// URL (?tab=) in sync — no coupling to the tab strip component.

import * as React from "react";
import { create } from "zustand";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Code2,
  Database,
  FlaskConical,
  Layers,
  LayoutDashboard,
  Moon,
  Network,
  RefreshCw,
  Router as RouterIcon,
  Search,
  Server,
  ShieldCheck,
  SquareTerminal,
  Box,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { useActivityStore } from "@/lib/agent-store";
import { useTabStore } from "./tab-store";

interface CommandState {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export const useCommandPaletteStore = create<CommandState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
}));

const TAB_TARGETS = [
  { value: "overview", label: "Overview", icon: LayoutDashboard, hint: "KPIs, trend, tasks" },
  { value: "lab", label: "Learning Lab", icon: FlaskConical, hint: "cycles, improvements, runs" },
  { value: "memory", label: "Memory", icon: Layers, hint: "tiers, versions, skills" },
  { value: "dreams", label: "Dreams", icon: Moon, hint: "AutoDream runs and notes" },
  { value: "hooks", label: "Hooks", icon: ShieldCheck, hint: "guardrail decision log" },
  { value: "console", label: "Console", icon: SquareTerminal, hint: "prompt the agent live" },
  { value: "sandboxes", label: "Sandboxes", icon: Box, hint: "isolated run workspaces" },
  { value: "gateway", label: "Gateway", icon: Network, hint: "LLM bridge request log" },
  { value: "providers", label: "Providers", icon: Server, hint: "model provider registry" },
  { value: "router", label: "Router", icon: RouterIcon, hint: "background jobs" },
  { value: "automations", label: "Automations", icon: CalendarClock, hint: "scheduled agent runs" },
  { value: "webcache", label: "Web Cache", icon: Database, hint: "web results store" },
];

export function CommandPalette() {
  const queryClient = useQueryClient();
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const setTab = useTabStore((s) => s.setTab);
  const connected = useActivityStore((s) => s.connected);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, setOpen]);

  const goTab = (value: string) => {
    setOpen(false);
    setTab(value);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {TAB_TARGETS.map((t) => (
            <CommandItem key={t.value} value={`tab ${t.value} ${t.label}`} onSelect={() => goTab(t.value)}>
              <t.icon className="size-4" />
              <span>{t.label}</span>
              <span className="ml-auto hidden text-[11px] text-zinc-400 sm:inline">{t.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="refresh all data"
            onSelect={() => {
              queryClient.invalidateQueries();
              setOpen(false);
            }}
          >
            <RefreshCw className="size-4" />
            <span>Refresh all data</span>
            <CommandShortcut>invalidates every query</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Links">
          <CommandItem
            value="github repository"
            onSelect={() => {
              setOpen(false);
              window.open("https://github.com/kanishka-namdeo/Unown", "_blank", "noopener");
            }}
          >
            <Code2 className="size-4" />
            <span>GitHub repository</span>
            <ArrowRight className="ml-auto size-3 opacity-50" />
          </CommandItem>
          <CommandItem
            value="quickstart docs"
            onSelect={() => {
              setOpen(false);
              window.open("https://github.com/kanishka-namdeo/Unown/blob/main/docs/quickstart.md", "_blank", "noopener");
            }}
          >
            <BookOpen className="size-4" />
            <span>Quickstart docs</span>
            <ArrowRight className="ml-auto size-3 opacity-50" />
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <p className="px-3 py-2 text-[11px] text-zinc-400" aria-live="polite">
          {connected ? (
            <>
              <Search className="mr-1 inline size-3" />
              live event stream connected — feed updates land without refresh
            </>
          ) : (
            "event stream reconnecting…"
          )}
        </p>
      </CommandList>
    </CommandDialog>
  );
}

"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Box,
  CalendarClock,
  FlaskConical,
  Layers,
  LayoutDashboard,
  Moon,
  Network,
  Router as RouterIcon,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardProviders } from "@/components/dashboard/providers";
import { Header } from "@/components/dashboard/header";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { syncTabFromUrl, useTabStore } from "@/components/dashboard/tab-store";
import { OverviewTab } from "@/components/dashboard/overview-tab";
import { LearningLabTab } from "@/components/dashboard/learning-lab-tab";
import { MemoryTab } from "@/components/dashboard/memory-tab";
import { DreamsTab } from "@/components/dashboard/dreams-tab";
import { HooksTab } from "@/components/dashboard/hooks-tab";
import { ConsoleTab } from "@/components/dashboard/console-tab";
import { SandboxesTab } from "@/components/dashboard/sandboxes-tab";
import { GatewayTab } from "@/components/dashboard/gateway-tab";
import { RouterTab } from "@/components/dashboard/router-tab";
import { AutomationsTab } from "@/components/dashboard/automations-tab";

const tabs = [
  { value: "overview", label: "Overview", icon: LayoutDashboard, content: <OverviewTab /> },
  { value: "lab", label: "Learning Lab", icon: FlaskConical, content: <LearningLabTab /> },
  { value: "memory", label: "Memory", icon: Layers, content: <MemoryTab /> },
  { value: "dreams", label: "Dreams", icon: Moon, content: <DreamsTab /> },
  { value: "hooks", label: "Hooks", icon: ShieldCheck, content: <HooksTab /> },
  { value: "console", label: "Console", icon: SquareTerminal, content: <ConsoleTab /> },
  { value: "sandboxes", label: "Sandboxes", icon: Box, content: <SandboxesTab /> },
  { value: "gateway", label: "Gateway", icon: Network, content: <GatewayTab /> },
  { value: "router", label: "Router", icon: RouterIcon, content: <RouterTab /> },
  { value: "automations", label: "Automations", icon: CalendarClock, content: <AutomationsTab /> },
];

function TabFade({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

// URL-synced tab surface: ?tab=<value> is the durable source of truth
// (shareable deep links, working back/forward via popstate) — see tab-store.
function DashboardTabs() {
  const tab = useTabStore((s) => s.tab);
  const setTab = useTabStore((s) => s.setTab);

  React.useEffect(() => syncTabFromUrl(), []);

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-5">
      <div className="scroll-thin -mx-1 overflow-x-auto px-1 pb-1">
        <TabsList className="h-auto w-max gap-1 border border-zinc-800 bg-zinc-900/80 p-1">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="h-11 gap-1.5 px-3 text-xs text-zinc-400 transition-colors hover:text-zinc-200 sm:h-9 sm:text-sm data-[state=active]:border-zinc-700 data-[state=active]:bg-zinc-800 data-[state=active]:text-emerald-400 data-[state=active]:shadow-none"
            >
              <t.icon className="size-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="mt-0">
          <TabFade>{t.content}</TabFade>
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default function Page() {
  return (
    <DashboardProviders>
      <div className="flex min-h-screen flex-col bg-zinc-950 font-sans text-zinc-100">
        {/* global scrollbar styling for this dark page */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
.scroll-thin { scrollbar-width: thin; scrollbar-color: #3f3f46 transparent; }
.scroll-thin::-webkit-scrollbar { width: 6px; height: 6px; }
.scroll-thin::-webkit-scrollbar-track { background: transparent; }
.scroll-thin::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
.scroll-thin::-webkit-scrollbar-thumb:hover { background: #52525b; }
`,
          }}
        />

        <Header />
        <CommandPalette />

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <DashboardTabs />
        </main>

        <footer className="mt-auto border-t border-zinc-800/70 bg-zinc-950">
          <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-1.5 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[11px] text-zinc-400 sm:px-6">
            <span>unown — badlogic/pi-mono + the self-learning layer</span>
            <span className="font-mono">LLM gateway :3031 · engine :3030 · ⌘K to navigate</span>
          </div>
        </footer>
      </div>
    </DashboardProviders>
  );
}

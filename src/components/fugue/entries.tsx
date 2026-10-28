/**
 * Fugue — client dashboard: auth shell + page entry points.
 * PLAN.md §7: all pages are client components that fetch from the API.
 * ?embed=1 is read server-side in each page.tsx and passed as a prop.
 */
"use client";

import { useEffect, useState } from "react";
import FugueShell from "@/components/fugue/Shell";
import FlowsPage from "@/components/fugue/FlowsPage";
import RunsPage from "@/components/fugue/RunsPage";
import StatsPage from "@/components/fugue/StatsPage";
import { apiFetch } from "@/components/fugue/shared";
import type { Workspace } from "@/lib/fugue/types";

function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    apiFetch<{ workspaces: Workspace[] }>("/workspaces").then((body) => {
      if (body) setWorkspaces(body.workspaces);
      setReady(true);
    });
  }, []);
  return { workspaces, ready };
}

export function FlowsEntry({ embed }: { embed: boolean }) {
  const { workspaces, ready } = useWorkspaces();
  return (
    <FugueShell embed={embed} initialWorkspaceId={undefined}>
      {ready ? <FlowsPage workspaces={workspaces} /> : null}
    </FugueShell>
  );
}

export function RunsEntry({ embed }: { embed: boolean }) {
  const { workspaces, ready } = useWorkspaces();
  return (
    <FugueShell embed={embed} initialWorkspaceId={undefined}>
      {ready ? <RunsPage workspaces={workspaces} /> : null}
    </FugueShell>
  );
}

export function StatsEntry({ embed }: { embed: boolean }) {
  const { workspaces, ready } = useWorkspaces();
  return (
    <FugueShell embed={embed} initialWorkspaceId={undefined}>
      {ready ? <StatsPage workspaces={workspaces} /> : null}
    </FugueShell>
  );
}

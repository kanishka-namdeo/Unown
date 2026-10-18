"use client";

// Router tab: scheduled/evented background jobs + live job event feed.

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Play, Router, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { api, mutations, qk } from "@/lib/agent-api";
import { formatAbsolute, humanizeInterval, timeAgo } from "@/lib/agent-format";
import type { ActivityItem } from "@/lib/agent-types";
import { EmptyState, Mono, Pill, SectionHeading } from "./bits";
import { ActivityFeed } from "./activity-feed";
import { cn } from "@/lib/utils";

const cardCls = "border-zinc-800 bg-zinc-900/60";

const jobEventFilter = (item: ActivityItem) => item.event.startsWith("job:");

export function RouterTab() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: qk.jobs, queryFn: api.jobs, refetchInterval: 8000 });
  const jobs = data?.jobs ?? [];

  const trigger = useMutation({
    mutationFn: (id: string) => mutations.jobTrigger(id),
    onSuccess: (_d, id) => {
      const job = jobs.find((j) => j.id === id);
      toast.success("Job started", {
        description:
          id === "harness-cycle"
            ? `"${job?.name ?? id}" takes minutes — watch Learning Lab for the cycle.`
            : `"${job?.name ?? id}" is running.`,
      });
      queryClient.invalidateQueries({ queryKey: qk.jobs });
      queryClient.invalidateQueries({ queryKey: qk.overview });
    },
    onError: (err: Error & { status?: number }, id) => {
      if (err.status === 409) {
        toast.warning("Engine busy — a background job is learning right now", {
          description: `"${id}" could not start. Try again in a moment.`,
        });
      } else {
        toast.error("Failed to trigger job", { description: err.message });
      }
    },
  });

  const toggle = useMutation({
    mutationFn: (id: string) => mutations.jobToggle(id),
    onSuccess: (d) => {
      toast.success(d.job.enabled ? `Enabled "${d.job.name}"` : `Disabled "${d.job.name}"`);
      queryClient.invalidateQueries({ queryKey: qk.jobs });
    },
    onError: (err: Error) => toast.error("Toggle failed", { description: err.message }),
  });

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Router"
        sub="interval + event jobs keep the learning loop running without supervision"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="flex flex-col gap-3 lg:col-span-2" aria-label="jobs">
          {jobs.length === 0 ? (
            <EmptyState icon={<Router />} title="No jobs registered" />
          ) : (
            jobs.map((j) => {
              const running = j.status === "running";
              return (
                <Card key={j.id} className={cn(cardCls, j.enabled === 0 && "opacity-60")}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex size-8 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10">
                            {j.kind === "interval" ? (
                              <CalendarClock className="size-4 text-emerald-400" />
                            ) : (
                              <Zap className="size-4 text-amber-400" />
                            )}
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-zinc-200">{j.name}</p>
                            <Mono className="text-zinc-400">{j.id}</Mono>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Pill tone={running ? "amber" : "zinc"} pulse={running}>
                          {running ? "running" : "idle"}
                        </Pill>
                        <Switch
                          checked={j.enabled === 1}
                          disabled={toggle.isPending}
                          onCheckedChange={() => toggle.mutate(j.id)}
                          aria-label={`toggle ${j.name}`}
                          className="data-[state=checked]:bg-emerald-500"
                        />
                      </div>
                    </div>

                    <p className="text-xs leading-5 text-zinc-400">{j.description}</p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-zinc-400">
                      <span className="inline-flex items-center gap-1.5">
                        {j.kind === "interval" ? (
                          <>
                            <CalendarClock className="size-3" />
                            {humanizeInterval(j.schedule_ms)}
                          </>
                        ) : (
                          <>
                            <Zap className="size-3" />
                            on <span className="text-amber-400/80">{j.event ?? "event"}</span>
                          </>
                        )}
                      </span>
                      <span>runs: <span className="text-zinc-300 tabular-nums">{j.run_count}</span></span>
                      <span>last: {timeAgo(j.last_run)}</span>
                      {j.kind === "interval" && j.enabled === 1 && (
                        <span>next: {formatAbsolute(j.next_run)}</span>
                      )}
                    </div>

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={trigger.isPending || running}
                        onClick={() => trigger.mutate(j.id)}
                        className="h-9 gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      >
                        <Play className="size-3.5" />
                        Trigger
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </section>

        <section className="flex flex-col gap-3" aria-label="job events">
          <SectionHeading title="Job events" sub="live from the router" />
          <Card className={cardCls}>
            <CardContent className="p-3">
              <ActivityFeed filter={jobEventFilter} maxHeight="max-h-[560px]" />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

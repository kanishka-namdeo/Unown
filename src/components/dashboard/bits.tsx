"use client";

// Shared presentational bits for the dashboard: tone pills, status badges,
// empty states, section headings.

import * as React from "react";
import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

export type Tone = "emerald" | "amber" | "rose" | "violet" | "zinc" | "orange" | "outline";

const toneClasses: Record<Tone, string> = {
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  violet: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  zinc: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  orange: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  outline: "bg-transparent text-zinc-400 border-zinc-700",
};

export function Pill({
  tone = "zinc",
  pulse = false,
  className,
  children,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap",
        toneClasses[tone],
        className
      )}
    >
      {pulse && <span className="relative flex size-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex size-1.5 rounded-full bg-current" /></span>}
      {children}
    </span>
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "passed":
      return <Pill tone="emerald">passed</Pill>;
    case "failed":
      return <Pill tone="rose">failed</Pill>;
    case "running":
      return <Pill tone="amber" pulse>running</Pill>;
    case "error":
      return <Pill tone="rose">error</Pill>;
    default:
      return <Pill tone="zinc">{status}</Pill>;
  }
}

export function RunKindBadge({ kind }: { kind: string }) {
  switch (kind) {
    case "baseline":
      return <Pill tone="zinc">baseline</Pill>;
    case "candidate":
      return <Pill tone="amber">candidate</Pill>;
    case "regression":
      return <Pill tone="violet">regression</Pill>;
    case "interactive":
      return <Pill tone="emerald">interactive</Pill>;
    default:
      return <Pill tone="zinc">{kind}</Pill>;
  }
}

export function CycleStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "improved":
      return <Pill tone="emerald">improved</Pill>;
    case "no-fix":
      return <Pill tone="rose">no-fix</Pill>;
    case "already-passing":
      return <Pill tone="zinc">already-passing</Pill>;
    case "running":
      return <Pill tone="amber" pulse>running</Pill>;
    default:
      return <Pill tone="zinc">{status}</Pill>;
  }
}

export function ImprovementStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "shipped":
      return <Pill tone="emerald">shipped</Pill>;
    case "proposed":
      return <Pill tone="amber">proposed</Pill>;
    case "validated":
      return <Pill tone="zinc">validated</Pill>;
    case "rejected":
      return <Pill tone="rose">rejected</Pill>;
    default:
      return <Pill tone="zinc">{status}</Pill>;
  }
}

export function DecisionBadge({ decision }: { decision: string }) {
  switch (decision) {
    case "allow":
      return <Pill tone="emerald">allow</Pill>;
    case "deny":
      return <Pill tone="rose">deny</Pill>;
    case "augment":
      return <Pill tone="amber">augment</Pill>;
    case "log-error":
      return <Pill tone="rose">log-error</Pill>;
    case "log":
      return <Pill tone="zinc">log</Pill>;
    default:
      return <Pill tone="zinc">{decision}</Pill>;
  }
}

export function ChangedByBadge({ changedBy }: { changedBy: string }) {
  switch (changedBy) {
    case "seed":
      return <Pill tone="zinc">seed</Pill>;
    case "harness":
      return <Pill tone="emerald">harness</Pill>;
    case "autodream":
      return <Pill tone="amber">autodream</Pill>;
    case "manual":
      return <Pill tone="orange">manual</Pill>;
    case "rollback":
      return <Pill tone="outline">rollback</Pill>;
    default:
      return <Pill tone="zinc">{changedBy}</Pill>;
  }
}

export function DreamStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "done":
      return <Pill tone="emerald">done</Pill>;
    case "running":
      return <Pill tone="amber" pulse>running</Pill>;
    case "no-notes":
      return <Pill tone="zinc">no-notes</Pill>;
    case "error":
      return <Pill tone="rose">error</Pill>;
    default:
      return <Pill tone="zinc">{status}</Pill>;
  }
}

export function EmptyState({
  icon,
  title,
  hint,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 px-6 py-10 text-center", className)}>
      {icon && <div className="text-zinc-600 [&_svg]:size-6">{icon}</div>}
      <p className="text-sm text-zinc-400">{title}</p>
      {hint && <p className="text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

export function SectionHeading({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-zinc-200 uppercase">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function DifficultyStars({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`difficulty ${level} of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn("size-3", i < level ? "fill-amber-400/80 text-amber-400/80" : "text-zinc-700")}
        />
      ))}
    </span>
  );
}

export function StatChip({ label, value, tone = "zinc" }: { label: string; value: React.ReactNode; tone?: Tone }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 rounded-md border px-2 py-1", toneClasses[tone])}>
      <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] opacity-70">{label}</span>
    </span>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-zinc-300", className)}>{children}</span>;
}

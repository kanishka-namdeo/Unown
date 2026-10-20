// Formatting utilities — relative time, compact numbers, durations.

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 0) return "soon";
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}k`;
  }
  const v = n / 1_000_000;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}M`;
}

/** Byte sizes for the web results store KPIs/config (KiB/MiB/GiB ladder). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const steps: [number, string][] = [
    [1024 ** 2, "KiB"],
    [1024 ** 3, "MiB"],
    [1024 ** 4, "GiB"],
  ];
  for (const [limit, unit] of steps) {
    if (bytes < limit) {
      const v = bytes / (limit / 1024);
      return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} ${unit}`;
    }
  }
  return `${Math.round(bytes / 1024 ** 4)} GiB`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour12: false });
}

export function formatAbsolute(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function humanizeInterval(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms % 3_600_000 === 0) {
    const h = ms / 3_600_000;
    return `every ${h}h`;
  }
  if (ms % 60_000 === 0) {
    const m = ms / 60_000;
    return `every ${m}m`;
  }
  return `every ${Math.round(ms / 1000)}s`;
}

export function truncateMiddle(s: string | null | undefined, max = 24): string {
  if (!s) return "—";
  if (max <= 0) return "";
  // Code-point aware so astral chars (emoji) are never split into lone
  // UTF-16 surrogates.
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  // No room for a middle ellipsis — hard-cut instead of growing the string.
  if (max <= 3) return chars.slice(0, max).join("");
  const half = Math.floor((max - 1) / 2);
  return `${chars.slice(0, half).join("")}…${chars.slice(-half).join("")}`;
}

export function truncateEnd(s: string | null | undefined, max = 90): string {
  if (!s) return "—";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

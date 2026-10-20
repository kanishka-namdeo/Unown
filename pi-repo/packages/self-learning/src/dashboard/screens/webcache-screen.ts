/**
 * screens/webcache-screen.ts — the research memory's cache layer: hit-rate +
 * saved-request KPIs, an entries/bytes meter against the byte cap, the TTL /
 * index / root config block (approximate counts are labeled as such — never
 * presented as exact), per-provider traffic, and the recent-events feed.
 *
 * `s` sweeps to the byte cap (LRU, keeps recent entries); `x` clears the
 * whole store (destructive, confirm-gated). Both mutate via the engine and
 * the store refetches the stats — the events feed itself is append-only.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { WebCacheEvent, WebCacheEventKind, WebCacheStats } from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import {
	ageStamp,
	badge,
	emptyState,
	errorState,
	formatBytes,
	formatInterval,
	heading,
	loadingState,
	meter,
	pill,
	type Tone,
	timeAgo,
	trunc,
} from "../widgets/bits.ts";

/** Rows the KPI band, config block, provider line and headings occupy. */
const FIXED_ROWS = 12;

/** Event kind → tone (hit/revalidated good, stale/evict pressure, clear/error bad). */
function kindTone(kind: WebCacheEventKind): Tone {
	switch (kind) {
		case "hit":
		case "revalidated":
			return "emerald";
		case "miss":
		case "bypass":
			return "zinc";
		case "stale":
		case "evict":
			return "amber";
		case "clear":
		case "error":
			return "rose";
	}
}

export function createWebCacheScreen(deps: ScreenDeps): Screen {
	const { store, theme, toast, requestRender, confirm } = deps;
	let viewport = 24;

	const snap = () => store.snapshot<WebCacheStats>("webcache");
	const events = (): WebCacheEvent[] => snap().data?.recentEvents ?? [];
	const win: SelectionWindow = new Window(
		() => events().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	// ---- rendering ----------------------------------------------------------

	function renderKpis(s: WebCacheStats, width: number): string[] {
		const t = s.totals ?? { hit: 0, revalidated: 0, miss: 0, stale: 0, bypass: 0, evict: 0, clear: 0, error: 0 };
		const lookups = t.hit + t.revalidated + t.miss + t.stale + t.bypass + t.error;
		const rate = lookups > 0 ? (t.hit + t.revalidated) / lookups : null;
		const rateTxt =
			rate === null
				? theme.fg("dim", "—")
				: pill(theme, `${Math.round(rate * 100)}%`, rate >= 0.6 ? "emerald" : rate >= 0.3 ? "amber" : "rose");
		const bytes = s.bytes ?? 0;
		const maxBytes = Math.max(1, s.maxBytes ?? 0);
		return [
			trunc(
				`${theme.fg("muted", "hit rate ")}${rateTxt}   ${theme.fg("muted", "saved ")}${theme.fg("success", `${s.savedRequests ?? 0} requests`)}`,
				width,
			),
			trunc(
				`${theme.fg("muted", "store ")}${theme.fg("text", `${s.entries ?? 0} entries`)}  ${meter(theme, bytes / maxBytes, 14)} ` +
					`${theme.fg("dim", `${formatBytes(bytes)} / ${formatBytes(s.maxBytes ?? 0)}`)}`,
				width,
			),
		];
	}

	function renderConfig(s: WebCacheStats, width: number): string[] {
		const ttl = s.ttl ?? { searchMs: 0, fetchMs: 0, searchStaleMs: 0, fetchStaleMs: 0 };
		const idx = s.index ?? { mode: "memory", ageMs: 0, approximate: false };
		const lines: string[] = [heading(theme, "config")];
		lines.push(
			trunc(
				`${theme.fg("muted", "ttl ")}${theme.fg("dim", `search ${formatInterval(ttl.searchMs)} · fetch ${formatInterval(ttl.fetchMs)} · stale windows ${formatInterval(ttl.searchStaleMs)} / ${formatInterval(ttl.fetchStaleMs)}`)}`,
				width,
			),
		);
		const indexTxt = `${theme.fg("muted", "index ")}${theme.fg("dim", `${idx.mode} · ${ageStamp(theme, idx.ageMs)}`)}`;
		lines.push(
			idx.approximate
				? trunc(
						`${indexTxt}${theme.fg("warning", " · approximate — entry/byte counts are a snapshot (exact: UNOWN_WEB_CACHE_INDEX_MS=0)")}`,
						width,
					)
				: indexTxt,
		);
		lines.push(trunc(`${theme.fg("muted", "root ")}${theme.fg("dim", s.root ?? "—")}`, width));
		return lines;
	}

	function renderProviders(s: WebCacheStats, width: number): string {
		const entries = Object.entries(s.byProvider ?? {}).sort((a, b) => b[1] - a[1]);
		if (entries.length === 0) return "";
		return trunc(
			`${theme.fg("muted", "providers ")}${theme.fg("dim", entries.map(([name, n]) => `${name} ${n}`).join(" · "))}`,
			width,
		);
	}

	function renderEventRow(ev: WebCacheEvent, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const kind = badge(theme, (ev.kind ?? "miss").padEnd(11), kindTone(ev.kind ?? "miss"));
		const tool = theme.fg("muted", ev.tool ?? "?");
		const provider = ev.provider ? theme.fg("dim", ev.provider) : "";
		const detail = ev.detail ? theme.fg("dim", trunc(ev.detail, 36)) : "";
		const when = theme.fg("dim", timeAgo(ev.ts));
		return trunc(
			`${cursor}${kind} ${theme.fg("dim", "·")} ${tool} ${provider ? `${theme.fg("dim", "·")} ${provider} ` : ""}` +
				`${detail ? `${theme.fg("dim", "·")} ${detail} ` : ""}${theme.fg("dim", "·")} ${when}`,
			width,
		);
	}

	function renderList(width: number): string[] {
		const s = snap();
		const lines: string[] = [];
		if (s.error && !s.data) {
			lines.push(...errorState(theme, s.error, width));
			lines.push("");
		}
		const data = s.data;
		if (data) {
			lines.push(...renderKpis(data, width));
			if (data.enabled === false) {
				lines.push(badge(theme, "cache disabled (UNOWN_WEB_CACHE=0)", "amber"));
			}
			lines.push("");
			lines.push(...renderConfig(data, width));
			const providers = renderProviders(data, width);
			if (providers) {
				lines.push("");
				lines.push(providers);
			}
		} else if (!s.error) {
			lines.push(...loadingState(theme, "web cache stats"));
		}
		lines.push("");
		const list = events();
		lines.push(heading(theme, `recent events${data ? ` (${list.length})` : ""}`));
		if (data && list.length === 0) {
			lines.push(
				...emptyState(theme, "no events yet", "events appear as the agent searches or fetches the web", width),
			);
		} else if (data) {
			win.resync();
			const view = Math.max(1, viewport - FIXED_ROWS);
			const slice = list.slice(win.scroll, win.scroll + view);
			slice.forEach((ev, i) => {
				lines.push(renderEventRow(ev, win.scroll + i === win.selected, width));
			});
			const more = list.length - view - win.scroll;
			if (more > 0) lines.push(theme.fg("dim", `  … ${more} more (j/k, PgDn)`));
		}
		if (s.ageMs !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, s.ageMs)}`));
		return lines;
	}

	// ---- the screen ---------------------------------------------------------

	const screen: Screen = {
		render(width: number): string[] {
			return renderList(width);
		},

		invalidate(): void {
			requestRender();
		},

		setViewport(height: number): void {
			viewport = height;
		},

		footerHints(): [string, string][] {
			return [
				["s", "sweep"],
				["x", "clear"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			if (matchesKey(data, "j") || matchesKey(data, "down")) return win.move(1);
			if (matchesKey(data, "k") || matchesKey(data, "up")) return win.move(-1);
			if (matchesKey(data, "g")) return win.home();
			if (matchesKey(data, "shift+g")) return win.end();
			if (matchesKey(data, "pageDown")) return win.page(1);
			if (matchesKey(data, "pageUp")) return win.page(-1);

			if (matchesKey(data, "s")) {
				confirm("sweep to the byte cap? (LRU eviction, keeps recent entries)", () => {
					void store
						.sweepWebCache()
						.then((r) => toast(`evicted ${r.evicted} · freed ${formatBytes(r.freedBytes)}`, "zinc"))
						.catch((e) => toast((e as Error).message, "rose"));
				});
				return true;
			}

			if (matchesKey(data, "x")) {
				const entries = snap().data?.entries ?? 0;
				confirm(`CLEAR the entire web results store? ${entries} entries — this cannot be undone`, () => {
					void store
						.clearWebCache()
						.then((r) => toast(`cleared · ${r.removed} entries dropped`, "rose"))
						.catch((e) => toast((e as Error).message, "rose"));
				});
				return true;
			}

			return false;
		},
	};
	return screen;
}

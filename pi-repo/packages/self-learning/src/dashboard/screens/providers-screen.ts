/**
 * screens/providers-screen.ts — the model registry's dashboard half (M5):
 * engine/default banners, provider cards with health dots + key status, a
 * detail drill with the full model catalog, and the add-provider wizard
 * (preset → key → model → confirm) that hits the same engine endpoints as
 * `unown providers add` — one registry, two surfaces, zero drift.
 *
 * Key map (list): a add · enter detail · T test · d default · r refresh
 * models · k rotate key · x remove. The wizard is an inline step machine:
 * while it is open j/k/enter/esc/y route to the form, never to the list.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type {
	ProviderInfo,
	ProviderMutationResponse,
	ProviderPresetInfo,
	ProvidersResponse,
} from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import {
	ageStamp,
	badge,
	emptyState,
	errorState,
	heading,
	InlineInput,
	loadingState,
	timeAgo,
	trunc,
} from "../widgets/bits.ts";

/** Rows the banner, headings and age stamp occupy above the provider rows. */
const FIXED_ROWS = 6;

/** The add-provider step machine (inline, no overlay). */
interface AddForm {
	/** 0 preset picker · 1 api key · 2 model · 3 confirm. */
	step: number;
	/** Preset id captured when the picker's enter fires (survives refetches). */
	presetId: string | null;
	/** Cursor over the live preset list (step 0). */
	presetWin: SelectionWindow;
	key: InlineInput;
	model: InlineInput;
	/** true while the POST is in flight (blocks double-submit / shows state). */
	busy: boolean;
}

export function createProvidersScreen(deps: ScreenDeps): Screen {
	const { store, theme, toast, requestRender, confirm } = deps;
	let viewport = 24;
	let mode: "list" | "detail" = "list";
	let detailId: string | null = null;
	let detailScroll = 0;
	let keyInput: { id: string; input: InlineInput } | null = null;
	let form: AddForm | null = null;

	const snap = () => store.snapshot<ProvidersResponse>("providers");
	const providers = (): ProviderInfo[] => snap().data?.providers ?? [];
	const presets = (): ProviderPresetInfo[] => snap().data?.presets ?? [];
	const win: SelectionWindow = new Window(
		() => providers().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	function current(): ProviderInfo | null {
		const list = providers();
		if (mode === "detail" && detailId) return list.find((p) => p.id === detailId) ?? null;
		return list[win.selected] ?? null;
	}

	function currentPreset(): ProviderPresetInfo | null {
		const f = form;
		if (!f) return null;
		const byId = presets().find((p) => p.id === f.presetId);
		if (byId) return byId;
		return presets()[f.presetWin.selected] ?? null;
	}

	// ---- rendering ----------------------------------------------------------

	function renderBanner(data: ProvidersResponse): string[] {
		const engine = data.engine ?? { provider: "?", model: "?" };
		const def = data.defaultProvider
			? theme.fg("text", `${data.defaultProvider}/${data.defaultModel ?? "—"}`)
			: theme.fg("dim", "unset (settings.json)");
		return [
			`${theme.fg("muted", "engine model ")}${theme.fg("text", `${engine.provider} / ${engine.model}`)}`,
			`${theme.fg("muted", "default ")}${def}`,
		];
	}

	function renderRow(p: ProviderInfo, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const ok = p.health?.ok === true;
		let health = theme.fg(ok ? "success" : "error", ok ? "●" : "○");
		if (!ok && p.health?.problem) health += ` ${theme.fg("error", trunc(p.health.problem, 24))}`;
		if (p.health && Date.now() - p.health.checkedAt > 60_000) health += theme.fg("dim", " (stale)");
		const id = theme.fg(selected ? "text" : "muted", p.id.padEnd(12));
		const def = p.isDefault ? ` ${badge(theme, "default", "emerald")}` : "";
		const models = theme.fg("dim", `${p.modelIds?.length ?? 0} models`);
		const key = theme.fg("dim", p.keyLabel ?? "key: none");
		return trunc(
			`${cursor}${health} ${id}${def} ${theme.fg("dim", "·")} ${models} ${theme.fg("dim", "·")} ${key}`,
			width,
		);
	}

	function renderList(width: number, extraFixed = 0): string[] {
		const s = snap();
		const lines: string[] = [];
		if (s.error && !s.data) {
			lines.push(...errorState(theme, s.error, width));
			lines.push("");
		}
		if (s.data) {
			lines.push(...renderBanner(s.data));
		} else if (!s.error) {
			lines.push(...loadingState(theme, "providers"));
		}
		lines.push("");
		const list = providers();
		lines.push(heading(theme, `providers${s.data ? ` (${list.length})` : ""}`));
		if (s.data && list.length === 0) {
			lines.push(
				...emptyState(
					theme,
					"no providers registered",
					"a adds one from the preset table (same as `unown providers add`)",
					width,
				),
			);
		} else if (s.data) {
			win.resync();
			const view = Math.max(1, viewport - FIXED_ROWS - extraFixed);
			const slice = list.slice(win.scroll, win.scroll + view);
			slice.forEach((p, i) => {
				lines.push(renderRow(p, win.scroll + i === win.selected, width));
			});
			const more = list.length - view - win.scroll;
			if (more > 0) lines.push(theme.fg("dim", `  … ${more} more (j/k, PgDn)`));
		}
		if (s.ageMs !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, s.ageMs)}`));
		return lines;
	}

	function renderDetail(width: number): string[] {
		const p = providers().find((x) => x.id === detailId) ?? null;
		if (!p) return [theme.fg("dim", "provider no longer registered · esc back")];
		const lines: string[] = [];
		const field = (label: string, value: string) =>
			`${theme.fg("muted", label.padEnd(8))} ${theme.fg("text", value)}`;
		lines.push(heading(theme, `provider · ${p.id}`), "");
		lines.push(field("id", p.id));
		if (p.name) lines.push(field("name", p.name));
		lines.push(field("baseUrl", p.baseUrl ?? "—"));
		lines.push(field("api", p.api ?? "—"));
		lines.push("");
		lines.push(heading(theme, "key"));
		lines.push(field("status", p.keyLabel ?? "—"));
		if (p.keyStatus === "env-ref" && p.keyEnv) lines.push(field("env", `$${p.keyEnv}`));
		lines.push("");
		const models = p.modelIds ?? [];
		lines.push(heading(theme, `models (${models.length})`));
		for (const m of models.slice(0, 12)) lines.push(theme.fg("dim", `  ${m}`));
		if (models.length > 12)
			lines.push(theme.fg("dim", `  … ${models.length - 12} more (r refresh imports the live catalog)`));
		if (models.length === 0)
			lines.push(
				...emptyState(theme, "no models registered", "r refresh imports the endpoint's /models catalog", width),
			);
		lines.push("");
		lines.push(heading(theme, "health"));
		const ok = p.health?.ok === true;
		lines.push(field("ok", ok ? theme.fg("success", "✓ reachable") : theme.fg("error", "✗ problem")));
		if (typeof p.health?.status === "number") lines.push(field("status", `${p.health.status}`));
		if (p.health?.problem) lines.push(field("problem", trunc(p.health.problem, Math.max(20, width - 12))));
		lines.push(field("checked", p.health ? timeAgo(p.health.checkedAt) : "never"));
		lines.push("");
		lines.push(theme.fg("dim", "esc back · j/k scroll · T test · d default · r refresh · x remove"));
		return clampScroll(lines);
	}

	function renderForm(width: number): string[] {
		const f = form;
		if (!f) return renderList(width);
		const data = snap().data;
		const lines: string[] = [];
		if (data) lines.push(...renderBanner(data));
		lines.push("");
		if (f.step === 0) {
			lines.push(heading(theme, "add provider · pick a preset"));
			const list = presets();
			if (list.length === 0) {
				lines.push(
					...emptyState(
						theme,
						"no presets in the response",
						"the engine's preset table is the live source",
						width,
					),
				);
				return lines;
			}
			f.presetWin.resync();
			const view = Math.max(1, viewport - 5);
			const slice = list.slice(f.presetWin.scroll, f.presetWin.scroll + view);
			slice.forEach((preset, i) => {
				const sel = f.presetWin.scroll + i === f.presetWin.selected;
				const cursor = sel ? theme.fg("accent", "▸ ") : "  ";
				lines.push(
					trunc(
						`${cursor}${theme.fg(sel ? "text" : "muted", trunc(preset.label, 42))} ${theme.fg("dim", trunc(preset.baseUrl, 32))}`,
						width,
					),
				);
			});
			const more = list.length - view - f.presetWin.scroll;
			if (more > 0) lines.push(theme.fg("dim", `  … ${more} more`));
			return lines;
		}
		const preset = currentPreset();
		if (!preset) {
			lines.push(heading(theme, "add provider"));
			lines.push(...errorState(theme, "preset list unavailable (engine down?) — esc cancels", width));
			return lines;
		}
		if (f.step === 1) {
			lines.push(heading(theme, "add provider · api key"));
			lines.push(`${theme.fg("muted", "preset ")}${theme.fg("text", trunc(preset.label, 48))}`);
			lines.push(`${theme.fg("muted", "baseUrl ")}${theme.fg("dim", preset.baseUrl)}`);
			lines.push("");
			lines.push(f.key.renderField(theme, "api key", width));
			lines.push(theme.fg("dim", trunc(`  empty = no key · env hint: ${preset.keyEnvHint}`, Math.max(20, width))));
			return lines;
		}
		if (f.step === 2) {
			lines.push(heading(theme, "add provider · model"));
			lines.push(`${theme.fg("muted", "preset ")}${theme.fg("text", trunc(preset.label, 48))}`);
			lines.push("");
			lines.push(f.model.renderField(theme, "model", width));
			lines.push(theme.fg("dim", `  default: ${preset.defaultModel || "(none — this preset requires a model id)"}`));
			return lines;
		}
		lines.push(heading(theme, "add provider · confirm"));
		const model = f.model.text.trim() || preset.defaultModel;
		lines.push(
			`${theme.fg("muted", "preset ")}${theme.fg("text", preset.id)} ${theme.fg("dim", trunc(preset.label, 40))}`,
		);
		lines.push(`${theme.fg("muted", "baseUrl ")}${theme.fg("dim", preset.baseUrl)}`);
		lines.push(`${theme.fg("muted", "model ")}${theme.fg("text", model)}`);
		lines.push(
			`${theme.fg("muted", "key ")}${
				f.key.text.trim()
					? theme.fg("text", "set → auth.json (0600)")
					: theme.fg("dim", "empty (no key / env hint)")
			}`,
		);
		lines.push(`${theme.fg("muted", "default ")}${theme.fg("text", "becomes the default provider")}`);
		lines.push("");
		lines.push(
			f.busy
				? theme.fg("muted", "◌ adding (the engine probes the endpoint)…")
				: theme.fg("dim", "y add · esc cancel"),
		);
		return lines;
	}

	/** Clamp the detail scroll offset to the built lines, then window them. */
	function clampScroll(lines: string[]): string[] {
		const view = Math.max(1, viewport);
		const max = Math.max(0, lines.length - view);
		if (detailScroll > max) detailScroll = max;
		if (detailScroll < 0) detailScroll = 0;
		return lines.slice(detailScroll, detailScroll + view);
	}

	// ---- actions ------------------------------------------------------------

	function submitAddForm(): void {
		const f = form;
		if (!f) return;
		const preset = presets().find((p) => p.id === f.presetId);
		if (!preset) {
			toast("preset unavailable — esc and start again", "rose");
			return;
		}
		const model = f.model.text.trim() || preset.defaultModel;
		if (!model) {
			toast("model id required for this preset", "amber");
			f.step = 2;
			return;
		}
		const apiKey = f.key.text.trim();
		const body: Record<string, unknown> = {
			preset: preset.id,
			model,
			setDefault: true,
			allModels: false,
		};
		if (apiKey) body.apiKey = apiKey;
		f.busy = true;
		void store
			.addProvider(body)
			.then((r) => {
				if (r.ok) {
					toast(`provider added · ${r.provider}`, "emerald");
					if (form === f) form = null;
				} else {
					toast(r.problem ?? "provider add failed", "rose");
				}
			})
			.catch((e) => toast((e as Error).message, "rose"))
			.finally(() => {
				if (form === f) f.busy = false;
				requestRender();
			});
	}

	function openKeyInput(): boolean {
		const p = providers()[win.selected];
		if (!p) return false;
		keyInput = { id: p.id, input: new InlineInput(200) };
		return true;
	}

	function handleFormKey(data: string): boolean {
		const f = form;
		if (!f) return false;
		if (matchesKey(data, "escape")) {
			form = null;
			return true;
		}
		if (f.step === 0) {
			if (matchesKey(data, "j") || matchesKey(data, "down")) return f.presetWin.move(1);
			if (matchesKey(data, "k") || matchesKey(data, "up")) return f.presetWin.move(-1);
			if (matchesKey(data, "g")) return f.presetWin.home();
			if (matchesKey(data, "shift+g")) return f.presetWin.end();
			if (matchesKey(data, "pageDown")) return f.presetWin.page(1);
			if (matchesKey(data, "pageUp")) return f.presetWin.page(-1);
			if (matchesKey(data, "enter")) {
				const preset = presets()[f.presetWin.selected];
				if (preset) {
					f.presetId = preset.id;
					f.step = 1;
				}
				return true;
			}
			return true;
		}
		if (f.step === 1 || f.step === 2) {
			const input = f.step === 1 ? f.key : f.model;
			if (matchesKey(data, "enter")) {
				if (f.step === 1) {
					f.step = 2;
					return true;
				}
				if (!f.model.text.trim() && !currentPreset()?.defaultModel) {
					toast("this preset has no default model — type a model id", "amber");
					return true;
				}
				f.step = 3;
				return true;
			}
			input.insert(data);
			return true;
		}
		// step 3 — confirm
		if (f.busy) return true;
		if (matchesKey(data, "y")) submitAddForm();
		return true;
	}

	// ---- the screen ---------------------------------------------------------

	const screen: Screen = {
		render(width: number): string[] {
			if (form) return renderForm(width);
			if (keyInput) {
				const lines = renderList(width, 3);
				lines.push("");
				lines.push(keyInput.input.renderField(theme, "new api key", width));
				lines.push(theme.fg("dim", "enter rotate · esc cancel"));
				return lines;
			}
			if (mode === "detail") return renderDetail(width);
			return renderList(width);
		},

		invalidate(): void {
			requestRender();
		},

		setViewport(height: number): void {
			viewport = height;
		},

		footerHints(): [string, string][] {
			if (keyInput)
				return [
					["esc", "cancel"],
					["enter", "rotate key"],
				];
			if (form) {
				switch (form.step) {
					case 0:
						return [
							["esc", "cancel"],
							["j/k", "preset"],
							["enter", "pick"],
						];
					case 1:
					case 2:
						return [
							["esc", "cancel"],
							["enter", "next"],
						];
					default:
						return [
							["esc", "cancel"],
							["y", "add"],
						];
				}
			}
			if (mode === "detail") return [["esc", "back"]];
			return [
				["a", "add"],
				["enter", "open"],
				["T", "test"],
				["d", "default"],
				["r", "refresh"],
				["k", "key"],
				["x", "remove"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			// The rotate-key input owns every key while it is open.
			if (keyInput) {
				if (matchesKey(data, "escape")) {
					keyInput = null;
					return true;
				}
				if (matchesKey(data, "enter")) {
					const id = keyInput.id;
					const key = keyInput.input.text.trim();
					if (!key) {
						toast("type the new api key first (esc cancels)", "amber");
						return true;
					}
					keyInput = null;
					void store
						.providerAction(`/api/providers/${encodeURIComponent(id)}/key`, { apiKey: key })
						.then((r) => {
							if (!r.ok) {
								toast(r.problem ?? "key rotation failed", "rose");
							} else if (r.probe?.ok) {
								toast(`key rotated · ${id} · probe ok`, "emerald");
							} else if (r.probe) {
								toast(`key rotated · probe failed: ${r.probe.problem ?? "?"}`, "amber");
							} else {
								toast(`key rotated · ${id}`, "emerald");
							}
						})
						.catch((e) => toast((e as Error).message, "rose"));
					return true;
				}
				keyInput.input.insert(data);
				return true;
			}
			// The add form owns j/k/enter/esc/y while it is open.
			if (form) return handleFormKey(data);

			if (mode === "detail") {
				if (matchesKey(data, "escape")) {
					mode = "list";
					return true;
				}
				if (matchesKey(data, "j") || matchesKey(data, "down")) {
					detailScroll += 1;
					return true;
				}
				if (matchesKey(data, "k") || matchesKey(data, "up")) {
					detailScroll = Math.max(0, detailScroll - 1);
					return true;
				}
				if (matchesKey(data, "g")) {
					detailScroll = 0;
					return true;
				}
				if (matchesKey(data, "shift+g")) {
					detailScroll = 1 << 30; // clamped against the built lines at render
					return true;
				}
				if (matchesKey(data, "pageDown")) {
					detailScroll += Math.max(1, viewport - 1);
					return true;
				}
				if (matchesKey(data, "pageUp")) {
					detailScroll = Math.max(0, detailScroll - Math.max(1, viewport - 1));
					return true;
				}
			} else {
				if (matchesKey(data, "j") || matchesKey(data, "down")) return win.move(1);
				if (matchesKey(data, "up")) return win.move(-1);
				if (matchesKey(data, "k")) return openKeyInput();
				if (matchesKey(data, "g")) return win.home();
				if (matchesKey(data, "shift+g")) return win.end();
				if (matchesKey(data, "pageDown")) return win.page(1);
				if (matchesKey(data, "pageUp")) return win.page(-1);
				if (matchesKey(data, "enter")) {
					const p = providers()[win.selected];
					if (p) {
						mode = "detail";
						detailId = p.id;
						detailScroll = 0;
					}
					return true;
				}
				if (matchesKey(data, "a")) {
					form = {
						step: 0,
						presetId: null,
						presetWin: new Window(
							() => presets().length,
							() => Math.max(1, viewport - 5),
						),
						key: new InlineInput(200),
						model: new InlineInput(120),
						busy: false,
					};
					return true;
				}
			}

			// Provider actions — operate on the selected (or detailed) provider.
			const p = current();
			if (!p) return false;

			if (matchesKey(data, "shift+t")) {
				// The engine serves the probe as GET (server.ts); the store's
				// providerAction is POST-only, so the test goes through the
				// store's public client. See the report note.
				void store.client
					.get<ProviderMutationResponse>(`/api/providers/${encodeURIComponent(p.id)}/test`)
					.then((r) => {
						if (r.ok && (r.probe?.ok ?? true)) {
							const n = r.probe?.models?.length ?? 0;
							toast(`probe ok · ${r.probe ? `${n} models` : "no endpoint to probe"}`, "emerald");
						} else {
							toast(`probe failed · ${r.probe?.problem ?? r.problem ?? "unknown"}`, "rose");
						}
					})
					.catch((e) => toast((e as Error).message, "rose"));
				return true;
			}

			if (matchesKey(data, "d")) {
				const id = p.id;
				const model = (p.modelIds ?? [])[0];
				confirm(`make ${id} the default provider?`, () => {
					void store
						.providerAction(`/api/providers/${encodeURIComponent(id)}/default`, { model })
						.then((r) =>
							toast(
								r.ok
									? `default → ${r.provider ?? id}${model ? `/${model}` : ""}`
									: (r.problem ?? "could not set default"),
								r.ok ? "emerald" : "rose",
							),
						)
						.catch((e) => toast((e as Error).message, "rose"));
				});
				return true;
			}

			if (matchesKey(data, "r")) {
				const id = p.id;
				void store
					.providerAction(`/api/providers/${encodeURIComponent(id)}/refresh`)
					.then((r) => {
						if (!r.ok) {
							toast(r.problem ?? "refresh failed", "rose");
						} else if (r.problem) {
							toast(trunc(r.problem, 90), "amber");
						} else {
							const n = r.added?.length ?? 0;
							toast(`${n} new model${n === 1 ? "" : "s"}`, n > 0 ? "emerald" : "zinc");
						}
					})
					.catch((e) => toast((e as Error).message, "rose"));
				return true;
			}

			if (matchesKey(data, "x")) {
				const id = p.id;
				confirm(`remove provider ${id}? (auth.json entry + models.json registration)`, () => {
					void store
						.removeProvider(id)
						.then((r) => {
							if (r.ok) {
								toast(`provider removed · ${id}${r.defaultFellBack ? " · default fell back" : ""}`, "zinc");
								if (detailId === id) {
									mode = "list";
									detailId = null;
								}
							} else {
								toast(r.problem ?? "remove failed", "rose");
							}
						})
						.catch((e) => toast((e as Error).message, "rose"));
				});
				return true;
			}

			return false;
		},
	};
	return screen;
}

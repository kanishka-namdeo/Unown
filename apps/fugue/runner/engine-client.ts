/**
 * engine-client.ts — Fugue's raw engine HTTP client (PLAN §1/§3, F-3;
 * the Node-edge lane — like Chaconne's runner-side Playwright import,
 * this module MAY use fetch; src/** never does).
 *
 * Pinned engine contract (verified live 2026-11-07, server.ts +
 * engine-auth.ts):
 *
 * - Base URL: `http://127.0.0.1:3030`, override FUGUE_ENGINE_URL.
 * - Bearer token: `FUGUE_ENGINE_TOKEN` env override, else
 *   `$UNOWN_HOME/engine.token` (the engine's shared discovery mirror,
 *   engine-auth.ts sharedEngineTokenPath); unresolvable -> EngineLocked.
 * - 401/403 -> EngineLocked; transport failure / ECONNREFUSED ->
 *   EngineDown; any other non-2xx -> EngineDown with the status.
 *
 * Action routes pinned from server.ts's automation-match table:
 *   GET    /api/automations/:id                  -> { automation }
 *   PATCH  /api/automations/:id  (lifecycle)     -> pause/resume lane
 *   POST   /api/automations/:id/run              -> run-now
 *   POST   /api/automations/:id/skip             -> skip
 *   POST   /api/automations/:id/snooze {minutes} -> snooze
 *   GET    /api/automations/:id/runs?limit=N     -> { runs }
 *   DELETE /api/automations/:id                  -> { ok }
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export class EngineLocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineLocked";
  }
}

export class EngineDown extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineDown";
  }
}

export interface EngineClientOpts {
  baseUrl?: string;
  token?: string; // skips discovery when set
  timeoutMs?: number; // default 10_000
}

/** Resolve the bearer token: opts.token > FUGUE_ENGINE_TOKEN >
 *  $UNOWN_HOME/engine.token. Unresolvable -> EngineLocked (E-01:
 *  the app surfaces an honest "engine locked" panel, never a blank). */
export function resolveEngineToken(opts?: EngineClientOpts): string {
  if (opts?.token) return opts.token;
  const env = process.env.FUGUE_ENGINE_TOKEN?.trim();
  if (env) return env;
  const home = process.env.UNOWN_HOME?.trim();
  if (home) {
    try {
      const t = readFileSync(join(home, "engine.token"), "utf8").trim();
      if (t) return t;
    } catch {
      /* missing/unreadable -> EngineLocked below */
    }
  }
  throw new EngineLocked(
    "engine token not found (set FUGUE_ENGINE_TOKEN or $UNOWN_HOME/engine.token)",
  );
}

export class EngineClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(opts: EngineClientOpts = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.FUGUE_ENGINE_URL ?? "http://127.0.0.1:3030").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.token = resolveEngineToken({ token: opts.token });
  }

  /** One authenticated request. 401/403 -> EngineLocked; transport
   *  failure / refused -> EngineDown; other non-2xx -> EngineDown
   *  with the status. Resolves the parsed JSON body. */
  async request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new EngineDown(
        `engine unreachable at ${this.baseUrl}: ${(e as Error).message}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new EngineLocked(`engine rejected the bearer token (HTTP ${res.status})`);
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      throw new EngineDown(
        `engine ${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(parsed)}`,
      );
    }
    return parsed;
  }

  /* — the pinned GET surface (the contract test asserts these) — */

  overview(): Promise<unknown> {
    return this.request("GET", "/api/overview");
  }
  listAutomations(): Promise<unknown> {
    return this.request("GET", "/api/automations");
  }
  runs(limit?: number): Promise<unknown> {
    return this.request("GET", `/api/runs${limit ? `?limit=${limit}` : ""}`);
  }
  dreams(limit?: number): Promise<unknown> {
    return this.request("GET", `/api/dreams${limit ? `?limit=${limit}` : ""}`);
  }
  notes(limit?: number): Promise<unknown> {
    return this.request("GET", `/api/notes${limit ? `?limit=${limit}` : ""}`);
  }
  memories(): Promise<unknown> {
    return this.request("GET", "/api/memories");
  }
  spend(): Promise<unknown> {
    return this.request("GET", "/api/automations/spend");
  }

  /* — the action routes (verbs + payloads pinned from server.ts) — */

  createAutomation(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "/api/automations", body);
  }
  /** The engine has no /pause route: pause is a lifecycle PATCH. */
  pause(id: number | string): Promise<unknown> {
    return this.patchLifecycle(id, "paused");
  }
  /** resume: the same lane, lifecycle back to "active". */
  resume(id: number | string): Promise<unknown> {
    return this.patchLifecycle(id, "active");
  }
  runNow(id: number | string): Promise<unknown> {
    return this.request("POST", `/api/automations/${encodeURIComponent(String(id))}/run`);
  }
  skip(id: number | string): Promise<unknown> {
    return this.request("POST", `/api/automations/${encodeURIComponent(String(id))}/skip`);
  }
  snooze(id: number | string, minutes: number): Promise<unknown> {
    return this.request("POST", `/api/automations/${encodeURIComponent(String(id))}/snooze`, { minutes });
  }
  deleteAutomation(id: number | string): Promise<unknown> {
    return this.request("DELETE", `/api/automations/${encodeURIComponent(String(id))}`);
  }
  history(id: number | string, limit?: number): Promise<unknown> {
    return this.request(
      "GET",
      `/api/automations/${encodeURIComponent(String(id))}/runs${limit ? `?limit=${limit}` : ""}`,
    );
  }

  private async patchLifecycle(id: number | string, lifecycle: "active" | "paused"): Promise<unknown> {
    return this.request("PATCH", `/api/automations/${encodeURIComponent(String(id))}`, { lifecycle });
  }
}

export function makeEngineClient(opts?: EngineClientOpts): EngineClient {
  return new EngineClient(opts);
}

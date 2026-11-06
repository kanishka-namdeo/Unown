/**
 * Bolero HTTP server — dependency-free `Bun.serve` on port 4050 (the
 * house sequence: Coda 4012, Ostinato 4013, Chaconne 4014; 4050 is
 * bolero's reserved slot, PLAN §5). `BOLERO_PORT` overrides.
 *
 * The ops contract (§5): `GET /health` is the cheap lifecycle probe the
 * supervisor trusts. It reads the lifecycle state and the in-flight
 * job counter — it NEVER blocks on a queued ingest job. A refused-port
 * conflict is reported, never spawned over (the taxonomy gate).
 */
import { type Server, serve } from "bun";
import { handleRequest } from "./ingest.js";

export const DEFAULT_PORT = 4050;

export type Phase = "warming" | "ready" | "draining";

/**
 * The health block the supervisor polls. `queue` is the in-flight
 * ingest count — the E-11 load signal, read as a plain number, never
 * awaited.
 */
export type Health = {
  phase: Phase;
  pid: number;
  version: string;
  queue: number;
};

export type ServerDeps = {
  /** The store's in-memory / temp-dir database (the server test lane). */
  store: import("./store.js").Database;
  /** Content-addressed artifact dir (defaults to the app data dir). */
  artifactsDir?: string;
};

/**
 * The in-flight job tracker (`http.ts` owns it; `ingest.ts` consumes
 * it through `RequestDeps`). The health endpoint reads it
 * synchronously — it never blocks on a queued ingest job (E-11).
 */
export type InflightTracker = {
  begin(): void;
  end(): void;
  inFlight(): number;
};

export type PhaseHandle = {
  current(): Phase;
  set(p: Phase): void;
};

/** A bounded counter — health reads it synchronously, never blocks. */
export function makeInflight(): InflightTracker {
  let n = 0;
  return {
    begin() {
      n += 1;
    },
    end() {
      n -= 1;
      if (n < 0) n = 0;
    },
    inFlight() {
      return n;
    },
  };
}

export function makePhaseHandle(initial: Phase): PhaseHandle {
  let p: Phase = initial;
  return {
    current() {
      return p;
    },
    set(next: Phase) {
      p = next;
    },
  };
}

/**
 * Start the bolero server. Returns the `Server` and a `phase` handle
 * the operator/supervisor flips (`warming` → `ready` → `draining`);
 * `stop` drains in-flight ingests up to a budget then closes.
 *
 * @param port the listen port (default `BOLERO_PORT` or 4050)
 * @param deps the store + artifact dir
 * @returns the server, its phase handle and a stop hook
 */
export function startServer(
  port: number = Number(process.env.BOLERO_PORT ?? DEFAULT_PORT),
  deps: ServerDeps,
): { server: Server; phase: PhaseHandle; stop: (budgetMs?: number) => Promise<void> } {
  const inflight = makeInflight();
  const phaseHandle: PhaseHandle = makePhaseHandle("warming");

  const server = serve({
    port,
    hostname: "127.0.0.1",
    fetch: (req: Request) =>
      handleRequest(req, { store: deps.store, artifactsDir: deps.artifactsDir ?? "", inflight, phaseHandle }),
    error: (err: unknown) => {
      // A refused-port / bind failure surfaces here — report, never
      // spawn over (the taxonomy gate, PLAN §5).
      console.error("[bolero] server error:", err instanceof Error ? err.message : String(err));
      return new Response("internal server error", { status: 500 });
    },
  });

  // The store is already committed at this point — flip to ready.
  phaseHandle.set("ready");

  async function stop(budgetMs = 0): Promise<void> {
    phaseHandle.set("draining");
    // Bounded drain: wait for in-flight ingests up to the budget, then
    // close. The default (0) closes immediately — the tests are single-
    // threaded and control their own jobs.
    const deadline = budgetMs > 0 ? Date.now() + budgetMs : 0;
    while (inflight.inFlight() > 0) {
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    server.stop(true);
  }

  return { server, phase: phaseHandle, stop };
}



/** The `/health` JSON body (the ops contract shape, PLAN §5). */
export function healthBody(
  phaseHandle: PhaseHandle,
  queue: number,
): Health {
  return {
    phase: phaseHandle.current(),
    pid: process.pid,
    version: "bolero.v1",
    queue,
  };
}

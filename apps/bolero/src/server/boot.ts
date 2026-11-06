/**
 * Bolero server boot — the one-command operator gate (`bun run
 * bolero:server`, PLAN §3/§5). Opens the SQLite store at the app
 * data dir, starts the HTTP server on port 4050 (`BOLERO_PORT`
 * override), flips to `ready`, and drains cleanly on SIGTERM (the
 * `draining` phase — a supervised restart never drops in-flight
 * ingests).
 *
 * The server NEVER drives a browser (the S-4/S-5 scheduler/dashboard
 * lanes are out of scope for this ticket).
 */
import { join } from "node:path";
import { openStore } from "./store.js";
import { startServer } from "./http.js";

export function main(): void {
  // BOLERO_DATA_DIR override: e2e isolation (the e2e never touches
  // the shared app data dir; it boots against a fresh temp dir).
  const dataDir = process.env.BOLERO_DATA_DIR ?? join(import.meta.dir, "../../data");
  const artifactsDir = join(dataDir, "artifacts");
  const dbPath = join(dataDir, "bolero.db");

  const store = openStore(dbPath);
  const { phase, stop } = startServer(Number(process.env.BOLERO_PORT ?? 4050), {
    store,
    artifactsDir,
  });

  console.log(
    `[bolero] ready (pid ${process.pid}, phase ${phase.current()}, port ${process.env.BOLERO_PORT ?? 4050}, db ${dbPath})`,
  );

  // SIGTERM → drain (the §5 ops contract: the drain budget bounds
  // in-flight jobs, then the store closes).
  let shuttingDown = false;
  process.on("SIGTERM", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[bolero] SIGTERM — draining");
    void stop(10_000).then(() => {
      store.close();
      console.log("[bolero] drained + store closed; exiting");
      process.exit(0);
    });
  });
  process.on("SIGINT", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void stop(10_000).then(() => {
      store.close();
      process.exit(0);
    });
  });
}

// Direct-run entry: `bun src/server/boot.ts`. The import.meta.main
// guard keeps this module test-importable without side effects.
if (import.meta.main) {
  main();
}

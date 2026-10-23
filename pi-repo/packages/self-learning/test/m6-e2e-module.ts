// M6 E2E: the REAL withRepoMap against the REAL unown checkout (real git,
// real tree-sitter, real caches) — proves the spawn-lane injection contract.
import { withRepoMap, listRepoFiles } from "../src/repomap/repomap-cli.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const repo = "/home/z/my-project/unown/pi-repo/packages/self-learning";
const files = await listRepoFiles(repo);
console.log("tracked files:", files?.length);

const task = "Find the bug in the pagerank computation in graph.ts and fix it.";
const t0 = Date.now();
const composed = await withRepoMap(repo, task);
const ms1 = Date.now() - t0;
console.log("first compose ms:", ms1);
if (!composed.includes("Repo map (read-only structural summaries")) throw new Error("map block missing");
if (!composed.startsWith(task)) throw new Error("task must lead");
if (!composed.includes("graph.ts")) throw new Error("mentioned file must be in the map");

const t1 = Date.now();
const again = await withRepoMap(repo, "second task about tagsFromCaptures in tags.ts");
const ms2 = Date.now() - t1;
console.log("second compose ms (cache-warm):", ms2);
if (!again.includes("Repo map")) throw new Error("second map missing");

// Timeout contract: a zero timeout never waits, still returns the task.
const instant = await withRepoMap(repo, task, { UNOWN_REPOMAP_TIMEOUT_MS: "0" });
if (instant !== task) throw new Error("zero-timeout must skip the map");

// Kill switch.
const off = await withRepoMap(repo, task, { UNOWN_REPOMAP: "0" });
if (off !== task) throw new Error("kill switch must skip the map");

console.log("M6-E2E-MODULE-OK");

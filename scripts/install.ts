#!/usr/bin/env bun
/**
 * scripts/install.ts — Unown installer, cross-platform (Windows / macOS / Linux).
 *
 * Port of scripts/install.sh (which now delegates here so there is a single
 * source of truth). Run once after cloning:
 *
 *   bun run agent:install        (or: bun scripts/install.ts)
 *
 * Steps:
 *   1. verify bun ≥ 1.2 (per-OS install hint if missing/too old)
 *   2. bun install          (dashboard dependencies, repo root)
 *   3. bun install          (pi-repo/, vendored pi coding agent)
 *   4. bun run build:offline (pi-repo/, compiled packages)
 *   5. bootstrap .env from .env.example when absent
 *   6. link `unown` onto PATH (scripts/link.ts) unless UNOWN_NO_LINK=1
 *   7. print next steps (missing BRIDGE_UPSTREAM_KEY flagged as REQUIRED)
 *
 * Windows notes:
 *   - everything runs through bun; no bash-isms. Child steps are spawned with
 *     shell:false and absolute binaries; output is streamed live (stdio inherit).
 *   - the link step writes unown.cmd + unown.ps1 shims into %USERPROFILE%\.local\bin
 *     and appends that dir to the *user* PATH via PowerShell (never setx — it
 *     truncates at 1024 chars). A "restart your terminal" hint is printed when
 *     the registry PATH changed.
 *   - console output stays ASCII on win32 (lib.ts `sym`), avoiding codepage
 *     surprises; macOS/Linux keep the original glyphs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  IS_WIN,
  REPO_ROOT,
  bunAtLeast120,
  bunInstallHint,
  bunVersion,
  loadEnvFile,
  resolveBun,
  run,
  sym,
} from "./lib";

function die(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

// ---------------------------------------------------------------- step 0: bun
const BUN = resolveBun();
if (!BUN) {
  die(
    `${sym.fail} bun is required (>= 1.2) and was not found on this machine.\n` +
      `    install it with:  ${bunInstallHint()}`,
  );
}
const BUN_VERSION = bunVersion(BUN) ?? "";
if (!BUN_VERSION || !bunAtLeast120(BUN_VERSION)) {
  die(
    `${sym.fail} bun >= 1.2 is required (found ${BUN_VERSION || "unknown"} at ${BUN}).\n` +
      `    upgrade it with:  bun upgrade   (or reinstall: ${bunInstallHint()})`,
  );
}
console.log(`${sym.ok} bun ${BUN_VERSION} — ${BUN}`);

const PI_REPO = path.join(REPO_ROOT, "pi-repo");

// ------------------------------------------------------- step 1: root install
// (step failures exit with the child's exit code, like install.sh's `set -e`)
console.log(`${sym.step} [1/6] Installing dashboard dependencies (bun install)…`);
{
  const code = run(BUN, ["install"], { cwd: REPO_ROOT });
  if (code !== 0) die(`${sym.fail} root bun install failed (exit ${code}) — see output above`, code);
}

// ----------------------------------------------------- step 2: pi-repo install
console.log(`${sym.step} [2/6] Installing pi-mono engine dependencies (pi-repo/bun install)…`);
{
  const code = run(BUN, ["install"], { cwd: PI_REPO });
  if (code !== 0) die(`${sym.fail} pi-repo bun install failed (exit ${code}) — see output above`, code);
}

// ------------------------------------------------ step 3: hydrate model data
// KNOWN FRESH-CLONE BUG (fixed here): pi-repo/packages/ai/src/providers/data/
// is GITIGNORED upstream, so a fresh clone cannot build — `bun run
// build:offline` fails until the model-data JSONs exist. Detect a missing or
// empty data dir and hydrate it (network fetch from models.dev / the provider
// catalogs) BEFORE building. Staleness is not detectable offline — if the dir
// has any .json we trust it and skip (re-run with a cleared dir to force).
const MODEL_DATA_DIR = path.join(PI_REPO, "packages", "ai", "src", "providers", "data");
function modelDataCount(): number {
  try {
    return fs.readdirSync(MODEL_DATA_DIR).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0; // missing dir
  }
}
if (modelDataCount() === 0) {
  console.log(
    `${sym.step} [3/6] pi model data missing (${MODEL_DATA_DIR}) — hydrating (network fetch, ~1-2 min)…`,
  );
  console.log(`    (upstream gitignores this dir; a fresh clone cannot build without it)`);
  const hydrateCode = run(BUN, ["run", "hydrate:model-data"], { cwd: PI_REPO });
  if (hydrateCode !== 0) {
    console.error(
      `${sym.fail} model-data hydration failed (exit ${hydrateCode}).\n` +
        `    it fetches provider catalogs from the network — check connectivity / proxies,\n` +
        `    then re-run: bun run agent:install\n` +
        `    offline workaround: copy pi-repo/packages/ai/src/providers/data/*.json\n` +
        `    from another hydrated checkout of this repo.`,
    );
    process.exit(hydrateCode);
  }
  console.log(`${sym.ok} hydrated ${modelDataCount()} provider model files`);
  if (modelDataCount() === 0) {
    console.error(
      `${sym.fail} hydration reported success but no *.json appeared in ${MODEL_DATA_DIR}\n` +
        `    delete that directory and re-run: bun run agent:install`,
    );
    process.exit(1);
  }
} else {
  console.log(`${sym.dot} [3/6] pi model data present (${modelDataCount()} files) — skipping hydration`);
}

// ------------------------------------------------------- step 4: build offline
// build:offline = same as build, but skips the ai package's network-dependent
// model-data hydration step; the self-learning runner only needs the compiled
// packages (coding-agent, ai, agent, …).
console.log(`${sym.step} [4/6] Building the pi coding agent (pi-repo/bun run build:offline)…`);
{
  const code = run(BUN, ["run", "build:offline"], { cwd: PI_REPO });
  if (code !== 0) die(`${sym.fail} pi-repo build:offline failed (exit ${code}) — see output above`, code);
}

// --------------------------------------------------------- step 5: .env bootstrap
// The template carries no secrets — BRIDGE_UPSTREAM_KEY stays empty.
if (!fs.existsSync(path.join(REPO_ROOT, ".env"))) {
  fs.copyFileSync(path.join(REPO_ROOT, ".env.example"), path.join(REPO_ROOT, ".env"));
  console.log(`${sym.ok} created .env from .env.example`);
}

// ------------------------------------------------------------- step 6: link
// Put `unown` on PATH (shim → this checkout). Opt out with UNOWN_NO_LINK=1.
if (process.env.UNOWN_NO_LINK === "1") {
  console.log(`${sym.dot} UNOWN_NO_LINK=1 — skipping the PATH link (run scripts/link.ts anytime)`);
} else {
  const code = run(BUN, [path.join(REPO_ROOT, "scripts", "link.ts")]);
  if (code !== 0) {
    console.log(`${sym.dot} PATH link failed (not fatal) — run scripts/link.ts manually`);
  }
}

// --------------------------------------------------------- next steps banner
const envFile = loadEnvFile(path.join(REPO_ROOT, ".env"));
const upstreamKeySet = Boolean(envFile["BRIDGE_UPSTREAM_KEY"]);
// `unown update` re-runs this script (UNOWN_INSTALL_CONTEXT=update) — the
// banner says "update" instead of "install"; everything else is identical.
const isUpdateRun = process.env.UNOWN_INSTALL_CONTEXT === "update";

console.log(`\n${sym.ok} ${isUpdateRun ? "Update applied — install steps re-run." : "Install complete."}\n`);
if (!isUpdateRun) {
console.log("Next steps:");
} else {
console.log("Post-update checklist:");
}
console.log("  1. Configure your model credentials:");
if (upstreamKeySet) {
  console.log(`     ${sym.ok} BRIDGE_UPSTREAM_KEY is already set in .env`);
} else {
  console.log(
    `     ${sym.fail} REQUIRED: set BRIDGE_UPSTREAM_KEY in .env — without it every chat\n` +
      `       fails with 401 (the bridge forwards requests to the upstream\n` +
      `       provider: Dashscope, OpenAI, OpenRouter, vLLM, …).\n` +
      `       Prefer a different provider entirely? Skip the stack and run:\n` +
      `           unown setup --provider openai --api-key sk-... --model gpt-4o`,
  );
}
console.log("");
console.log("  2. Start the stack:");
console.log("       bun run agent:start        # llm-bridge :3031 + engine :3030 + dashboard :3000");
console.log("");
console.log("  3. Verify & use the agent:");
console.log("       unown doctor              # end-to-end diagnostics (should be green)");
console.log("       cd ~/code/my-project && unown    # a coding agent in YOUR project");
if (IS_WIN) {
  console.log("");
  console.log(
    "  Windows note: if the PATH was just updated, restart your terminal\n" +
      "  (cmd gets unown.cmd automatically; PowerShell may need\n" +
      '  "Set-ExecutionPolicy -Scope CurrentUser RemoteSigned" to run .ps1 shims).',
  );
}
console.log("");
console.log("  Docs: README.md (Quickstart) · docs/ (usage, providers, skills, memory,");
console.log("  troubleshooting) · unown --help");

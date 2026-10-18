/**
 * llama.mjs — cross-platform llama-server lifecycle for the local-llm testbench.
 *
 * Pure Node (>=18): spawn/stop the official llama.cpp `llama-server` prebuilt
 * binary as a child process, wait for /health, sample RSS, clean shutdown.
 * No bash-isms; Windows/macOS/Linux + x64/arm64 via GitHub release assets.
 */
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, createWriteStream, readdirSync } from "node:fs";
import { platform, arch, cpus, totalmem, freemem } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BENCH_ROOT = path.resolve(HERE, "..");
// Asset dirs are gitignored (bin/ ~25MB, models/ up to GBs). Point them at a
// shared cache when running from a second checkout / worktree / CI cache:
export const BIN_DIR = process.env.UNOWN_LLAMA_BIN_DIR ?? path.join(BENCH_ROOT, "bin");
export const MODELS_DIR = process.env.UNOWN_LLAMA_MODELS_DIR ?? path.join(BENCH_ROOT, "models");
export const RESULTS_DIR = path.join(BENCH_ROOT, "results");
export const FIXTURES_DIR = path.join(BENCH_ROOT, "fixtures");

/** Pinned llama.cpp build (b<number>) for reproducibility. Override: LLAMA_BUILD. */
export const LLAMA_BUILD = process.env.LLAMA_BUILD ?? "b11718";

/** Models under test (shortlist from research 4-b; `file` names are local aliases). */
export const MODELS = {
    "qwen3-0.6b": {
    file: "qwen3-0.6b-q4km.gguf",
    hf: "bartowski/Qwen_Qwen3-0.6B-GGUF/Qwen_Qwen3-0.6B-Q4_K_M.gguf",
    params: "0.6B", quant: "Q4_K_M", ctxDefault: 4096, vendor: "Qwen", license: "Apache-2.0",
  },
  "granite-4.0-1b": {
    file: "granite-4.0-1b-q4km.gguf",
    hf: "ibm-granite/granite-4.0-1b-GGUF/granite-4.0-1b-Q4_K_M.gguf",
    params: "1B", quant: "Q4_K_M", ctxDefault: 8192, vendor: "IBM", license: "Apache-2.0",
  },
  "lfm2.5-2.6b": {
    file: "lfm2.5-2.6b-q4km.gguf",
    hf: "LiquidAI/LFM2.5-2.6B-GGUF/LFM2.5-2.6B-Q4_K_M.gguf",
    params: "2.69B", quant: "Q4_K_M", ctxDefault: 8192, vendor: "Liquid AI", license: "LFM Open 1.0",
  },
  "nomic-embed-v2": {
    file: "nomic-embed-v2-q4km.gguf",
    hf: "nomic-ai/nomic-embed-text-v2-moe-GGUF/nomic-embed-text-v2-moe.Q4_K_M.gguf",
    params: "475M (305M act)", quant: "Q4_K_M", ctxDefault: 2048, vendor: "Nomic", license: "Apache-2.0",
    embedding: true,
  },
};

// ---------------------------------------------------------------- platform

export function platformSpec() {
  const os = platform(); // linux | darwin | win32
  const ar = arch(); // x64 | arm64
  const key = `${os}-${ar}`;
  const map = {
    "linux-x64": { asset: "ubuntu-x64", ext: ".tar.gz", bin: "llama-server" },
    "linux-arm64": { asset: "ubuntu-arm64", ext: ".tar.gz", bin: "llama-server" },
    "darwin-x64": { asset: "macos-x64", ext: ".tar.gz", bin: "llama-server" },
    "darwin-arm64": { asset: "macos-arm64", ext: ".tar.gz", bin: "llama-server" },
    "win32-x64": { asset: "win-cpu-x64", ext: ".zip", bin: "llama-server.exe" },
    "win32-arm64": { asset: "win-cpu-arm64", ext: ".zip", bin: "llama-server.exe" },
  };
  const spec = map[key];
  if (!spec) throw new Error(`unsupported platform for llama.cpp prebuilts: ${key}`);
  return {
    os, arch: ar, key, ...spec,
    assetUrl: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/llama-${LLAMA_BUILD}-bin-${spec.asset}${spec.ext}`,
  };
}

export function llamaBinPath() {
  const spec = platformSpec();
  return path.join(BIN_DIR, `llama-${LLAMA_BUILD}`, spec.bin);
}

export function hostInfo() {
  const cs = cpus();
  return {
    platform: platformSpec().key,
    llamaBuild: LLAMA_BUILD,
    cpuModel: cs[0]?.model ?? "unknown",
    cpuCount: cs.length,
    totalMemMB: Math.round(totalmem() / 1048576),
    freeMemMB: Math.round(freemem() / 1048576),
    node: process.version,
  };
}

// ---------------------------------------------------------------- provision

/** Download + extract the llama-server prebuilt if not present. Idempotent. */
export async function provisionEngine({ force = false } = {}) {
  const spec = platformSpec();
  mkdirSync(BIN_DIR, { recursive: true });
  const dest = path.join(BIN_DIR, `llama-${LLAMA_BUILD}`);
  const bin = path.join(dest, spec.bin);
  if (existsSync(bin) && !force) return { bin, cached: true };

  console.log(`[provision] downloading llama.cpp ${LLAMA_BUILD} for ${spec.key} …`);
  const archive = path.join(BIN_DIR, `llama-${LLAMA_BUILD}${spec.ext}`);
  await downloadTo(spec.assetUrl, archive);
  console.log(`[provision] extracting …`);
  mkdirSync(dest, { recursive: true });
  await tarxf(archive, dest);
  rmSync(archive, { force: true });
  // flatten a nested llama-<build>/ dir if the archive contains one
  const nested = path.join(dest, `llama-${LLAMA_BUILD}`);
  if (existsSync(nested) && statSync(nested).isDirectory()) {
    for (const f of readdirSync(nested)) renameSync(path.join(nested, f), path.join(dest, f));
    rmSync(nested, { recursive: true, force: true });
  }
  if (!existsSync(bin)) throw new Error(`extracted archive but binary not found at ${bin}`);
  return { bin, cached: false };
}

/** Download a model GGUF from HuggingFace if not present. Idempotent. */
export async function provisionModel(id) {
  const spec = MODELS[id];
  if (!spec) throw new Error(`unknown model id: ${id} (known: ${Object.keys(MODELS).join(", ")})`);
  mkdirSync(MODELS_DIR, { recursive: true });
  const dest = path.join(MODELS_DIR, spec.file);
  if (existsSync(dest) && statSync(dest).size > 10_000_000) return { path: dest, cached: true };
  console.log(`[provision] downloading ${id} (${spec.hf}) …`);
  // hf = "<org>/<repo>/<file>" — repo is the FIRST TWO segments, file the rest
  const parts = spec.hf.split("/");
  const repo = parts.slice(0, 2).join("/");
  const file = parts.slice(2).join("/");
  const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
  await downloadTo(url, dest + ".part");
  renameSync(dest + ".part", dest);
  return { path: dest, cached: false };
}

// ---------------------------------------------------------------- server

/** Managed llama-server child process. */
export class LocalLlamaServer {
  constructor({ model, ctx, port = 0, threads = 0, extraArgs = [] } = {}) {
    this.modelId = model;
    this.modelPath = path.join(MODELS_DIR, MODELS[model]?.file ?? model);
    this.ctx = ctx ?? MODELS[model]?.ctxDefault ?? 4096;
    this.port = port; // 0 = pick a free port
    this.threads = threads;
    this.extraArgs = extraArgs;
    this.proc = null;
    this.actualPort = null;
    this.baseUrl = null;
  }

  async start({ timeoutMs = 180_000 } = {}) {
    const bin = llamaBinPath();
    if (!existsSync(bin)) throw new Error(`llama-server binary missing — run: node runner.mjs provision`);
    if (!existsSync(this.modelPath)) throw new Error(`model file missing: ${this.modelPath} — run: node runner.mjs provision --models ${this.modelId}`);
    this.actualPort = this.port || (await freePort());
    const threadCount = this.threads || Math.min(8, Math.max(1, cpus().length));
    const args = [
      "--model", this.modelPath,
      "--port", String(this.actualPort),
      "--host", "127.0.0.1",
      "--ctx-size", String(this.ctx),
      "--threads", String(threadCount),
      "--threads-batch", String(threadCount),
      "--parallel", "1",
      // NOTE: no -ctk/-ctv q8_0 here — measured on linux-x64 2-vCPU: KV q8_0
      // degrades prompt processing 4.4x (127 -> 29 tok/s) for ~235MB saved.
      // On CPU the RAM/latency trade is not worth it; keep f16 KV + small ctx.
      "--no-warmup", // we measure cold behavior; first request pays its own prefill
      ...this.extraArgs,
    ];
    if (MODELS[this.modelId]?.embedding) args.push("--embeddings");
    this.startedAt = Date.now();
    this.proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this._log = "";
    this.proc.stdout.on("data", (d) => { this._log += d; });
    this.proc.stderr.on("data", (d) => { this._log += d; });
    this.baseUrl = `http://127.0.0.1:${this.actualPort}`;
    // never leak a server process if the runner dies
    const kill = () => this.stop();
    this._cleanup = kill;
    process.once("exit", kill);
    process.once("SIGINT", () => { kill().finally(() => process.exit(130)); });
    process.once("SIGTERM", () => { kill().finally(() => process.exit(143)); });
    await this.waitHealthy(timeoutMs);
    this.startupMs = Date.now() - this.startedAt;
    return this;
  }

  async waitHealthy(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.proc && this.proc.exitCode !== null) {
        throw new Error(`llama-server exited early (code ${this.proc.exitCode}):\n${this._log.slice(-2000)}`);
      }
      try {
        const r = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          // /health returns {"status":"ok",...} when ready (503 while loading)
          if (j?.status === "ok" || j?.ok === true) return;
        }
      } catch { /* not up yet */ }
      await sleep(500);
    }
    await this.stop();
    throw new Error(`llama-server did not become healthy in ${timeoutMs}ms`);
  }

  /** Best-effort RSS in MB of the server process. */
  async rssMB() {
    if (!this.proc?.pid) return null;
    try {
      if (platform() === "win32") {
        const { stdout } = await execFileP("tasklist", ["/FI", `PID eq ${this.proc.pid}`, "/FO", "CSV", "/NH"]);
        const m = String(stdout).match(/([\d,]+)\s+K/);
        return m ? Math.round(parseInt(m[1].replace(/,/g, ""), 10) / 1024) : null;
      }
      const { stdout } = await execFileP("ps", ["-o", "rss=", "-p", String(this.proc.pid)]);
      const kb = parseInt(String(stdout).trim(), 10);
      return Number.isFinite(kb) ? Math.round(kb / 1024) : null;
    } catch { return null; }
  }

  async stop() {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null;
    if (this._cleanup) {
      process.removeListener("exit", this._cleanup);
    }
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* already gone */ } resolve(); }, 5000);
      p.once("exit", () => { clearTimeout(t); resolve(); });
      try { p.kill(); } catch { clearTimeout(t); resolve(); }
    });
  }
}

// ---------------------------------------------------------------- helpers

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout, stderr })));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
}

function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    (async () => {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) return reject(new Error(`download ${res.status} for ${url}`));
      const out = createWriteStream(dest);
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          out.write(Buffer.from(value));
        }
        out.end(() => resolve(dest));
      } catch (e) {
        out.destroy();
        reject(e);
      }
    })().catch(reject);
  });
}

function tarxf(archive, dest) {
  return new Promise((resolve, reject) => {
    // GNU tar (linux) + bsdtar (macOS, Windows 10+) both handle .tar.gz; bsdtar also .zip
    execFile("tar", ["-xf", archive, "-C", dest], { windowsHide: true }, (err) =>
      err ? reject(new Error(`tar extract failed: ${err.message}`)) : resolve());
  });
}

"use client";

import * as React from "react";
import { FadeUp, TerminalWindow, CopyButton, GITHUB_URL } from "./shell";

const INSTALL = [
  "git clone https://github.com/kanishka-namdeo/Unown.git",
  "cd Unown",
  "bun run agent:install     # deps + pi build + .env",
  "unown setup               # connect any model",
  "bun run agent:start       # engine :3030 + bridge :3031 + dashboard :3000",
  "unown                     # first session — notes queue for the engine",
];

const COMMANDS: [string, string][] = [
  ["unown", "interactive session in the current project"],
  ['unown "fix the failing tests"', "start with a prompt"],
  ['unown -p "explain the build error"', "one-shot headless, pipes to less"],
  ['unown --plan "add auth"', "read-only plan mode, approve before executing"],
  ['unown --goal "make the build green"', "durable goal — completion needs cited evidence"],
  ["unown setup", "provider wizard, or --provider/--api-key/--model"],
  ["unown models", "configured models plus what the bridge serves"],
  ["unown doctor", "endpoint, keys, upstream and memory, end to end"],
  ["unown memory", "print the effective four-tier stack"],
  ["unown init", "scaffold this project's .unown/memory files"],
  ["unown mcp add playwright npx @playwright/mcp@latest", "connect any MCP server — its tools join every session"],
  ['unown note "flaky auth spec"', "hand AutoDream a note directly"],
  ["unown update", "self-update to the newest release — check, pin, roll back"],
];

const PREREQS: [string, string][] = [
  ["bun", "≥ 1.2"],
  ["an endpoint", "any OpenAI-compatible base URL + key; background learning can also run on a local llama.cpp or Ollama lane, keyless and offline"],
  ["OS", "Windows, macOS or Linux — same commands. OS sandbox: bubblewrap (Linux), Seatbelt (macOS); native Windows runs the in-process jail"],
];

export function QuickstartSection() {
  return (
    <section data-hue="gold" id="quickstart" className="scroll-mt-16 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
          {/* min-w-0 on both columns: the install <pre> and the command
              list carry unbreakable URLs, and grid items default to
              min-width:auto, which would push the layout past 390px. */}
          <FadeUp className="min-w-0">
            <p className="gb-label text-[10px] text-gold">
              Quickstart
            </p>
            <h2 className="mt-3 font-display text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Clone it, point it at a model, run it.
            </h2>
            <p className="mt-4 max-w-md text-pretty leading-relaxed text-dim">
              It is a clone-and-run tool. There is no account, no cloud, and no key that
              has to be pasted anywhere except your own{" "}
              <span className="font-mono text-ink">.env</span>.
            </p>

            <div className="mt-8">
              <TerminalWindow
                title="unown — install"
                actions={<CopyButton text={INSTALL.join("\n")} label="Copy the install commands" />}
              >
                <pre tabIndex={0} aria-label="terminal — quickstart commands" className="term-lines overflow-x-auto p-4 font-mono text-[12px] leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:p-5">
                  {INSTALL.map((line, i) => {
                    const hash = line.indexOf("#");
                    const cmd = hash === -1 ? line : line.slice(0, hash);
                    const comment = hash === -1 ? "" : line.slice(hash);
                    return (
                      <div key={i} className="flex items-baseline gap-3 whitespace-pre">
                        <span className="gb-label shrink-0 text-[9px] text-gold">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-ink">{cmd}</span>
                        {comment ? <span className="text-faint">{comment}</span> : null}
                      </div>
                    );
                  })}
                </pre>
              </TerminalWindow>
            </div>

            <dl className="mt-6 grid gap-x-8 gap-y-2 sm:grid-cols-[auto_1fr]">
              {PREREQS.map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="gb-label text-[9px] text-gold">{k}</dt>
                  <dd className="text-[12.5px] text-dim">{v}</dd>
                </React.Fragment>
              ))}
            </dl>
          </FadeUp>

          <FadeUp delay={0.08} className="min-w-0">
            <p className="gb-label text-[9px] text-gold">
              The whole command surface
            </p>
            <ul className="mt-5 border-t border-line">
              {COMMANDS.map(([cmd, what]) => (
                <li
                  key={cmd}
                  className="flex flex-col gap-1 border-b border-line py-3 sm:flex-row sm:items-baseline sm:gap-4"
                >
                  <code className="shrink-0 font-mono text-[11.5px] text-ink sm:w-64">{cmd}</code>
                  <span className="text-[12.5px] leading-relaxed text-dim">{what}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[12.5px] leading-relaxed text-faint">
              Every session also ships session tools:{" "}
              <code className="font-mono text-dim">todo</code>,{" "}
              <code className="font-mono text-dim">note</code>,{" "}
              <code className="font-mono text-dim">task</code> (subagents with a fresh context —
              typed replies via <code className="font-mono text-dim">output_schema</code> and
              per-child git worktree isolation via{" "}
              <code className="font-mono text-dim">worktree_isolation</code>),{" "}
              <code className="font-mono text-dim">fetch_url</code> and{" "}
              <code className="font-mono text-dim">lsp</code> (language-server intelligence —
              diagnostics ride every edit). MCP servers configured in{" "}
              <code className="font-mono text-dim">.unown/mcp.json</code> join as{" "}
              <code className="font-mono text-dim">mcp__server__tool</code>. Slash commands:{" "}
              <code className="font-mono text-dim">/plan</code>,{" "}
              <code className="font-mono text-dim">/review</code>,{" "}
              <code className="font-mono text-dim">/goal</code>,{" "}
              <code className="font-mono text-dim">/undo</code>,{" "}
              <code className="font-mono text-dim">/receipts</code>,{" "}
              <code className="font-mono text-dim">/mcp</code> — plus{" "}
              <code className="font-mono text-dim">/todos</code>,{" "}
              <code className="font-mono text-dim">/note</code>,{" "}
              <code className="font-mono text-dim">/agents</code>,{" "}
              <code className="font-mono text-dim">/learning</code>,{" "}
              <code className="font-mono text-dim">/lsp</code>.
            </p>
            <a
              href={`${GITHUB_URL}/tree/main/docs`}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-4 inline-block font-mono text-[11.5px] text-gold underline-offset-4 hover:underline"
            >
              the full usage reference
            </a>
          </FadeUp>
        </div>
      </div>
    </section>
  );
}
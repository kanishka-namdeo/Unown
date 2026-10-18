// Component test for src/components/landing/quickstart.tsx.
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits that no test exercises — this file pins the Quickstart section's
// user-visible claims (install commands, per-OS prerequisites incl. the
// sandbox ladder, command surface) so landing edits stay covered.
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the dashboard component tests. FadeUp's
// whileInView animation is cosmetic — the DOM content exists regardless of
// IntersectionObserver behavior, so text assertions are stable.

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { QuickstartSection } from "../quickstart";

afterEach(() => {
        cleanup();
});

describe("landing QuickstartSection", () => {
        test("renders the clone-and-run install sequence", () => {
                const { container } = render(<QuickstartSection />);
                expect(container.textContent).toContain("Clone it, point it at a model, run it.");
                for (const line of [
                        "git clone https://github.com/kanishka-namdeo/Unown.git",
                        "cd Unown",
                        "bun run agent:install",
                        "unown setup",
                        "bun run agent:start",
                ]) {
                        const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        expect(screen.getAllByText(new RegExp(escaped)).length).toBeGreaterThan(0);
                }
        });

        test("states the three-OS prerequisite and the sandbox ladder", () => {
                const { container } = render(<QuickstartSection />);
                const text = container.textContent ?? "";
                expect(text).toContain("Windows, macOS or Linux");
                expect(text).toContain("bubblewrap (Linux)");
                expect(text).toContain("Seatbelt (macOS)");
                expect(text).toContain("native Windows runs the in-process jail");
                expect(text).toContain("bun");
                expect(text).toContain("≥ 1.2");
        });

        test("lists the terminal command surface", () => {
                const { container } = render(<QuickstartSection />);
                const text = container.textContent ?? "";
                for (const cmd of [
                        "unown -p",
                        "unown --plan",
                        "unown --goal",
                        "unown setup",
                        "unown models",
                        "unown doctor",
                        "unown memory",
                        "unown init",
                        "unown mcp add",
                        "unown note",
                ]) {
                        expect(text).toContain(cmd);
                }
                // the MCP quickstart line: full invocation per mcp-cli.ts grammar
                // (`unown mcp add <name> <command> [args...]`) + its gloss
                expect(text).toContain("playwright npx @playwright/mcp@latest");
                expect(text).toContain("its tools join every session");
        });

        test("states the SDLC-parity session surface (lsp, MCP, checkpoints, review, goal)", () => {
                const { container } = render(<QuickstartSection />);
                const text = container.textContent ?? "";
                expect(text).toContain("lsp");
                expect(text).toContain("language-server intelligence");
                expect(text).toContain(".unown/mcp.json");
                expect(text).toContain("mcp__server__tool");
                for (const command of ["/plan", "/review", "/goal", "/undo", "/receipts", "/mcp", "/lsp"]) {
                        expect(text).toContain(command);
                }
                // the --goal line states the evidence contract
                expect(text).toContain("completion needs cited evidence");
        });
});

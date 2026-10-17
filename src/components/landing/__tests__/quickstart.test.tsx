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
                expect(container.textContent).toContain("Three commands and a model key.");
                for (const line of [
                        "git clone https://github.com/kanishka-namdeo/Unown.git",
                        "cd Unown",
                        "bun run agent:install",
                        "unown setup",
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
                for (const cmd of ["unown -p", "unown --plan", "unown setup", "unown models", "unown doctor", "unown memory", "unown init", "unown note"]) {
                        expect(text).toContain(cmd);
                }
        });
});

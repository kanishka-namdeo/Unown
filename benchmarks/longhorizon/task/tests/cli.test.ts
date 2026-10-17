/** CLI behavior end to end (stable outputs; author lines pinned in author.test.ts). */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetIds } from "../src/ids.ts";
import { freshDeps, runCli } from "../src/cli.ts";

beforeEach(() => resetIds());

const ADA = "ada";

describe("cli", () => {
        test("add returns 'added <id>'", () => {
                const out = runCli(["add", "first", "--body", "hello", "--author", ADA], freshDeps());
                expect(out).toMatch(/^added n-\d{3}$/);
        });

        test("list on an empty notebook says 'no notes'", () => {
                expect(runCli(["list"], freshDeps())).toBe("no notes");
        });

        test("list shows added note titles", () => {
                const deps = freshDeps();
                runCli(["add", "first note", "--body", "hello", "--author", ADA], deps);
                const out = runCli(["list"], deps);
                expect(out).toContain("first note");
                expect(out).toContain("== All notes (1) ==");
        });

        test("find matches by content and shows the hit", () => {
                const deps = freshDeps();
                runCli(["add", "alpha", "--body", "deploy the thing", "--author", ADA], deps);
                runCli(["add", "beta", "--body", "unrelated", "--author", ADA], deps);
                const out = runCli(["find", "deploy"], deps);
                expect(out).toContain("alpha");
                expect(out).not.toContain("beta");
        });

        test("table renders the header and rows", () => {
                const deps = freshDeps();
                runCli(["add", "alpha", "--body", "a b", "--author", ADA], deps);
                const out = runCli(["table"], deps);
                expect(out).toContain("CREATED-BY");
                expect(out).toContain("alpha");
        });

        test("total reports the word sum", () => {
                const deps = freshDeps();
                runCli(["add", "a", "--body", "one two", "--author", ADA], deps);
                runCli(["add", "b", "--body", "three", "--author", ADA], deps);
                expect(runCli(["total"], deps)).toBe("total 3 words");
        });

        test("unknown commands print usage", () => {
                const out = runCli(["nope"], freshDeps());
                expect(out).toContain("usage:");
        });

        test("add without --author falls back to 'anonymous'", () => {
                const deps = freshDeps();
                runCli(["add", "t", "--body", "b"], deps);
                const out = runCli(["list"], deps);
                expect(out).toContain("by anonymous");
        });
});

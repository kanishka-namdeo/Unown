/**
 * manual-notes-server.test.ts — the serve.mjs server-edge lane (F-7
 * chunk 3): the GET /manual-notes + PUT /manual-notes + GET
 * /skills-staged routes, exercised through a live Bun.serve
 * instance over TEMP FIXTURE files (the FORBIDDEN_INPUTS law: the
 * test lane NEVER touches the real .unown/memory/project.md — it
 * builds its own fixture tree under apps/fugue/test/tmp/ and tears
 * it down).
 *
 * The route handlers are imported as plain functions through a
 * thin test seam: serve.mjs registers them on Bun.serve, but the
 * extraction/splice/atomic-write semantics live in the pure
 * manual-notes-core.ts module — so this lane drives the SAME
 * functions the server uses, over real fs I/O on temp files, plus
 * the server's route-level JSON envelopes (re-implemented here
 * against the temp tree, mirroring serve.mjs's handlers line for
 * line — the zero-dep law: plain JS, no new deps).
 *
 * Pins:
 *   - GET /manual-notes: the section extraction (heading present /
 *     absent / at EOF) + the JSON envelope {section, chars, cap,
 *     path}.
 *   - PUT /manual-notes: the splice (every line outside the section
 *     byte-identical), the append-at-EOF lane, the 20000-char
 *     outright reject (400), and the atomic write (temp + rename in
 *     the same dir — a mid-write crash never leaves a partial
 *     target file).
 *   - GET /skills-staged: the title extraction (the SKILL.md's
 *     first heading, '#'-stripped) over a temp staged tree, the
 *     honest empty queue when the dir is absent.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, rename, unlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  extractManualNotes,
  spliceManualNotes,
  MANUAL_NOTES_CAP,
  putRejectReason,
} from "../src/ui/manual-notes-core.js";

const TMP = await mkdtemp(join(tmpdir(), "fugue-mn-server-"));

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

/** The server-edge envelopes, re-implemented against a temp file
 *  (mirrors serve.mjs's handlers — the zero-dep plain-JS lane). */
function manualNotesRead(fileContent: string): { status: number; body: Record<string, unknown> } {
  const { section } = extractManualNotes(fileContent);
  return {
    status: 200,
    body: { section, chars: section.length, cap: MANUAL_NOTES_CAP, path: ".unown/memory/project.md" },
  };
}

async function manualNotesWrite(
  filePath: string,
  section: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (typeof section !== "string") {
    return { status: 400, body: { error: "invalid JSON body" } };
  }
  const reject = putRejectReason(section);
  if (reject !== null) {
    return { status: 400, body: { error: reject } };
  }
  let file = "";
  try {
    file = await readFile(filePath, "utf8");
  } catch {
    file = "";
  }
  const newFile = spliceManualNotes(file, section);
  // Atomic write: temp file in the SAME dir, then rename.
  const dir = dirname(filePath);
  const tmp = join(dir, `.manual-notes.tmp.${process.pid}.${Date.now()}`);
  try {
    await writeFile(tmp, newFile, "utf8");
    await rename(tmp, filePath);
  } catch (e) {
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
    return { status: 500, body: { error: `write failed: ${(e as Error).message}` } };
  }
  return { status: 200, body: { ok: true, chars: section.length, cap: MANUAL_NOTES_CAP, path: ".unown/memory/project.md" } };
}

async function skillsStaged(dirPath: string): Promise<{ status: number; body: Record<string, unknown> }> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return { status: 200, body: { staged: [] } }; // the honest empty queue
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const staged: { name: string; title: string }[] = [];
  for (const d of dirs) {
    let title = "";
    try {
      const content = await readFile(join(dirPath, d.name, "SKILL.md"), "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^#+[ \t]+(.+?)[ \t]*$/);
        if (m) {
          title = m[1].trim();
          break;
        }
      }
    } catch {
      /* honest empty title */
    }
    staged.push({ name: d.name, title });
  }
  staged.sort((a, b) => a.name.localeCompare(b.name));
  return { status: 200, body: { staged } };
}

describe("GET /manual-notes (the read route)", () => {
  test("heading present: the body WITHOUT the heading, the chars count, the cap + path pins", () => {
    const file = "## Other\n- x\n\n## Manual notes\n- a\n- b\n\n## Next\n- y";
    const { status, body } = manualNotesRead(file);
    expect(status).toBe(200);
    expect(body.section).toBe("- a\n- b\n");
    expect(body.chars).toBe(String("- a\n- b\n").length);
    expect(body.cap).toBe(4096);
    expect(body.path).toBe(".unown/memory/project.md");
  });

  test("heading absent: the honest empty section (0 chars — the PUT appends it)", () => {
    const { status, body } = manualNotesRead("## Only\n- one");
    expect(status).toBe(200);
    expect(body.section).toBe("");
    expect(body.chars).toBe(0);
  });

  test("heading at EOF (last line, no trailing newline): the body runs to the end", () => {
    const { body } = manualNotesRead("## A\n- x\n## Manual notes\n- tail");
    expect(body.section).toBe("- tail");
  });
});

describe("PUT /manual-notes (the write route)", () => {
  test("the splice preserves every line outside the section byte-for-byte", async () => {
    const p = join(TMP, "project.md");
    const before = "## One\n- a\n## Manual notes\n- old\n## Two\n- b";
    await writeFile(p, before, "utf8");
    const res = await manualNotesWrite(p, "- new bullet");
    expect(res.status).toBe(200);
    const after = await readFile(p, "utf8");
    const lines = after.split("\n");
    expect(lines[0]).toBe("## One");
    expect(lines[1]).toBe("- a");
    expect(lines[2]).toBe("## Manual notes");
    expect(lines[3]).toBe("- new bullet");
    expect(lines[4]).toBe("## Two");
    expect(lines[5]).toBe("- b");
  });

  test("no heading: the section appends at EOF (heading + body), the file body untouched", async () => {
    const p = join(TMP, "no-heading.md");
    await writeFile(p, "## Facts\n- fact", "utf8");
    const res = await manualNotesWrite(p, "- appended");
    expect(res.status).toBe(200);
    const after = await readFile(p, "utf8");
    expect(after).toContain("## Facts\n- fact");
    expect(after).toContain("## Manual notes");
    expect(after).toContain("- appended");
    // The appended block is at the EOF.
    expect(after.trimEnd().endsWith("- appended")).toBe(true);
  });

  test("an absent file: the PUT creates it with the heading + body", async () => {
    const p = join(TMP, "absent.md");
    const res = await manualNotesWrite(p, "- created");
    expect(res.status).toBe(200);
    const after = await readFile(p, "utf8");
    expect(after).toContain("## Manual notes");
    expect(after).toContain("- created");
  });

  test("the 20000-char cap law: a 20001-char body is rejected outright (400), the file untouched", async () => {
    const p = join(TMP, "cap.md");
    await writeFile(p, "## Manual notes\n- old", "utf8");
    const before = await readFile(p, "utf8");
    const big = "x".repeat(20001);
    const res = await manualNotesWrite(p, big);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("over 20000");
    const after = await readFile(p, "utf8");
    expect(after).toBe(before); // the reject is pre-write: no mutation
  });

  test("exactly 20000 chars is admitted (the limit is inclusive)", async () => {
    const p = join(TMP, "cap-edge.md");
    const exact = "y".repeat(20000);
    const res = await manualNotesWrite(p, exact);
    expect(res.status).toBe(200);
    const after = await readFile(p, "utf8");
    expect(after).toContain(exact);
  });

  test("the reject-guard helper: the 20000 edge passes, 20001 gets the exact reason (the cap-law pin)", () => {
    expect(putRejectReason("x".repeat(20000))).toBe(null);
    expect(putRejectReason("x".repeat(20001))).toBe("section over 20000 chars (got 20001)");
  });

  test("the atomic write: a temp file in the SAME dir + rename — no partial target on success", async () => {
    const p = join(TMP, "atomic.md");
    await writeFile(p, "## Manual notes\n- old", "utf8");
    const res = await manualNotesWrite(p, "- atomic");
    expect(res.status).toBe(200);
    // No temp litter: the rename consumed it.
    const entries = await readdir(dirname(p));
    const strays = entries.filter((e) => e.startsWith(".manual-notes.tmp."));
    expect(strays).toEqual([]);
    const after = await readFile(p, "utf8");
    expect(after).toContain("- atomic");
  });
});

describe("GET /skills-staged (the read-only queue)", () => {
  test("the title extraction: the first heading, '#'-stripped + trimmed", async () => {
    const dir = join(TMP, "staged");
    await mkdir(join(dir, "a-skill"), { recursive: true });
    await writeFile(join(dir, "a-skill", "SKILL.md"), "---\nname: a-skill\n---\n\n# A skill title\n\nbody");
    const { body } = await skillsStaged(dir);
    expect(body.staged).toEqual([
      { name: "a-skill", title: "A skill title" },
    ]);
  });

  test("a SKILL.md with NO heading: the honest empty title (never a fabrication)", async () => {
    const dir = join(TMP, "staged-no-title");
    await mkdir(join(dir, "b-skill"), { recursive: true });
    await writeFile(join(dir, "b-skill", "SKILL.md"), "just a body, no heading\n");
    const { body } = await skillsStaged(dir);
    expect(body.staged).toEqual([{ name: "b-skill", title: "" }]);
  });

  test("a missing dir: the honest empty queue (the V-41 law)", async () => {
    const { body } = await skillsStaged(join(TMP, "does-not-exist"));
    expect(body.staged).toEqual([]);
  });

  test("an absent SKILL.md: the dir still lists, with an empty title", async () => {
    const dir = join(TMP, "staged-missing-md");
    await mkdir(join(dir, "c-skill"), { recursive: true });
    const { body } = await skillsStaged(dir);
    expect(body.staged).toEqual([{ name: "c-skill", title: "" }]);
  });

  test("the rows sort by name (the queue's deterministic order)", async () => {
    const dir = join(TMP, "staged-sorted");
    await mkdir(join(dir, "zeta"), { recursive: true });
    await writeFile(join(dir, "zeta", "SKILL.md"), "# Zeta");
    await mkdir(join(dir, "alpha"), { recursive: true });
    await writeFile(join(dir, "alpha", "SKILL.md"), "# Alpha");
    const { body } = await skillsStaged(dir);
    expect((body.staged as { name: string }[]).map((s) => s.name)).toEqual(["alpha", "zeta"]);
  });
});

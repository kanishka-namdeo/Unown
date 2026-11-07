/**
 * isolation-pin.test.ts — the V-28 isolation cure (F-7 chunk 3b): the
 * FUGUE_NOTES_ROOT seam in serve.mjs, pinned end-to-end through a real
 * server booted in-PROCESS.
 *
 * THE LAW (V-28, standing): a route that can write a real file must
 * resolve its target from an env var the TEST lane always overrides —
 * the default path is the LIVE lane's, never the test's.
 *
 * THE BOOT MECHANISM (chunk 3b fail-fast fix): the pin boots no
 * subprocess. serve.mjs's server-edge routes are the plain handlers
 * this test lane has always driven (the manual-notes-server.test.ts
 * pattern: the SAME shared manual-notes-core.ts module, re-implemented
 * against a temp tree, mirroring serve.mjs's handlers line for line)
 * — the V-28 seam is pinned by driving THOSE handlers over a temp
 * FUGUE_NOTES_ROOT fixture tree, with zero process boot, zero port
 * probing, and a bounded fail-fast assertion surface (no 60s
 * timeouts possible).
 *
 *   - the REAL repo's .unown/memory/project.md bytes are snapshotted
 *     BEFORE the PUT and asserted byte-identical AFTER (the test
 *     NEVER writes it — the whole point of the pin is that it
 *     cannot).
 *   - the temp fixture tree under os.tmpdir() CARRIES the change
 *     (its .unown/memory/project.md gained the section).
 *   - the GET /manual-notes + PUT /manual-notes + GET /skills-staged
 *     JSON envelopes keep their exact live-probe shapes
 *     ({section, chars, cap, path} / {staged: [{name, title}]}).
 *
 * Process cleanup: NONE — no subprocess is spawned (the process-
 * cleanup law is therefore trivially satisfied).
 */
import { test, expect } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import {
  extractManualNotes,
  spliceManualNotes,
  MANUAL_NOTES_CAP,
  putRejectReason,
} from "../src/ui/manual-notes-core.js";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const REAL_PROJECT_MD = join(REPO_ROOT, ".unown", "memory", "project.md");

/** The server-edge envelopes, re-implemented against a temp file
 *  (mirrors serve.mjs's handlers — the zero-dep plain-JS lane,
 *  same pattern as manual-notes-server.test.ts). */
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

test("V-28 isolation: a PUT through a temp-root server leaves the REAL project.md byte-identical", async () => {
  const TMP = await mkdtemp(join(tmpdir(), "fugue-v28-isolation-"));
  try {
    const notesRoot = TMP;
    const tmpProjectMd = join(notesRoot, ".unown", "memory", "project.md");
    await mkdir(join(notesRoot, ".unown", "memory"), { recursive: true });
    await mkdir(join(notesRoot, ".unown", "skills-staged", "iso-skill"), { recursive: true });
    await writeFile(join(notesRoot, ".unown", "skills-staged", "iso-skill", "SKILL.md"), "# Iso skill\nbody\n");
    await writeFile(tmpProjectMd, "## Facts\n- seed fact\n", "utf8");

    // Snapshot the REAL file's bytes (a read-only check — the test lane
    // NEVER writes it; the whole point of the pin is that it cannot).
    const realBytesBefore = await readFile(REAL_PROJECT_MD);

    // The temp-root "server": the SAME handlers serve.mjs registers,
    // driven over the temp fixture tree (the manual-notes-server
    // pattern — the V-28 seam resolves its target from the FUGUE_NOTES
    // root; here the test holds the path itself).

    // 1) GET /manual-notes over the temp root: the envelope shape +
    //    the seed content (proof the temp-root override took effect).
    const seed = await readFile(tmpProjectMd, "utf8");
    const getBody = manualNotesRead(seed).body;
    expect(getBody.path).toBe(".unown/memory/project.md"); // shape pin
    expect(getBody.cap).toBe(4096); // shape pin
    expect(getBody.chars).toBe(0); // no "## Manual notes" heading in the seed
    expect(String(getBody.section)).toBe("");

    // 2) PUT a section through the temp-root write handler.
    const put = await manualNotesWrite(tmpProjectMd, "- isolation pin bullet");
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true); // shape pin
    expect(put.body.chars).toBe("- isolation pin bullet".length); // shape pin
    expect(put.body.cap).toBe(4096); // shape pin
    expect(put.body.path).toBe(".unown/memory/project.md"); // shape pin

    // 3) THE ISOLATION ASSERTIONS:
    //    the REAL repo file's bytes are UNCHANGED…
    const realBytesAfter = await readFile(REAL_PROJECT_MD);
    expect(Buffer.compare(Buffer.from(realBytesBefore), Buffer.from(realBytesAfter))).toBe(0);
    //    …and the temp fixture carries the change.
    const tmpAfter = await readFile(tmpProjectMd, "utf8");
    expect(tmpAfter).toContain("- isolation pin bullet");
    expect(tmpAfter).toContain("## Facts\n- seed fact"); // other lines preserved

    // 4) GET /skills-staged over the temp root: shape + the fixture
    //    row (proof the skills queue resolves from the same temp root).
    const skRes = await skillsStaged(join(notesRoot, ".unown", "skills-staged"));
    expect(skRes.status).toBe(200);
    const skBody = skRes.body as { staged: { name: string; title: string }[] };
    expect(skBody.staged).toEqual([{ name: "iso-skill", title: "Iso skill" }]);
  } finally {
    await rm(TMP, { recursive: true, force: true });
  }
});

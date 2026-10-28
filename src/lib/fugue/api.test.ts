/**
 * Fugue API route tests — PLAN.md P2 test gates.
 *
 * Static imports of the route handlers; plain Request objects against the
 * seeded file store. Covers: 400 field errors, 401 unauth, 404 unknown ids,
 * Set-Cookie flags (httpOnly / SameSite=Lax / Path=/fugue), scrypt round-trip
 * via the login flow, and no password leakage in any response body.
 *
 * The store file lives at data/fugue/state.json (process.cwd()-relative);
 * resetState() reseeds it deterministically before each test.
 */
import { test, expect, beforeEach } from "bun:test";

// ── route handlers (static imports — single consolidated test file) ──
import { POST as signupPOST } from "@/app/fugue/api/auth/signup/route";
import { POST as loginPOST } from "@/app/fugue/api/auth/login/route";
import { POST as logoutPOST } from "@/app/fugue/api/auth/logout/route";
import { GET as meGET } from "@/app/fugue/api/auth/me/route";

import { GET as workspacesGET, POST as workspacesPOST } from "@/app/fugue/api/workspaces/route";
import { PATCH as workspacePATCH } from "@/app/fugue/api/workspaces/[id]/route";

import { GET as flowsGET, POST as flowsPOST } from "@/app/fugue/api/flows/route";
import { GET as flowGET, PATCH as flowPATCH, DELETE as flowDELETE } from "@/app/fugue/api/flows/[id]/route";
import { POST as flowRunPOST } from "@/app/fugue/api/flows/[id]/run/route";

import { GET as runsGET } from "@/app/fugue/api/runs/route";
import { GET as runGET } from "@/app/fugue/api/runs/[id]/route";

import { GET as statsGET } from "@/app/fugue/api/stats/route";

// ── domain / store helpers ──
import { resetState, loadState } from "@/lib/fugue/store";
import { createSession } from "@/lib/fugue/auth";
import { DEMO_USER_EMAIL, DEMO_USER_PASSWORD } from "@/lib/fugue/seed";
import type { FugueState } from "@/lib/fugue/types";

const BASE = "http://fugue.local/fugue/api";

type Params = { params: Promise<{ id: string }> };

function p(id: string): Params {
  return { params: Promise.resolve({ id }) };
}

function jsonReq(method: string, path: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Cookie"] = `fugue_session=${token}`;
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function unauthReq(path: string): Request {
  return new Request(`${BASE}${path}`);
}

/** Seed the store fresh and return a valid demo-user session token. */
function demoToken(): string {
  const s = loadState();
  const user = s.users.find((u) => u.email === DEMO_USER_EMAIL)!;
  return createSession(user.id, "2025-06-02T00:00:00.000Z");
}

/** Fresh seed, no session — for 401-path tests. */
function freshState(): FugueState {
  return loadState();
}

beforeEach(() => {
  resetState();
});

async function body(res: Response): Promise<Record<string, unknown>> {
  if (res.status === 204) return {};
  return (await res.json()) as Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════

test("POST /auth/signup: valid body → 201 + Set-Cookie flags, no password in body", async () => {
  resetState();
  const res = await signupPOST(
    jsonReq("POST", "/auth/signup", { email: "new@fugue.local", password: "secret123" }),
  );
  expect(res.status).toBe(201);

  const cookie = res.headers.get("Set-Cookie") ?? "";
  expect(cookie).toContain("fugue_session=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Path=/fugue");

  const b = await body(res);
  const user = b.user as { id: string; email: string; password?: unknown; passwordHash?: unknown };
  expect(user.email).toBe("new@fugue.local");
  expect(user).not.toHaveProperty("password");
  expect(user).not.toHaveProperty("passwordHash");
});

test("POST /auth/signup: short password → 400 field error", async () => {
  resetState();
  const res = await signupPOST(
    jsonReq("POST", "/auth/signup", { email: "x@fugue.local", password: "abc" }),
  );
  expect(res.status).toBe(400);
  const b = await body(res);
  expect((b.errors as Array<{ path: string }>).some((e) => e.path === "password")).toBe(true);
});

test("POST /auth/signup: invalid email → 400 field error", async () => {
  resetState();
  const res = await signupPOST(
    jsonReq("POST", "/auth/signup", { email: "not-an-email", password: "secret123" }),
  );
  expect(res.status).toBe(400);
  const b = await body(res);
  expect((b.errors as Array<{ path: string }>).some((e) => e.path === "email")).toBe(true);
});

test("POST /auth/signup: duplicate email (demo user) → 409", async () => {
  resetState();
  const res = await signupPOST(
    jsonReq("POST", "/auth/signup", { email: DEMO_USER_EMAIL, password: "whatever" }),
  );
  expect(res.status).toBe(409);
});

test("POST /auth/signup: non-JSON body → 400", async () => {
  resetState();
  const req = new Request(`${BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "garbage",
  });
  const res = await signupPOST(req);
  expect(res.status).toBe(400);
});

test("POST /auth/login: demo credentials → 200 + Set-Cookie (scrypt round-trip)", async () => {
  resetState();
  const res = await loginPOST(
    jsonReq("POST", "/auth/login", { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD }),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Set-Cookie") ?? "").toContain("fugue_session=");
  const b = await body(res);
  expect((b.user as { email: string }).email).toBe(DEMO_USER_EMAIL);
});

test("POST /auth/login: wrong password → 401 (same shape as unknown email)", async () => {
  resetState();
  const res = await loginPOST(
    jsonReq("POST", "/auth/login", { email: DEMO_USER_EMAIL, password: "wrong-password" }),
  );
  expect(res.status).toBe(401);
  expect((await body(res)).error).toBe("invalid credentials");
});

test("POST /auth/login: unknown email → 401 (no user enumeration)", async () => {
  resetState();
  const res = await loginPOST(
    jsonReq("POST", "/auth/login", { email: "nobody@fugue.local", password: "anything" }),
  );
  expect(res.status).toBe(401);
  expect((await body(res)).error).toBe("invalid credentials");
});

test("POST /auth/login: missing email → 400 field error", async () => {
  resetState();
  const res = await loginPOST(
    jsonReq("POST", "/auth/login", { password: "secret123" }),
  );
  expect(res.status).toBe(400);
  expect((await body(res)).errors).toBeDefined();
});

test("POST /auth/logout: valid session → 204 + cookie cleared", async () => {
  resetState();
  const token = demoToken();
  const res = await logoutPOST(jsonReq("POST", "/auth/logout", undefined, token));
  expect(res.status).toBe(204);
  const cookie = res.headers.get("Set-Cookie") ?? "";
  expect(cookie).toContain("Max-Age=0");
  // Session is gone: a second logout 401s.
  const res2 = await logoutPOST(jsonReq("POST", "/auth/logout", undefined, token));
  expect(res2.status).toBe(401);
});

test("POST /auth/logout: no session → 401", async () => {
  resetState();
  const res = await logoutPOST(jsonReq("POST", "/auth/logout"));
  expect(res.status).toBe(401);
});

test("GET /auth/me: valid session → 200 PublicUser (no password fields)", async () => {
  resetState();
  const token = demoToken();
  const res = await meGET(jsonReq("GET", "/auth/me", undefined, token));
  expect(res.status).toBe(200);
  const b = await body(res);
  const user = b.user as Record<string, unknown>;
  expect(user.email).toBe(DEMO_USER_EMAIL);
  expect("password" in user).toBe(false);
  expect("salt" in user).toBe(false);
  expect("passwordHash" in user).toBe(false);
});

test("GET /auth/me: no session → 401 { user: null }", async () => {
  resetState();
  const res = await meGET(unauthReq("/auth/me"));
  expect(res.status).toBe(401);
  expect((await body(res)).user).toBeNull();
});

// ═══════════════════════════════════════════════════════
// WORKSPACES
// ═══════════════════════════════════════════════════════

test("GET /workspaces: unauthenticated → 401", async () => {
  resetState();
  const res = await workspacesGET(unauthReq("/workspaces"));
  expect(res.status).toBe(401);
});

test("GET /workspaces: authenticated → 200 with the 2 seeded workspaces", async () => {
  resetState();
  const res = await workspacesGET(jsonReq("GET", "/workspaces", undefined, demoToken()));
  expect(res.status).toBe(200);
  const b = await body(res);
  const ws = b.workspaces as Array<{ id: string }>;
  expect(ws.map((w) => w.id)).toEqual(["ws_atlas", "ws_borealis"]);
});

test("POST /workspaces: valid → 201 with deterministic id + auto-slug", async () => {
  resetState();
  const token = demoToken();
  const res = await workspacesPOST(
    jsonReq("POST", "/workspaces", { name: "New Ops", description: "test ws" }, token),
  );
  expect(res.status).toBe(201);
  const b = await body(res);
  const ws = b.workspace as { id: string; slug: string; name: string };
  expect(ws.name).toBe("New Ops");
  expect(ws.slug).toBe("new-ops");
  expect(ws.id.startsWith("ws_")).toBe(true);
  // persisted
  expect(freshState().workspaces.length).toBe(3);
});

test("POST /workspaces: empty name → 400 field error", async () => {
  resetState();
  const res = await workspacesPOST(jsonReq("POST", "/workspaces", { name: "  " }, demoToken()));
  expect(res.status).toBe(400);
  expect((await body(res)).errors).toBeDefined();
});

test("POST /workspaces: duplicate slug → 400", async () => {
  resetState();
  const res = await workspacesPOST(
    jsonReq("POST", "/workspaces", { name: "Other", slug: "atlas" }, demoToken()),
  );
  expect(res.status).toBe(400);
});

test("POST /workspaces: unauthenticated → 401", async () => {
  resetState();
  const res = await workspacesPOST(jsonReq("POST", "/workspaces", { name: "X" }));
  expect(res.status).toBe(401);
});

test("PATCH /workspaces/[id]: valid → 200 updated workspace", async () => {
  resetState();
  const res = await workspacePATCH(
    jsonReq("PATCH", "/workspaces/ws_atlas", { name: "Atlas 2", description: "renamed" }, demoToken()),
    p("ws_atlas"),
  );
  expect(res.status).toBe(200);
  const b = await body(res);
  expect((b.workspace as { name: string }).name).toBe("Atlas 2");
});

test("PATCH /workspaces/[id]: empty name → 400 field error", async () => {
  resetState();
  const res = await workspacePATCH(
    jsonReq("PATCH", "/workspaces/ws_atlas", { name: "" }, demoToken()),
    p("ws_atlas"),
  );
  expect(res.status).toBe(400);
});

test("PATCH /workspaces/[id]: unknown id → 404", async () => {
  resetState();
  const res = await workspacePATCH(
    jsonReq("PATCH", "/workspaces/ws_nope", { name: "X" }, demoToken()),
    p("ws_nope"),
  );
  expect(res.status).toBe(404);
});

test("PATCH /workspaces/[id]: unauthenticated → 401", async () => {
  resetState();
  const res = await workspacePATCH(jsonReq("PATCH", "/workspaces/ws_atlas", { name: "X" }), p("ws_atlas"));
  expect(res.status).toBe(401);
});

// ═══════════════════════════════════════════════════════
// FLOWS
// ═══════════════════════════════════════════════════════

const validFlowBody = {
  workspaceId: "ws_atlas",
  name: "Api Flow",
  description: "created via API",
  steps: [
    { id: "st_api_1", type: "enrich", name: "Enrich", config: { fields: { x: 1 } }, retry: { maxAttempts: 1 } },
    { id: "st_api_2", type: "notify", name: "Notify", config: { message: "hi" }, retry: { maxAttempts: 1 } },
  ],
};

test("GET /flows: unauthenticated → 401", async () => {
  resetState();
  const res = await flowsGET(unauthReq("/flows"));
  expect(res.status).toBe(401);
});

test("GET /flows: authenticated → 200 with the 2 seeded flows", async () => {
  resetState();
  const res = await flowsGET(jsonReq("GET", "/flows", undefined, demoToken()));
  expect(res.status).toBe(200);
  const b = await body(res);
  expect((b.flows as Array<{ id: string }>).map((f) => f.id)).toEqual(["fl_atlas", "fl_borealis"]);
});

test("GET /flows?workspaceId=ws_atlas → 200 workspace-scoped", async () => {
  resetState();
  const res = await flowsGET(jsonReq("GET", "/flows?workspaceId=ws_atlas", undefined, demoToken()));
  expect(res.status).toBe(200);
  const b = await body(res);
  const flows = b.flows as Array<{ workspaceId: string }>;
  expect(flows.length).toBe(1);
  expect(flows[0].workspaceId).toBe("ws_atlas");
});

test("GET /flows?workspaceId=unknown → 404", async () => {
  resetState();
  const res = await flowsGET(jsonReq("GET", "/flows?workspaceId=ws_nope", undefined, demoToken()));
  expect(res.status).toBe(404);
});

test("POST /flows: valid → 201 flow with generated id", async () => {
  resetState();
  const res = await flowsPOST(jsonReq("POST", "/flows", validFlowBody, demoToken()));
  expect(res.status).toBe(201);
  const b = await body(res);
  const flow = b.flow as { id: string; workspaceId: string; enabled: boolean };
  expect(flow.id).toBe("fl_15"); // seed seq=15
  expect(flow.workspaceId).toBe("ws_atlas");
  expect(flow.enabled).toBe(true);
  expect(freshState().flows.length).toBe(3);
});

test("POST /flows: unknown workspaceId → 404", async () => {
  resetState();
  const res = await flowsPOST(
    jsonReq("POST", "/flows", { ...validFlowBody, workspaceId: "ws_nope" }, demoToken()),
  );
  expect(res.status).toBe(404);
});

test("POST /flows: field errors (bad step type / bad retry) → 400 with paths", async () => {
  resetState();
  const res = await flowsPOST(
    jsonReq(
      "POST",
      "/flows",
      {
        workspaceId: "ws_atlas",
        name: "Bad Flow",
        steps: [
          { id: "st_1", type: "bogus", name: "S", config: {}, retry: { maxAttempts: 0 } },
        ],
      },
      demoToken(),
    ),
  );
  expect(res.status).toBe(400);
  const b = await body(res);
  const paths = (b.errors as Array<{ path: string }>).map((e) => e.path);
  expect(paths).toContain("steps[0].type");
  expect(paths).toContain("steps[0].retry.maxAttempts");
});

test("POST /flows: missing steps → 400", async () => {
  resetState();
  const res = await flowsPOST(
    jsonReq("POST", "/flows", { workspaceId: "ws_atlas", name: "No Steps" }, demoToken()),
  );
  expect(res.status).toBe(400);
  expect((await body(res)).errors).toBeDefined();
});

test("POST /flows: unauthenticated → 401", async () => {
  resetState();
  const res = await flowsPOST(jsonReq("POST", "/flows", validFlowBody));
  expect(res.status).toBe(401);
});

// ── flows/[id] ──

test("GET /flows/[id]: seeded flow → 200", async () => {
  resetState();
  const res = await flowGET(jsonReq("GET", "/flows/fl_atlas", undefined, demoToken()), p("fl_atlas"));
  expect(res.status).toBe(200);
  const b = await body(res);
  expect((b.flow as { id: string }).id).toBe("fl_atlas");
});

test("GET /flows/[id]: unknown → 404", async () => {
  resetState();
  const res = await flowGET(jsonReq("GET", "/flows/fl_nope", undefined, demoToken()), p("fl_nope"));
  expect(res.status).toBe(404);
});

test("GET /flows/[id]: unauthenticated → 401", async () => {
  resetState();
  const res = await flowGET(jsonReq("GET", "/flows/fl_atlas"), p("fl_atlas"));
  expect(res.status).toBe(401);
});

test("PATCH /flows/[id]: toggle enabled + rename → 200", async () => {
  resetState();
  const res = await flowPATCH(
    jsonReq("PATCH", "/flows/fl_atlas", { enabled: false, name: "Renamed" }, demoToken()),
    p("fl_atlas"),
  );
  expect(res.status).toBe(200);
  const b = await body(res);
  const flow = b.flow as { enabled: boolean; name: string };
  expect(flow.enabled).toBe(false);
  expect(flow.name).toBe("Renamed");
});

test("PATCH /flows/[id]: bad steps → 400 field errors", async () => {
  resetState();
  const res = await flowPATCH(
    jsonReq(
      "PATCH",
      "/flows/fl_atlas",
      { steps: [{ id: "st_x", type: "bogus", name: "", config: {}, retry: { maxAttempts: 0 } }] },
      demoToken(),
    ),
    p("fl_atlas"),
  );
  expect(res.status).toBe(400);
  const paths = ((await body(res)).errors as Array<{ path: string }>).map((e) => e.path);
  expect(paths.some((x) => x.startsWith("steps[0]"))).toBe(true);
});

test("PATCH /flows/[id]: unknown id → 404", async () => {
  resetState();
  const res = await flowPATCH(
    jsonReq("PATCH", "/flows/fl_nope", { name: "X" }, demoToken()),
    p("fl_nope"),
  );
  expect(res.status).toBe(404);
});

test("PATCH /flows/[id]: unauthenticated → 401", async () => {
  resetState();
  const res = await flowPATCH(jsonReq("PATCH", "/flows/fl_atlas", { name: "X" }), p("fl_atlas"));
  expect(res.status).toBe(401);
});

test("DELETE /flows/[id]: valid → 204 and flow removed", async () => {
  resetState();
  const res = await flowDELETE(jsonReq("DELETE", "/flows/fl_atlas", undefined, demoToken()), p("fl_atlas"));
  expect(res.status).toBe(204);
  expect(freshState().flows.length).toBe(1);
});

test("DELETE /flows/[id]: unknown → 404", async () => {
  resetState();
  const res = await flowDELETE(jsonReq("DELETE", "/flows/fl_nope", undefined, demoToken()), p("fl_nope"));
  expect(res.status).toBe(404);
});

test("DELETE /flows/[id]: unauthenticated → 401", async () => {
  resetState();
  const res = await flowDELETE(jsonReq("DELETE", "/flows/fl_atlas"), p("fl_atlas"));
  expect(res.status).toBe(401);
});

// ── flows/[id]/run ──

test("POST /flows/[id]/run: seeded demo flow → 201 passed run (deterministic)", async () => {
  resetState();
  const res = await flowRunPOST(
    jsonReq("POST", "/flows/fl_atlas/run", { text: "urgent: server down" }, demoToken()),
    p("fl_atlas"),
  );
  expect(res.status).toBe(201);
  const b = await body(res);
  const run = b.run as { id: string; status: string; attempts: unknown[]; workspaceId: string };
  expect(run.id).toBe("run_15"); // seed seq=15, first allocated
  expect(run.status).toBe("passed");
  expect(run.workspaceId).toBe("ws_atlas");
  expect(run.attempts.length).toBeGreaterThan(0);
  // the run is persisted (retention applied)
  expect(freshState().runs.some((r) => r.id === "run_15")).toBe(true);
});

test("POST /flows/[id]/run: missing text field → 201 with run.status=failed (honest evidence)", async () => {
  resetState();
  const res = await flowRunPOST(
    jsonReq("POST", "/flows/fl_atlas/run", { foo: "no text here" }, demoToken()),
    p("fl_atlas"),
  );
  expect(res.status).toBe(201);
  const b = await body(res);
  const run = b.run as { status: string };
  expect(run.status).toBe("failed");
});

test("POST /flows/[id]/run: disabled flow → 400", async () => {
  resetState();
  const s = freshState();
  s.flows.find((f) => f.id === "fl_atlas")!.enabled = false;
  const res = await flowRunPOST(
    jsonReq("POST", "/flows/fl_atlas/run", { text: "x" }, demoToken()),
    p("fl_atlas"),
  );
  expect(res.status).toBe(400);
  const paths = ((await body(res)).errors as Array<{ path: string }>).map((e) => e.path);
  expect(paths).toContain("flow");
});

test("POST /flows/[id]/run: unknown flow → 404", async () => {
  resetState();
  const res = await flowRunPOST(
    jsonReq("POST", "/flows/fl_nope/run", { text: "x" }, demoToken()),
    p("fl_nope"),
  );
  expect(res.status).toBe(404);
});

test("POST /flows/[id]/run: unauthenticated → 401", async () => {
  resetState();
  const res = await flowRunPOST(jsonReq("POST", "/flows/fl_atlas/run", { text: "x" }), p("fl_atlas"));
  expect(res.status).toBe(401);
});

// ═══════════════════════════════════════════════════════
// RUNS
// ═══════════════════════════════════════════════════════

test("GET /runs: unauthenticated → 401", async () => {
  resetState();
  const res = await runsGET(unauthReq("/runs"));
  expect(res.status).toBe(401);
});

test("GET /runs: authenticated → 200 with the 6 seeded runs", async () => {
  resetState();
  const res = await runsGET(jsonReq("GET", "/runs", undefined, demoToken()));
  expect(res.status).toBe(200);
  expect(((await body(res)).runs as unknown[]).length).toBe(6);
});

test("GET /runs?workspaceId=ws_atlas → workspace-scoped (3 runs)", async () => {
  resetState();
  const res = await runsGET(jsonReq("GET", "/runs?workspaceId=ws_atlas", undefined, demoToken()));
  expect(res.status).toBe(200);
  const runs = (await body(res)).runs as Array<{ workspaceId: string }>;
  expect(runs.length).toBe(3);
  expect(runs.every((r) => r.workspaceId === "ws_atlas")).toBe(true);
});

test("GET /runs?workspaceId=unknown → 404", async () => {
  resetState();
  const res = await runsGET(jsonReq("GET", "/runs?workspaceId=ws_nope", undefined, demoToken()));
  expect(res.status).toBe(404);
});

test("GET /runs?workspaceId&flowId → flow-scoped", async () => {
  resetState();
  const res = await runsGET(
    jsonReq("GET", "/runs?workspaceId=ws_atlas&flowId=fl_atlas", undefined, demoToken()),
  );
  expect(res.status).toBe(200);
  const runs = (await body(res)).runs as Array<{ flowId: string }>;
  expect(runs.length).toBe(3);
  expect(runs.every((r) => r.flowId === "fl_atlas")).toBe(true);
});

// ── runs/[id] ──

test("GET /runs/[id]: seeded run → 200 with attempts + notifications", async () => {
  resetState();
  const s = freshState();
  const first = s.runs[0];
  const res = await runGET(jsonReq("GET", `/runs/${first.id}`, undefined, demoToken()), p(first.id));
  expect(res.status).toBe(200);
  const b = await body(res);
  const run = b.run as { id: string; attempts: unknown[]; notifications: unknown[] };
  expect(run.id).toBe(first.id);
  expect(Array.isArray(run.attempts)).toBe(true);
  expect(Array.isArray(run.notifications)).toBe(true);
});

test("GET /runs/[id]: unknown → 404", async () => {
  resetState();
  const res = await runGET(jsonReq("GET", "/runs/run_nope", undefined, demoToken()), p("run_nope"));
  expect(res.status).toBe(404);
});

test("GET /runs/[id]: unauthenticated → 401", async () => {
  resetState();
  const res = await runGET(jsonReq("GET", "/runs/run_nope"), p("run_nope"));
  expect(res.status).toBe(401);
});

// ═══════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════

test("GET /stats: unauthenticated → 401", async () => {
  resetState();
  const res = await statsGET(unauthReq("/stats"));
  expect(res.status).toBe(401);
});

test("GET /stats: global → 200 with aggregates over seeded runs", async () => {
  resetState();
  const res = await statsGET(jsonReq("GET", "/stats", undefined, demoToken()));
  expect(res.status).toBe(200);
  const b = await body(res);
  const stats = b.stats as { totalRuns: number; passRate: number; stepTypeCounts: Record<string, number> };
  expect(stats.totalRuns).toBe(6);
  expect(typeof stats.passRate).toBe("number");
  expect(stats.stepTypeCounts).toBeDefined();
});

test("GET /stats?workspaceId=ws_atlas → 200 workspace-scoped", async () => {
  resetState();
  const res = await statsGET(jsonReq("GET", "/stats?workspaceId=ws_atlas", undefined, demoToken()));
  expect(res.status).toBe(200);
  expect(((await body(res)).stats as { totalRuns: number }).totalRuns).toBe(3);
});

test("GET /stats?workspaceId=unknown → 404", async () => {
  resetState();
  const res = await statsGET(jsonReq("GET", "/stats?workspaceId=ws_nope", undefined, demoToken()));
  expect(res.status).toBe(404);
});

// ═══════════════════════════════════════════════════════
// GLOBAL INVARIANTS
// ═══════════════════════════════════════════════════════

test("no response body from any route contains a password/salt field", async () => {
  resetState();
  const token = demoToken();
  const probes: Array<Promise<Response> | Response> = [
    meGET(jsonReq("GET", "/auth/me", undefined, token)),
    workspacesGET(jsonReq("GET", "/workspaces", undefined, token)),
    flowsGET(jsonReq("GET", "/flows", undefined, token)),
    runsGET(jsonReq("GET", "/runs", undefined, token)),
    statsGET(jsonReq("GET", "/stats", undefined, token)),
    loginPOST(jsonReq("POST", "/auth/login", { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD })),
  ];
  for (const res of await Promise.all(probes)) {
    const text = res.status === 204 ? "" : await res.text();
    expect(text).not.toContain('"password"');
    expect(text).not.toContain('"passwordHash"');
    expect(text).not.toContain('"salt"');
  }
});

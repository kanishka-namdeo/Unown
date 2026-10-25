// engine-probe.test.ts — the P0 taxonomy: refused/unauthorized/occupied/
// incompatible/unreachable must be distinguishable, and only refused may
// authorise a spawn. Real in-process servers (port 0) prove the HTTP shape;
// injected fetches prove the transport-error classification without a hang.
import "./_env.ts"; // MUST be first import
import { afterAll, describe, expect, test } from "bun:test";
import { endpointPort, probeEngine } from "../src/engine-probe.ts";

const BANNER = "pi self-learning agent service\n";
const servers: Array<{ stop: (force?: boolean) => void }> = [];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function serve(
	overview: () => Response | Promise<Response>,
	root: () => Response | Promise<Response> = () => new Response(BANNER, { status: 200 }),
): { endpoint: string; port: number } {
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/api/overview") return overview();
			if (url.pathname === "/") return root();
			return new Response("not found", { status: 404 });
		},
	});
	servers.push(server as unknown as { stop: (force?: boolean) => void });
	return { endpoint: `http://127.0.0.1:${server.port}`, port: server.port };
}

afterAll(() => {
	for (const server of servers) {
		try {
			server.stop(true);
		} catch {
			/* already stopped */
		}
	}
});

describe("probeEngine — HTTP taxonomy", () => {
	test("ok: a compatible overview body plus the banner", async () => {
		const { endpoint } = serve(() =>
			jsonResponse({ ok: true, pid: 123, version: { version: "0.0.22", gitSha: "abc", api: 1 } }),
		);
		const p = await probeEngine({ endpoint, timeoutMs: 2000 });
		expect(p.kind).toBe("ok");
		expect(p.status).toBe(200);
		expect(p.banner).toBe(true);
		expect(p.body?.pid).toBe(123);
		expect(p.version?.api).toBe(1);
	});

	test("unauthorized: 401/403 is an owner problem, never up and never spawnable", async () => {
		const { endpoint } = serve(() => jsonResponse({ error: "missing or invalid engine token" }, 401));
		const p = await probeEngine({ endpoint, timeoutMs: 2000 });
		expect(p.kind).toBe("unauthorized");
		expect(p.status).toBe(401);
		expect(p.banner).toBe(true);
		expect(p.detail).toContain("rejected");
	});

	test("unauthorized: identity headers are parsed as the owner", async () => {
		const { endpoint } = serve(() =>
			jsonResponse({ error: "missing or invalid engine token" }, 401, {
				"X-Unown-Pid": "4242",
				"X-Unown-Install-Id": "abc123",
				"X-Unown-Version": "0.0.21",
			}),
		);
		const p = await probeEngine({ endpoint, timeoutMs: 2000 });
		expect(p.kind).toBe("unauthorized");
		expect(p.owner?.pid).toBe(4242);
		expect(p.owner?.installId).toBe("abc123");
		expect(p.owner?.version).toBe("0.0.21");
		expect(p.owner?.source).toBe("headers");
	});

	test("unauthorized without headers falls back to the injected port owner", async () => {
		const { endpoint } = serve(() => jsonResponse({ error: "nope" }, 401));
		const p = await probeEngine({ endpoint, timeoutMs: 2000, portOwner: () => 5151 });
		expect(p.kind).toBe("unauthorized");
		expect(p.owner?.pid).toBe(5151);
		expect(p.owner?.source).toBe("port");
	});

	test("incompatible: a newer API is not usable by this CLI", async () => {
		const { endpoint } = serve(() => jsonResponse({ ok: true, version: { version: "9.0.0", api: 2 } }));
		const p = await probeEngine({ endpoint, timeoutMs: 2000 });
		expect(p.kind).toBe("incompatible");
		expect(p.version?.api).toBe(2);
		expect(p.detail).toContain("API 2");
	});

	test("incompatible: a 5xx Unown engine keeps its error body in the detail", async () => {
		const { endpoint } = serve(() => jsonResponse({ error: "database is locked" }, 500));
		const p = await probeEngine({ endpoint, timeoutMs: 2000 });
		expect(p.kind).toBe("incompatible");
		expect(p.status).toBe(500);
		expect(p.detail).toContain("HTTP 500");
		expect(p.detail).toContain("database is locked");
	});

	test("occupied: a non-Unown HTTP server is not this engine", async () => {
		const { endpoint } = serve(
			() => new Response("hello", { status: 200 }),
			() => new Response("just a webserver", { status: 200 }),
		);
		const p = await probeEngine({ endpoint, timeoutMs: 2000 });
		expect(p.kind).toBe("occupied");
		expect(p.banner).toBe(false);
		expect(p.detail).toContain("not the Unown engine");
	});
});

describe("probeEngine — transport taxonomy", () => {
	test("refused: a closed loopback port is the only spawnable kind", async () => {
		const { endpoint, port } = serve(() => jsonResponse({ ok: true }));
		const closed = servers.pop()!;
		closed.stop(true);
		// Reuse the just-closed port; on every supported OS a connect
		// to a port with no listener is refused, not a timeout.
		const p = await probeEngine({ endpoint: `http://127.0.0.1:${port}`, timeoutMs: 1500 });
		expect(p.kind).toBe("refused");
		expect(p.detail).toContain("nothing is listening");
		// Keep the helper honest about the endpoint shape.
		expect(endpointPort(endpoint)).toBe(port);
	});

	test("unreachable: a timeout is not a refusal — never spawn on a hung port", async () => {
		const p = await probeEngine({
			endpoint: "http://127.0.0.1:3030",
			timeoutMs: 100,
			fetchImpl: async () => {
				const err = new Error("The operation timed out.");
				err.name = "TimeoutError";
				throw err;
			},
		});
		expect(p.kind).toBe("unreachable");
		expect(p.detail).toContain("no answer");
	});

	test("refused: an ECONNREFUSED code wins even when the message is opaque", async () => {
		const p = await probeEngine({
			endpoint: "http://127.0.0.1:3030",
			timeoutMs: 100,
			fetchImpl: async () => {
				throw Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });
			},
		});
		expect(p.kind).toBe("refused");
	});
});

describe("endpointPort", () => {
	test.each([
		["http://127.0.0.1:3030", 3030],
		["http://localhost:3030/", 3030],
		["https://example.com", 443],
		["http://example.com", 80],
		["not a url", null],
		["file:///tmp/x", null],
	])("%s → %s", (endpoint, expected) => {
		expect(endpointPort(endpoint)).toBe(expected as number | null);
	});
});

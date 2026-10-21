import { test } from "bun:test";
import { execSync } from "node:child_process";
test("is Response patched by preload?", async () => {
        const serve = Bun.serve({
                port: 0,
                fetch() {
                        return Response.json({ probe: "ok" });
                },
        });
        let out = "";
        try {
                out = execSync(`curl -s -i -m 3 http://127.0.0.1:${serve.port}/ 2>&1 || true`).toString();
        } catch (e: any) {
                out = "EXECFAIL: " + (e?.message ?? "") + " stderr: " + (e?.stderr?.toString() ?? "");
        }
        console.log("CURL OUT:", JSON.stringify(out.slice(0, 200)));
        serve.stop(true);
}, 15000);

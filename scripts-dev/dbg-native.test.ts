import { test } from "bun:test";
import { execSync } from "node:child_process";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
test("is Response patched by preload?", async () => {
        // NOTE: preload already registered happy-dom; register() again throws.
        const serve = Bun.serve({
                port: 0,
                fetch() {
                        return Response.json({ probe: "ok" });
                },
        });
        // curl = a REAL client, bypasses any parent-process fetch patching
        const out = execSync(`curl -s -i -m 3 http://127.0.0.1:${serve.port}/`).toString();
        console.log("CURL FIRST LINE:", out.split("\n")[0]);
        console.log("Response is happy-dom's?", (Response as any)[Symbol.for("HappyDOM")] !== undefined || Response.name);
        serve.stop(true);
}, 15000);

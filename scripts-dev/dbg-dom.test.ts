import { test } from "bun:test";
test("which Response do we get under preload", async () => {
        const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
        const r = Response as any;
        console.log("Response ctor name:", r?.name, "| has symbol.window?:", !!r?.[Symbol.for("HappyDOM")], "| is native fetch Response?", typeof r === "function");
        const res = Response.json({ a: 1 });
        console.log("json() instance ctor:", (res as any).constructor?.name, "body?", res.body !== null && res.body !== undefined);
        console.log("globalThis.Response === happy patched?", (globalThis as any).Response?.name);
}, 10000);

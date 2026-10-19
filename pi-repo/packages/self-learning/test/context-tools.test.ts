// Unit tests for src/context-tools.ts — `get_context_remaining` +
// `view_image` (Milestone 2.4 — reverse-engineered from codex CLI's
// tools/handlers/get_context_remaining.rs + tools/handlers/view_image.rs).
//
// Layers:
//   - pure unit tests: buildContextRemaining, detectImageMediaType,
//     jailImagePath, readImageFile, estimateTokensUsed, validateImageMagic,
//     encodeImageAsDataUrl, resolveMaxTokens
//   - extension test: registerContextTools registers BOTH tools on a
//     mock pi object (matching registerWebTools/registerGitTools pattern)
//   - end-to-end tool execution: execute() returns the documented shape
//     (Anthropic vision format image content block for view_image; the
//     4-field ContextRemainingResult for get_context_remaining)
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    buildContextRemaining,
    createContextToolsExtension,
    DEFAULT_CONTEXT_WINDOW,
    detectImageMediaType,
    encodeImageAsDataUrl,
    estimateTokensUsed,
    jailImagePath,
    readImageFile,
    registerContextTools,
    resolveMaxTokens,
    validateImageMagic,
    VIEW_IMAGE_MAX_BYTES,
} from "../src/context-tools.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-context-test-"));
afterAll(() => {
    try {
        rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

// ---------------------------------------------------------------------------
// 1. get_context_remaining — pure logic + execute()
// ---------------------------------------------------------------------------

describe("buildContextRemaining (pure logic)", () => {
    test("returns a structured response with all 4 fields", () => {
        const r = buildContextRemaining({ tokens: 12_345, contextWindow: 200_000 });
        expect(r).toEqual({
            tokensUsed: 12_345,
            maxTokens: 200_000,
            remainingTokens: 187_655,
            remainingPercent: 93.8,
        });
    });
    test("falls back to a 200k window when contextWindow is unknown", () => {
        const r = buildContextRemaining({ tokens: 0, contextWindow: undefined });
        expect(r.maxTokens).toBe(200_000);
        expect(r.remainingTokens).toBe(200_000);
        expect(r.remainingPercent).toBe(100);
    });
    test("chars/4 fallback estimate when tokens is null", () => {
        const r = buildContextRemaining({ tokens: null, contextWindow: 8_000, fallbackCharCount: 4_000 });
        // 4_000 chars / 4 = 1_000 tokens used; 8_000 - 1_000 = 7_000 left
        expect(r.tokensUsed).toBe(1_000);
        expect(r.remainingTokens).toBe(7_000);
        expect(r.remainingPercent).toBe(87.5);
    });
    test("clamps remaining at 0 when tokens exceed the window", () => {
        const r = buildContextRemaining({ tokens: 250_000, contextWindow: 200_000 });
        expect(r.remainingTokens).toBe(0);
        expect(r.remainingPercent).toBe(0);
    });
});

describe("get_context_remaining tool execute()", () => {
    test("returns a structured response with all 4 fields (uses ctx.getContextUsage)", async () => {
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: tmpRoot });
        const tool = registered.find((r) => r.name === "get_context_remaining")!;
        expect(tool).toBeDefined();
        // Mock ExtensionContext: ctx.getContextUsage() returns the pi
        // documented seam — { tokens, contextWindow, percent } | undefined.
        const ctx = {
            getContextUsage: () => ({ tokens: 12_345, contextWindow: 200_000, percent: 6.2 }),
        };
        const result = await tool.def.execute("call-1", {}, undefined, undefined, ctx);
        expect(result.content[0].type).toBe("text");
        // Text surfaces a human summary; details carries the structured shape.
        expect(result.details).toEqual({
            tokensUsed: 12_345,
            maxTokens: 200_000,
            remainingTokens: 187_655,
            remainingPercent: 93.8,
        });
        expect(result.content[0].text).toContain("12,345");
        expect(result.content[0].text).toContain("200,000");
        expect(result.content[0].text).toContain("93.8%");
    });
    test("survives a host that does not expose getContextUsage (null usage)", async () => {
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: tmpRoot });
        const tool = registered.find((r) => r.name === "get_context_remaining")!;
        // No ctx.getContextUsage function — the tool must not throw.
        const result = await tool.def.execute("call-2", {}, undefined, undefined, {});
        expect(result.details).toBeDefined();
        expect(result.details.tokensUsed).toBe(0);
        expect(result.details.maxTokens).toBe(200_000);
        expect(result.details.remainingTokens).toBe(200_000);
        expect(result.details.remainingPercent).toBe(100);
    });
});

// ---------------------------------------------------------------------------
// 2. view_image — magic-byte detection + path jail
// ---------------------------------------------------------------------------

describe("detectImageMediaType (magic bytes)", () => {
    test.each([
        ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
        ["jpeg", [0xff, 0xd8, 0xff, 0xe0], "image/jpeg"],
        ["gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], "image/gif"],
        ["webp", [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], "image/webp"],
    ])("detects %s magic bytes", (_name: string, bytes: number[], expected: string) => {
        const arr = new Uint8Array(bytes);
        expect(detectImageMediaType(arr)).toBe(expected);
    });

    test("returns null for a non-image file (text content)", () => {
        const text = new TextEncoder().encode("hello world — not an image");
        expect(detectImageMediaType(text)).toBeNull();
    });
    test("returns null for empty bytes", () => {
        expect(detectImageMediaType(new Uint8Array(0))).toBeNull();
    });
});

describe("jailImagePath (project root + /tmp)", () => {
    // resolve() on BOTH sides: jailImagePath resolves through node:path, so
    // on win32 "/proj/image.png" resolves to "\proj\image.png" — the
    // expectations must be computed with the impl's own semantics instead
    // of hardcoded POSIX strings.
    test("accepts a path inside the project root", () => {
        const r = jailImagePath("/proj", "/proj/image.png");
        expect(r.ok).toBe(true);
        expect(r.resolved).toBe(resolve("/proj/image.png"));
    });
    test("accepts a path inside the system tmp dir", () => {
        const r = jailImagePath("/proj", "/tmp/image.png", "/tmp");
        expect(r.ok).toBe(true);
        expect(r.resolved).toBe(resolve("/tmp/image.png"));
    });
    test("rejects a relative path", () => {
        const r = jailImagePath("/proj", "image.png");
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("absolute");
    });
    test("rejects an empty path", () => {
        const r = jailImagePath("/proj", "");
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("empty");
    });
    test("rejects a path that escapes the project root via ..", () => {
        const r = jailImagePath("/proj", "/proj/../../../etc/passwd");
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("escapes");
    });
    test("rejects an absolute path outside both roots", () => {
        const r = jailImagePath("/proj", "/etc/passwd", "/tmp");
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("escapes");
    });
});

// ---------------------------------------------------------------------------
// 3. view_image — readImageFile end-to-end
// ---------------------------------------------------------------------------

/** Write a tiny valid PNG (1x1 transparent) using the standard 8-byte
 * signature + the minimal IHDR + IDAT + IEND chunks. Pure byte sequence —
 * no image library needed. */
function writeTinyPng(path: string): void {
    // PNG signature + IHDR (13 bytes body) + IDAT (10 bytes body) + IEND (0 body)
    // CRC32 values are precomputed for these exact bytes.
    const bytes = [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, // IHDR length
        0x49, 0x48, 0x44, 0x52, // "IHDR"
        0x00, 0x00, 0x00, 0x01, // width 1
        0x00, 0x00, 0x00, 0x01, // height 1
        0x08, 0x06, 0x00, 0x00, 0x00, // bit depth 8, color type 6 (RGBA)
        0x1f, 0x15, 0xc4, 0x89, // CRC32 of IHDR
        0x00, 0x00, 0x00, 0x0a, // IDAT length
        0x49, 0x44, 0x41, 0x54, // "IDAT"
        0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, // compressed data
        0x0d, 0x0a, 0x2d, 0xb4, // CRC32 of IDAT
        0x00, 0x00, 0x00, 0x00, // IEND length
        0x49, 0x45, 0x4e, 0x44, // "IEND"
        0xae, 0x42, 0x60, 0x82, // CRC32 of IEND
    ];
    writeFileSync(path, Buffer.from(bytes));
}

describe("readImageFile (end-to-end)", () => {
    test("reads a PNG file and returns a base64 data URL", () => {
        const dir = mkdtempSync(join(tmpRoot, "png-"));
        const pngPath = join(dir, "tiny.png");
        writeTinyPng(pngPath);
        const result = readImageFile(dir, pngPath);
        expect(result.mediaType).toBe("image/png");
        expect(result.dataUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
        expect(result.bytes).toBeGreaterThan(8); // includes the signature + chunks
    });

    test("rejects a non-image file (text) with a clear error", () => {
        const dir = mkdtempSync(join(tmpRoot, "txt-"));
        const txtPath = join(dir, "not-an-image.txt");
        writeFileSync(txtPath, "this is just text, not an image");
        expect(() => readImageFile(dir, txtPath)).toThrow(/not a recognized image/);
    });

    test("rejects a file larger than 4 MB", () => {
        const dir = mkdtempSync(join(tmpRoot, "big-"));
        const bigPath = join(dir, "big.png");
        // Build a file that has a valid PNG signature but exceeds 4 MB.
        const bigBytes = Buffer.alloc(VIEW_IMAGE_MAX_BYTES + 1024);
        bigBytes[0] = 0x89;
        bigBytes[1] = 0x50;
        bigBytes[2] = 0x4e;
        bigBytes[3] = 0x47;
        bigBytes[4] = 0x0d;
        bigBytes[5] = 0x0a;
        bigBytes[6] = 0x1a;
        bigBytes[7] = 0x0a;
        writeFileSync(bigPath, bigBytes);
        expect(() => readImageFile(dir, bigPath)).toThrow(/exceeds the .* byte .* MB\) cap/);
    });

    test("rejects a path that escapes the project root (jailImagePath)", () => {
        const dir = mkdtempSync(join(tmpRoot, "jail-"));
        // /etc/passwd is outside both the project root and /tmp — refused.
        expect(() => readImageFile(dir, "/etc/passwd")).toThrow(/escapes the project root/);
    });

    test("accepts JPEG, GIF, WebP", () => {
        const dir = mkdtempSync(join(tmpRoot, "formats-"));
        // JPEG: \xff\xd8\xff + body
        const jpegPath = join(dir, "tiny.jpg");
        writeFileSync(jpegPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));
        const jpeg = readImageFile(dir, jpegPath);
        expect(jpeg.mediaType).toBe("image/jpeg");
        expect(jpeg.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
        // GIF: "GIF8"
        const gifPath = join(dir, "tiny.gif");
        writeFileSync(gifPath, Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]));
        const gif = readImageFile(dir, gifPath);
        expect(gif.mediaType).toBe("image/gif");
        expect(gif.dataUrl.startsWith("data:image/gif;base64,")).toBe(true);
        // WebP: "RIFF....WEBP"
        const webpPath = join(dir, "tiny.webp");
        writeFileSync(
            webpPath,
            Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00]),
        );
        const webp = readImageFile(dir, webpPath);
        expect(webp.mediaType).toBe("image/webp");
        expect(webp.dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
    });

    test("accepts a path inside the system tmp dir", () => {
        const dir = mkdtempSync(join(tmpdir(), "unown-tmp-image-"));
        const pngPath = join(dir, "tiny.png");
        writeTinyPng(pngPath);
        // The project root is /tmp — and the file is in /tmp/.../tiny.png.
        // readImageFile should accept it because it's inside the system tmp.
        const result = readImageFile(join(tmpRoot, "proj-X"), pngPath);
        expect(result.mediaType).toBe("image/png");
        expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    });
});

// ---------------------------------------------------------------------------
// 4. Tool registration — both tools via pi.registerTool
// ---------------------------------------------------------------------------

describe("registerContextTools / createContextToolsExtension", () => {
    test("registers get_context_remaining + view_image with the mock pi", () => {
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = {
            registerTool: (def: any) => registered.push({ name: def.name, def }),
        };
        registerContextTools(fakePi, { cwd: tmpRoot });
        expect(registered.map((r) => r.name).sort()).toEqual(["get_context_remaining", "view_image"]);
        const ctx = registered.find((r) => r.name === "get_context_remaining")!;
        expect(ctx.def.parameters).toBeDefined();
        expect(ctx.def.description).toContain("context window");
        const img = registered.find((r) => r.name === "view_image")!;
        expect(img.def.parameters).toBeDefined();
        expect(img.def.description).toContain("base64 data URL");
    });

    test("createContextToolsExtension registers via factory", () => {
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = {
            registerTool: (def: any) => registered.push({ name: def.name, def }),
        };
        const ext = createContextToolsExtension({ cwd: tmpRoot });
        ext.factory(fakePi);
        expect(registered.map((r) => r.name).sort()).toEqual(["get_context_remaining", "view_image"]);
    });
});

// ---------------------------------------------------------------------------
// 5. view_image execute() — returns Anthropic vision format
// ---------------------------------------------------------------------------

describe("view_image tool execute()", () => {
    test("returns an Anthropic-vision image content block (base64 source)", async () => {
        const dir = mkdtempSync(join(tmpRoot, "exec-"));
        const pngPath = join(dir, "tiny.png");
        writeTinyPng(pngPath);
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: dir });
        const tool = registered.find((r) => r.name === "view_image")!;
        const result = await tool.def.execute("call-img", { path: pngPath });
        expect(result.content).toHaveLength(1);
        const block = result.content[0];
        expect(block.type).toBe("image");
        expect(block.source.type).toBe("base64");
        expect(block.source.media_type).toBe("image/png");
        expect(typeof block.source.data).toBe("string");
        // base64 string is non-empty and decodes back to the PNG signature.
        expect(block.source.data.length).toBeGreaterThan(0);
        const decoded = Buffer.from(block.source.data, "base64");
        expect(decoded[0]).toBe(0x89);
        expect(decoded[1]).toBe(0x50);
        expect(decoded[2]).toBe(0x4e);
        expect(decoded[3]).toBe(0x47);
    });

    test("non-image path returns isError: true with a clear message", async () => {
        const dir = mkdtempSync(join(tmpRoot, "exec-err-"));
        const txtPath = join(dir, "not-an-image.txt");
        writeFileSync(txtPath, "plain text");
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: dir });
        const tool = registered.find((r) => r.name === "view_image")!;
        const result = await tool.def.execute("call-err", { path: txtPath });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("view_image failed");
        expect(result.content[0].text).toContain("not a recognized image");
    });

    test("path outside the jail returns isError: true", async () => {
        const dir = mkdtempSync(join(tmpRoot, "exec-jail-"));
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: dir });
        const tool = registered.find((r) => r.name === "view_image")!;
        const result = await tool.def.execute("call-jail", { path: "/etc/passwd" });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("escapes");
    });

    test("missing file returns isError: true with a clear message", async () => {
        const dir = mkdtempSync(join(tmpRoot, "exec-missing-"));
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: dir });
        const tool = registered.find((r) => r.name === "view_image")!;
        const result = await tool.def.execute("call-missing", { path: join(dir, "does-not-exist.png") });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("view_image failed");
        // either "cannot stat" or "ENOENT" — both acceptable; just confirm
        // the missing path shows up in the error message.
        expect(result.content[0].text).toMatch(/does-not-exist\.png|ENOENT|cannot stat/);
    });

    test("file larger than 4 MB returns isError: true", async () => {
        const dir = mkdtempSync(join(tmpRoot, "exec-big-"));
        const bigPath = join(dir, "big.png");
        // Valid PNG signature followed by > 4 MB of padding.
        const bigBytes = Buffer.alloc(VIEW_IMAGE_MAX_BYTES + 1024);
        bigBytes[0] = 0x89;
        bigBytes[1] = 0x50;
        bigBytes[2] = 0x4e;
        bigBytes[3] = 0x47;
        bigBytes[4] = 0x0d;
        bigBytes[5] = 0x0a;
        bigBytes[6] = 0x1a;
        bigBytes[7] = 0x0a;
        writeFileSync(bigPath, bigBytes);
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: dir });
        const tool = registered.find((r) => r.name === "view_image")!;
        const result = await tool.def.execute("call-big", { path: bigPath });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("exceeds");
    });

    test("JPEG execute() returns the correct MIME type", async () => {
        const dir = mkdtempSync(join(tmpRoot, "exec-jpeg-"));
        const jpegPath = join(dir, "tiny.jpg");
        writeFileSync(jpegPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: dir });
        const tool = registered.find((r) => r.name === "view_image")!;
        const result = await tool.def.execute("call-jpeg", { path: jpegPath });
        expect(result.isError).toBeUndefined();
        const block = result.content[0];
        expect(block.type).toBe("image");
        expect(block.source.media_type).toBe("image/jpeg");
    });
});

// ---------------------------------------------------------------------------
// 6. Milestone-2.4 task-spec API — validateImageMagic, encodeImageAsDataUrl,
//    estimateTokensUsed, resolveMaxTokens (PI_MAX_TOKENS env override)
// ---------------------------------------------------------------------------

describe("validateImageMagic (spec API)", () => {
    test("returns 'image/png' for valid PNG magic bytes", () => {
        expect(validateImageMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    });
    test("returns 'image/jpeg' for valid JPEG magic bytes", () => {
        expect(validateImageMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    });
    test("returns 'image/gif' for valid GIF magic bytes", () => {
        expect(validateImageMagic(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    });
    test("returns 'image/webp' for valid WebP magic bytes", () => {
        expect(validateImageMagic(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    });
    test("returns null for text content", () => {
        expect(validateImageMagic(new TextEncoder().encode("hello, world"))).toBeNull();
    });
    test("returns null for empty bytes", () => {
        expect(validateImageMagic(new Uint8Array(0))).toBeNull();
    });
    test("is an alias of detectImageMediaType", () => {
        expect(validateImageMagic).toBe(detectImageMediaType);
    });
});

describe("encodeImageAsDataUrl (spec API)", () => {
    test("returns the correct `data:<mime>;base64,<b64>` format for PNG", () => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const url = encodeImageAsDataUrl(bytes, "image/png");
        expect(url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
        // base64 payload decodes back to the exact bytes.
        const b64 = url.slice(url.indexOf(",") + 1);
        const decoded = Buffer.from(b64, "base64");
        expect(Array.from(decoded)).toEqual(Array.from(bytes));
    });
    test("handles each MIME type", () => {
        for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"] as const) {
            const bytes = new Uint8Array([1, 2, 3, 4]);
            const url = encodeImageAsDataUrl(bytes, mime);
            expect(url.startsWith(`data:${mime};base64,`)).toBe(true);
        }
    });
});

describe("estimateTokensUsed (spec API)", () => {
    test("returns 0 for empty messages", () => {
        expect(estimateTokensUsed([])).toBe(0);
        expect(estimateTokensUsed(null)).toBe(0);
        expect(estimateTokensUsed(undefined)).toBe(0);
    });
    test("returns ~chars/4 for plain-text messages", () => {
        // 40 chars / 4 = 10 tokens
        const messages = [{ role: "user", content: "1234567890123456789012345678901234567890" }];
        expect(estimateTokensUsed(messages)).toBe(10);
    });
    test("handles messages with mixed content (text + tool calls)", () => {
        const messages = [
            {
                role: "user",
                content: [{ type: "text", text: "Please run the build." }], // 21 chars
            },
            {
                role: "assistant",
                content: [
                    { type: "text", text: "Running build now." }, // 18 chars
                    { type: "tool_use", id: "t1", name: "bash", input: { command: "npm run build" } }, // 26 chars JSON
                ],
            },
            {
                role: "tool_result",
                toolUseId: "t1",
                content: [{ type: "text", text: "Build succeeded in 4.2s." }], // 24 chars
            },
        ];
        // Total chars: 21 + 18 + 26 + 24 = 89 → ceil(89/4) = 23 tokens.
        expect(estimateTokensUsed(messages)).toBe(23);
    });
    test("handles malformed messages gracefully (no throw)", () => {
        // Circularity would normally break JSON.stringify — the walker
        // catches that path and never throws.
        const obj: any = { role: "user", content: "hi" };
        obj.self = obj;
        expect(() => estimateTokensUsed([obj, undefined, 42, "string", null, { weird: Symbol("x") }])).not.toThrow();
        // Returns a non-negative number even on hostile input.
        expect(estimateTokensUsed([obj])).toBeGreaterThanOrEqual(0);
    });
    test("accepts pi session-entry shape ({ type: 'message', message: {...} })", () => {
        const entries = [
            { type: "message", message: { role: "user", content: "hello world!" } }, // 12 chars
            { type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi there" }] } }, // 8 chars
        ];
        // 20 chars / 4 = 5 tokens
        expect(estimateTokensUsed(entries)).toBe(5);
    });
});

describe("resolveMaxTokens (PI_MAX_TOKENS env override)", () => {
    const prev = process.env.PI_MAX_TOKENS;
    afterAll(() => {
        if (prev === undefined) delete process.env.PI_MAX_TOKENS;
        else process.env.PI_MAX_TOKENS = prev;
    });
    test("defaults to 200000 when no env var and no reported window", () => {
        delete process.env.PI_MAX_TOKENS;
        expect(resolveMaxTokens(undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
        expect(DEFAULT_CONTEXT_WINDOW).toBe(200_000);
    });
    test("respects PI_MAX_TOKENS env var override", () => {
        process.env.PI_MAX_TOKENS = "128000";
        expect(resolveMaxTokens(200_000)).toBe(128_000);
    });
    test("ignores an invalid PI_MAX_TOKENS (non-numeric, zero, negative)", () => {
        for (const v of ["not-a-number", "0", "-100", "NaN", "  ", ""]) {
            process.env.PI_MAX_TOKENS = v;
            expect(resolveMaxTokens(undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
        }
    });
    test("prefers env over the reported contextWindow", () => {
        process.env.PI_MAX_TOKENS = "50000";
        expect(resolveMaxTokens(200_000)).toBe(50_000);
    });
    test("uses the reported contextWindow when env is unset", () => {
        delete process.env.PI_MAX_TOKENS;
        expect(resolveMaxTokens(8192)).toBe(8192);
    });
});

describe("get_context_remaining tool — PI_MAX_TOKENS env var override", () => {
    const prev = process.env.PI_MAX_TOKENS;
    afterAll(() => {
        if (prev === undefined) delete process.env.PI_MAX_TOKENS;
        else process.env.PI_MAX_TOKENS = prev;
    });
    test("execute() returns maxTokens from PI_MAX_TOKENS", async () => {
        process.env.PI_MAX_TOKENS = "100000";
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: tmpRoot });
        const tool = registered.find((r) => r.name === "get_context_remaining")!;
        const ctx = { getContextUsage: () => ({ tokens: 0, contextWindow: 200_000, percent: 0 }) };
        const result = await tool.def.execute("call-env", {}, undefined, undefined, ctx);
        // The env override (100000) beats ctx.contextWindow (200000).
        expect(result.details.maxTokens).toBe(100_000);
        expect(result.details.tokensUsed).toBe(0);
        expect(result.details.remainingTokens).toBe(100_000);
        expect(result.details.remainingPercent).toBe(100);
    });
    test("execute() falls back to chars/4 estimate from session history when no usage", async () => {
        delete process.env.PI_MAX_TOKENS;
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: tmpRoot });
        const tool = registered.find((r) => r.name === "get_context_remaining")!;
        // 40 chars of history -> 10 tokens
        const branch = [{ role: "user", content: "1234567890123456789012345678901234567890" }];
        const ctx = {
            // No getContextUsage -> falls back to estimateTokensUsed(branch).
            sessionManager: { getBranch: () => branch },
        };
        const result = await tool.def.execute("call-fb", {}, undefined, undefined, ctx);
        expect(result.details.tokensUsed).toBe(10);
        expect(result.details.maxTokens).toBe(200_000);
        expect(result.details.remainingTokens).toBe(199_990);
    });
    test("execute() returns the 4 documented fields", async () => {
        const registered: Array<{ name: string; def: any }> = [];
        const fakePi: any = { registerTool: (def: any) => registered.push({ name: def.name, def }) };
        registerContextTools(fakePi, { cwd: tmpRoot });
        const tool = registered.find((r) => r.name === "get_context_remaining")!;
        const ctx = { getContextUsage: () => ({ tokens: 50_000, contextWindow: 200_000, percent: 25 }) };
        const result = await tool.def.execute("call-fields", {}, undefined, undefined, ctx);
        expect(Object.keys(result.details).sort()).toEqual(
            ["maxTokens", "remainingPercent", "remainingTokens", "tokensUsed"].sort(),
        );
    });
});

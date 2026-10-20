#!/usr/bin/env bun
/**
 * check_theme.mjs — validates the unown brand theme against pi's theme
 * schema contract: name present (no "/"), all 51 required color tokens
 * present, every value a hex color / integer / var reference / "" — and
 * every var reference resolves.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UNOWN_THEME } from "../pi-repo/packages/self-learning/src/theme.ts";

const REPO = join(import.meta.dir, "..");
const SCHEMA = JSON.parse(
        readFileSync(join(REPO, "pi-repo/packages/coding-agent/src/modes/interactive/theme/theme-schema.json"), "utf8"),
);

let failures = 0;
const fail = (msg) => {
        console.error(`✗ ${msg}`);
        failures++;
};

// name
if (typeof UNOWN_THEME.name !== "string" || !UNOWN_THEME.name || UNOWN_THEME.name.includes("/"))
        fail(`bad name: ${UNOWN_THEME.name}`);

// required colors
const required = SCHEMA.properties.colors.required ?? [];
// Optional-but-defined tokens (e.g. scrollbarTrack/scrollbarThumb, which fall
// back to borderMuted/muted when omitted) are legal: present ⊆ properties,
// required ⊆ present. Flagging "not in required" as unknown broke the day the
// schema gained its first optional color.
const properties = Object.keys(SCHEMA.properties.colors.properties ?? {});
const present = Object.keys(UNOWN_THEME.colors ?? {});
for (const token of required) if (!(token in (UNOWN_THEME.colors ?? {}))) fail(`missing color token: ${token}`);
for (const token of present) if (!properties.includes(token)) fail(`unknown color token: ${token}`);

// value validity + var resolution
const vars = Object.keys(UNOWN_THEME.vars ?? {});
const valueOk = (v) =>
        typeof v === "number" || v === "" || /^#[0-9a-fA-F]{6}$/.test(v) || vars.includes(v);
for (const [token, value] of Object.entries(UNOWN_THEME.colors ?? {})) {
        if (!valueOk(value)) fail(`color ${token}: invalid value ${JSON.stringify(value)} (not hex/int/var/"")`);
}
for (const [v, value] of Object.entries(UNOWN_THEME.vars ?? {})) {
        if (typeof value !== "number" && !/^#[0-9a-fA-F]{6}$/.test(String(value))) fail(`var ${v}: invalid value ${value}`);
}

if (failures === 0) {
        console.log(
                `✓ theme "${UNOWN_THEME.name}": ${present.length}/${required.length} color tokens, ${vars.length} vars — schema-conformant`,
        );
        process.exit(0);
}
process.exit(1);

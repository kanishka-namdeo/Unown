// Ambient shim: loads bun-types (a devDependency) so `import … from "bun:test"`
// resolves under `tsc --noEmit`. The canonical loader package is @types/bun,
// which auto-loads via the @types mechanism — this repo pins bun-types directly
// (no @types/bun dependency), so reference it here instead. Strictly additive:
// keeps tsconfig's default @types auto-inclusion untouched.
/// <reference types="bun-types" />

---
name: pin-settings-defaults
description: Use when adding or changing declared settings defaults in the registry to prevent phantom drift on fresh installs. Ensures each default is a provenance-verified contract against the real vendored resolver and is pinned in a subprocess test.
---

# Pin Settings Defaults Against Resolver

## When
When declaring, fixing, or auditing settings defaults (e.g., in the `pi` registry) that feed a `/settings diff` report. Prevents 'phantom drift' where 8+ interface items falsely report as modified on a pristine install.

## Steps
1. **Identify the Real Resolver:** Locate the vendored settings-manager getter for each interface item. Do *not* derive defaults from UI selector row-states or component-local values; those are display states, not source-of-truth.
2. **Verify the Contract:** For each declared default, assert that `resolver.get(item)` returns the exact declared value on a pristine (out-of-the-box) environment. If they mismatch, the declared default is a bug.
3. **Fix & Document:** Update the declared default to match the resolver's output. Add a `// provenance: <getter-name>` comment to every defaulted field to record which resolver value it was aligned with.
4. **Pin in a Subprocess Test:** Create `test/settings-defaults-drift.test.ts` that iterates all defaulted items and asserts `get(item) === declared_default`. 
   - **Critical:** Run this test in a *subprocess* (e.g., `execSync('bun test ...')`). Do not run it in-process. Why: some settings getters resolve through `term.ts`'s module-scope `UNOWN_HOME` snapshot; in-process runs read earlier tests' environment leftovers, masking true drift.
5. **Add BM-8 Guard:** In the bisect-registry guard, add a 'pristine home' check: run `/settings diff` on a fresh home dir. The diff must report `No settings differ`. Any non-zero drift rows is a hard fail.
6. **Handle No-Op Probes:** If a test/probe sets a setting to its *current* value, it will produce zero detectable drift. Construct test targets as `current_value + offset`. Add a load-time validation that flags any task whose `diskCheck.expect` equals the item's declared default as `diff-inert` (honest no-op, not a failure).

## Verification
- `test/settings-defaults-drift.test.ts` passes in subprocess
- BM-8 pristine-home guard reports 0 drift rows
- All defaulted fields carry provenance comments

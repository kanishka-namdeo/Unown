# Update process and update-available nudges — research and decisions

> Research record, 2026-10-21; decision amended 2026-10-22. **Verdict:** move the binary update check from a scalar `version.txt` to a per-OS `release.json` manifest; keep `version.txt` for installers and older clients; nudge with a once-per-24h startup line plus a persistent TUI footer chip; add local skip/snooze; and do **not** auto-download or auto-apply. The manifest is **unsigned**: it pins each platform asset's name, size and SHA-256, and the updater verifies those before activation, but there is no release signing key (see [the 2026-10-22 amendment](#decision-update-2026-10-22-unsigned-manifest)). The next release must also repair the live feed, whose published `v0.0.1` predates the 12-asset release workflow and currently 404s its `version.txt` and `install.sh`.

- [Decision update 2026-10-22](#decision-update-2026-10-22-unsigned-manifest)
- [Method](#method)
- [What the field does](#what-the-field-does)
- [Options considered](#options-considered)
- [Selected design](#selected-design)
- [Evidence](#evidence)
- [Reproduction appendix](#reproduction-appendix)
- [Open questions](#open-questions)
- [Related pages](#related-pages)
- [Sources](#sources)

## Decision update 2026-10-22: unsigned manifest

The 2026-10-21 design selected a detached Ed25519 signature over `release.json`, with the public key pinned in the client and the private seed held as a GitHub Actions secret. On 2026-10-22 the project owner chose to drop the signing key. This section supersedes the signed parts of that record; everything else — the manifest, per-OS applicability, the nudge surfaces, skip/snooze, and notify-not-auto-apply — stands.

**What changes.** `release.json` is still the schema-1 manifest with `version`, `releasedAt`, `channel`, `severity`, optional minimum versions, `notesUrl` and `assets[{platform,name,sha256,size}]`. There is no `keyId`, no `release.json.sig`, no pinned key map, no `scripts/release-keys/`, and no signing secret. The release payload drops from 14 assets to 13 and checksum coverage from 13 to 12; the feed gate now downloads every platform archive and verifies its exact size and SHA-256 instead of verifying a signature.

**Why.** A signing key is a custody problem: a seed that must be backed up, rotated without bricking old clients, and protected as the single most valuable secret in the release path. Its benefit is narrower than it first appears. The client trusts the release host or a mirror for the manifest either way; a signature only closes the case where that host or mirror is compromised *and* cannot also replace the archive bytes. Every archive is already fetched over TLS and checked against the manifest's exact size and SHA-256, so corruption and accidental manifest/archive mismatch fail closed. For this project's threat model and install base, the owner judged the key's operational risk and rotation burden higher than that residual gain.

**What the unsigned design still checks.** Manifest schema and field validation, a per-OS asset that must be named exactly `archiveName(platform)`, positive sizes within a bound, 64-hex SHA-256 digests, no duplicate platforms or names, version monotonicity, the platform gate, exact downloaded byte size, SHA-256 against both the manifest and `sha256sums.txt`, and `unown --version` before activation. What it does **not** check is who produced the manifest: a compromised release account, host or configured mirror can serve a different manifest and matching archive. Build-provenance attestations and `sha256sums.txt` on the release page remain the independent verification path for a suspicious release. If the project later needs authenticity beyond TLS, the signed design in this record is the tested starting point — but that decision needs its own key-custody plan.

## Method

Three evidence classes, used throughout:

- **[V] verified** — measured in this checkout or against the live GitHub release feed on 2026-10-21, or read at the cited source line.
- **[C] vendor-claimed** — documented by the vendor/tool (README, docs, changelog) and not independently re-derived here.
- **[U] unknown** — needs a spike or a platform-specific measurement; recorded rather than guessed.

The code audit covered `update.ts`, `bin-update.ts`, `install-layout.ts`, `cli.ts`, `tools.ts`, `info.ts`, `scripts/build-artifacts.ts` and `.github/workflows/release.yml`. The external survey is listed under [Sources](#sources); the substantive claims below carry a tier.

## What the field does

### Check cadence

The convergent default is **24 hours**, with a cache and a non-blocking refresh:

- npm's `update-notifier` defaults to a one-day interval, defers the message until process exit, and skips CI/non-TTY runs [C].
- Homebrew moved automatic `brew update` to every 24 hours in 4.0.0, with `HOMEBREW_AUTO_UPDATE_SECS` and `HOMEBREW_NO_AUTO_UPDATE` as the knobs [C].
- Sparkle's appcast checks default to once every 24 hours [C].
- VS Code performs background update checks and exposes `default`/`start`/`manual`/`none` modes [C].

Unown already used a 24-hour cache, but only to throttle the refresh: the notice itself printed on **every** TTY start for as long as the cache said a newer version existed [V: `update.ts` prior to this change]. The new display rules add a per-version/per-day cap.

### Where to nudge

- **Startup banner.** Codex CLI is reported to show an `Update available!` banner with an `Update now` / `Skip` menu [C: issue #2806 and user reports]. Claude Code auto-updates in the background and exposes `claude update` for an immediate install [C: setup docs].
- **Deferred box.** `update-notifier` prints after the process exits, which suits short commands but not a long-lived TUI [C].
- **Persistent status line.** The repo already uses pi's footer status channel for `plan-mode`, `lsp`, `mcp`, `goal`, `engine`, `review` and `advisor` [V: `tools.ts`]. It is the natural low-noise surface for a long session.
- **Modal prompts** (a blocking Update now/Later/Skip dialog) are the strongest nudge and the highest-fatigue one; the notification-design literature recommends slower defaults, severity tiers and snooze options [C].

### Auto-update, channels and forced floors

- Claude Code auto-updates by default (`DISABLE_AUTOUPDATER` opts out) and publishes `latest`/`stable` channels; its settings include `minimumVersion` and `requiredMinimumVersion` [C: setup + settings-reference docs].
- Codex prompts rather than silently switching the running binary [C].
- Gemini CLI documents stable/preview/nightly channels; a third-party guide's "built-in update command" claim was **not** confirmed in the official command reference [U].
- Native macOS/Windows updaters download in the background and install on restart (Sparkle, Tauri), typically with a signed manifest [C: Sparkle/Tauri docs].

### Signed manifests and integrity

- Sparkle uses an RSS appcast plus EdDSA signatures [C].
- Tauri's updater requires a manifest with a signature and per-platform URLs [C].
- rustup verifies signatures on update artifacts [C].
- Unown's release workflow already produces build-provenance attestations for archives and installers [V: `release.yml`], but the binary updater trusted TLS + a same-origin `sha256sums.txt` and could not tell whether a given OS/arch had an archive until the download failed [V: prior `update.ts:835-879`, `bin-update.ts:129-149`].

### Rollout and deltas

- Staged rollouts (Chrome/Play/Microsoft) need a stable client bucket and adoption metrics; Unown has no telemetry and a small install base [C + design constraint].
- Deno 2.8 introduced binary deltas between recent versions [C]; Unown's archives are ~90 MiB, but a full verified archive is the safe baseline for now.
- Both are deferred; the manifest schema leaves room for a `rollout` field without committing to it.

## Options considered

| Area | Option | Pros | Cons | Decision |
|---|---|---|---|---|
| Cadence | Every TTY start (current) | Impossible to miss | Repeats for days; users learn to ignore it | Rejected |
| Cadence | Once per new version, then daily | One clear first sighting + a quiet reminder | Slightly more state | **Selected** |
| Cadence | Weekly | Very low noise | Security fixes can wait too long | Rejected |
| Surface | Startup line only | Cheap; matches CLIs | Disappears into scrollback in a long session | Rejected alone |
| Surface | Deferred box after exit | Good for `npm`-style commands | Wrong for a TUI; no session context | Rejected |
| Surface | Blocking modal on startup | Strongest consent | Interrupts every start; fatigue | Rejected |
| Surface | Startup line + TUI footer chip | One prominent line, one persistent low-noise chip; no interruption | Requires a small poller in the extension | **Selected** |
| Surface | Dashboard badge/action | Visible in mission control | Duplicates the chip; another surface to keep consistent | Rejected |
| Surface | `/update` slash command | In-session action | Cannot hot-swap the running process; a second apply path to test | Rejected |
| Auto-update | Notify + one-click `unown update` | User controls timing and bandwidth; no mid-session surprise | One manual step | **Selected** |
| Auto-update | Background download, apply on next launch | Native-updater convenience | 90 MiB without consent; more failure modes while the user works | Rejected |
| Auto-update | Startup prompt | Consent before download | Blocks startup; modal fatigue | Rejected |
| Feed | Scalar `version.txt` only | No release changes | Cannot answer "is there a build for my OS/arch?"; no size/severity/date | Rejected |
| Feed | Unsigned `release.json` | Per-OS metadata, one request, no key custody | Trust still TLS + host/mirror | **Selected 2026-10-22** |
| Feed | Signed `release.json` + detached `.sig` | Per-OS metadata + authenticity beyond TLS; key rotation possible | Two new assets + key custody/rotation | Superseded 2026-10-22 |
| Signing | No signature | Simplest; archive size/SHA-256 still verified | A compromised release account/host can forge an update | **Selected 2026-10-22** |
| Signing | Pinned Ed25519 key | Simple, offline-verifiable, no client dependency | Key loss/rotation needs care; seed custody | Superseded 2026-10-22 |
| Signing | Sigstore/Fulcio verification in the client | Strong identity binding | Needs a cosign-equivalent in a compiled binary; heavier | Rejected for v1 |
| Checkout nudges | Full binary treatment | Consistent | Interrupts active development; a checkout rebuild is not a drop-in swap | Rejected |
| Checkout nudges | Quiet once per version, clean `main` only | Surfaces releases without nagging | Feature branches see nothing (doctor still reports) | **Selected** |
| Checkout nudges | No proactive nudge | Zero noise | Releases go unnoticed | Rejected |
| Rollout | Percentage manifest field | Smaller blast radius | No telemetry/bucketing; premature for the install base | Deferred |
| Deltas | Patch archives | Lower bandwidth | Another format and verification path | Deferred |

## Selected design

- **Manifest:** `release.json` schema 1 with `version`, `releasedAt`, `channel: stable`, `severity`, optional minimum versions, `notesUrl`, and a per-platform asset array (`platform`, `name`, `sha256`, `size`). It is unsigned (2026-10-22): no `keyId`, no detached signature, no pinned key.
- **Check:** parse and validate the manifest strictly; select the platform asset; report `applicable: false` for a platform gate or missing asset (exit 0), `available` only for a newer applicable release (exit 2), and fail closed on a malformed manifest. A manifest **404/410** is the only legacy fallback (`version.txt` + `sha256sums.txt`); a manifest that is present but invalid never falls back.
- **Trust:** the manifest comes from the release host over HTTPS or from a user-configured mirror. The updater verifies each archive's exact size and SHA-256 against the manifest and requires `sha256sums.txt` to agree before activation; it cannot detect a host or mirror that serves a different manifest with a matching archive. Build-provenance attestations remain available for independent verification.
- **Cache/prefs:** `update-check.json` schema 2 is disposable (24 h TTL, per-OS result, checkout branch/dirty/ahead state); `update-prefs.json` holds skip/snooze/notice history and survives cache deletion. Both use atomic writes; single-flight locks stop concurrent checks/applies.
- **Nudges:** startup stderr line once per version then at most daily (12 h for security), plus a `update: vX.Y.Z` footer chip in binary TUI sessions; checkout gets a quiet clean-`main` line only. Print mode never prints. `NO_UPDATE_NOTIFIER`, `UNOWN_DISABLE_AUTOUPDATE`, `DO_NOT_TRACK` and `UNOWN_DISABLE_UPDATES` suppress the line, the chip and the background check (manual updates still work).
- **Apply:** re-fetch the **pinned** manifest for the target and verify it again; require the manifest size/hash and the same-release `sha256sums.txt`; keep the previous version for `--rollback`; clear macOS quarantine; retain the checkout's ff-only/autostash/auto-rollback guards. No auto-download, no auto-apply.

## Evidence

| Claim | Tier | Evidence |
|---|---|---|
| The live `v0.0.1` release has 9 assets, not 12 | [V] | `gh release view v0.0.1 --json assets` on 2026-10-21 listed the six archives, `release-checklist.md`, `sbom-spdx.json`, `sha256sums.txt` |
| `version.txt` and `install.sh` 404 on the latest release | [V] | `curl -sSL -o /dev/null -w '%{http_code}' .../latest/download/version.txt` → 404; same for `install.sh` |
| The v0.0.1 tag predates the 12-asset workflow | [V] | `git log --oneline v0.0.1..HEAD -- .github/workflows/release.yml` shows the 12-asset commit after the tag |
| The release CDN exposes `ETag`/`Last-Modified` but `Cache-Control: no-cache` | [V] | `curl -sSL -D - -o /dev/null .../sha256sums.txt` showed `ETag: "0x…"`, `Last-Modified`, `Cache-Control: no-cache` |
| Binary `--check` never ran the platform gate or checked the per-OS asset | [V] | Prior `update.ts:835-879` called `checkLatestVersion` only; `bin-update.ts:129-149` parsed `version.txt` only |
| The startup notice had no display cap and print mode printed it | [V] | Prior `update.ts:1051-1065`; call sites at `cli.ts:1864` (print) and `:2007` (TUI) |
| `update-notifier` uses a 1-day interval and defers until exit | [C] | npm/GitHub README |
| Homebrew auto-updates every 24 h | [C] | brew.sh 4.0.0, FAQ |
| Sparkle checks every 24 h and uses EdDSA | [C] | Sparkle documentation |
| Claude Code auto-updates, `DISABLE_AUTOUPDATER`, `minimumVersion`/`requiredMinimumVersion`, channels | [C] | Claude Code setup + settings-reference docs |
| Codex shows an update banner with Update now/Skip | [C] | openai/codex issue #2806 and user reports |
| Gemini's official command reference does not document a self-update command | [U] | The commands page lists `/about`/`/upgrade`; a third-party guide's claim was not confirmed |
| Windows MOTW on Node-fetched archives, macOS quarantine on a Node download | [U] | Not measured here; the updater clears macOS quarantine best-effort and does not add `Unblock-File` until measured |
| GitHub preserves `If-None-Match` across its signed asset redirect | [U] | Not relied on; the 24 h cache is the throttle |

## Reproduction appendix

```bash
# 1. The broken live feed (2026-10-21)
gh release view v0.0.1 --json assets --jq '[.assets[].name]'
curl -sSL -o /dev/null -w '%{http_code}\n' \
  https://github.com/kanishka-namdeo/Unown/releases/latest/download/version.txt
curl -sSL -o /dev/null -w '%{http_code}\n' \
  https://github.com/kanishka-namdeo/Unown/releases/latest/download/install.sh

# 2. Why: the tag predates the payload workflow
git log --oneline v0.0.1..HEAD -- .github/workflows/release.yml

# 3. The CDN response shape used for the caching decision
curl -sSL -D - -o /dev/null \
  https://github.com/kanishka-namdeo/Unown/releases/latest/download/sha256sums.txt \
  | grep -iE '^(HTTP/|etag|last-modified|cache-control|content-length)'

# 4. The new gates (hermetic; no network)
cd pi-repo/packages/self-learning
bun test test/release-manifest.test.ts test/update-status.test.ts \
  test/bin-update.test.ts test/update.test.ts test/tools-update-chip.test.ts
cd ../..
node --test scripts/release-manifest.test.mjs
bun scripts/release-manifest.ts --check --require-all --out release-assets
bun scripts/release-manifest.ts --feed "$UNOWN_RELEASES_BASE_URL"
```

## Open questions

- **Unsigned-feed threat model.** The manifest is trusted from the release host or configured mirror. If a stronger authenticity guarantee becomes a requirement, the signed design higher in this record is the tested path, but it needs a custody/rotation plan first (where the seed lives, how old clients learn a new key, how a lost key is handled).
- **Windows MOTW.** Node's `fetch` does not obviously set Mark-of-the-Web on the archive; if the release matrix shows SmartScreen still blocking an updated binary, add a best-effort `Unblock-File` in `downloadAndStage`.
- **`If-None-Match` across the GitHub asset redirect.** The CDN returns an ETag, but the redirected asset URL changes per request; conditional requests are a later optimization, not part of this design.
- **Staged rollout.** A manifest `rollout` field is cheap to add but needs a stable bucket and an adoption signal; no telemetry exists to justify it yet.

## Related pages

- [updating](updating.md) — the user contract implemented by this decision record
- [install](install.md) — the 13-asset payload and the unsigned manifest
- [configuration](configuration.md) — state files, env vars and opt-outs
- [resilience](resilience.md) — engine failure modes (the update path shares the no-telemetry / fail-closed posture)
- [testing-strategy](testing-strategy.md) — the suite and gate conventions used here
- [landing research](landing-research.md) — the page's sourcing rules

## Sources

- npm [update-notifier](https://github.com/yeoman/update-notifier) — 1-day interval, deferred notice, TTY/CI gating, `NO_UPDATE_NOTIFIER`.
- Claude Code [setup](https://code.claude.com/docs/en/setup) and [settings reference](https://code.claude.com/docs/en/settings-reference) — background auto-update, `DISABLE_AUTOUPDATER`, `claude update`, channels, `minimumVersion`/`requiredMinimumVersion`.
- OpenAI Codex [issue #2806](https://github.com/openai/codex/issues/2806) — update announcement request; user reports of the Update now/Skip prompt.
- Gemini CLI [release channels](https://geminicli.com/docs/changelogs/) and [command reference](https://geminicli.com/docs/reference/commands/) — stable/preview/nightly; no confirmed self-update command.
- Homebrew [4.0.0](https://brew.sh/2023/02/16/homebrew-4.0.0/) and [FAQ](https://docs.brew.sh/FAQ) — 24 h auto-update, `HOMEBREW_AUTO_UPDATE_SECS`, `HOMEBREW_NO_AUTO_UPDATE`.
- [Sparkle documentation](https://sparkle-project.org/documentation/) — 24 h appcast checks, EdDSA signatures, automatic download/manual install.
- [Tauri updater](https://tauri.app/plugin/updater/) — signed manifest, endpoint variables, check/download/install.
- [Terraform CLI commands](https://developer.hashicorp.com/terraform/cli/commands) — Checkpoint update/security-bulletin check, anonymous ID, `CHECKPOINT_DISABLE`.
- [VS Code enterprise updates](https://code.visualstudio.com/docs/enterprise/updates) — automatic background updates and update modes.
- [Deno upgrade](https://docs.deno.com/runtime/reference/cli/upgrade/) — manual upgrade path and the 2.8 binary-delta note.
- [rustup basics](https://rust-lang.github.io/rustup/basics.html) — `rustup check`, `rustup self update`, auto self-update and signature verification.
- [GitHub REST API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) — conditional request/304 semantics.
- [Smashing Magazine notification UX](https://www.smashingmagazine.com/2025/07/design-guidelines-better-notifications-ux/) — slower default frequency, severity levels, snooze.

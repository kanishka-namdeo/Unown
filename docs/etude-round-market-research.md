# The Etude round market research

> **Verdict up front:** the E-0 gate passes — approve Tempo with the five
> amendments below. The exact niche (keyboard-first + offline-first +
> no-account + time-tracking + invoicing, in one installable PWA) is
> verifiably unoccupied, every axis has citable demand evidence, and the
> SaaS incumbents are structurally unable to follow without cannibalizing
> the cloud per-seat revenue the niche removes. The counter-signals (weak
> willingness-to-pay; two zero-traction precedents) bound the expectations —
> a portfolio and adoption play, not a near-term revenue play.

One-line purpose: the E-0 approval gate's market-research base for the
[Tempo PRD](etude-prd.md) — the freelancer time-tracking and invoicing
landscape, the desktop-PWA platform truth, the invoice legal floor, and the
differentiation verdict, every load-bearing claim source-tagged.

**Mini-TOC**

- [1. Market landscape](#1-market-landscape)
- [2. PWA viability on desktop](#2-pwa-viability-on-desktop)
- [3. Invoicing must-haves](#3-invoicing-must-haves)
- [4. Differentiation check](#4-differentiation-check)
- [Verdict](#verdict)
- [PRD amendments](#prd-amendments)
- [Appendix](#appendix--sources-opened-this-session)

**Scope:** PRD approval gate for Tempo — keyboard-first, offline-first time-tracking + lightweight invoicing PWA (vanilla TS, zero deps, localStorage, service worker, no accounts/backend/telemetry, sequential per-client invoice numbers, integer-cents math, DST/midnight-rollover handling, canonical-JSON export; Chromium-desktop-only v1; lives at `apps/tempo/` beside Coda and Ostinato).

**Method & access constraints (read this before the citations).** All claims below cite only sources actually opened during this research session (raw fetches archived under the research workspace). General-purpose search engines were not usable from this environment (Google served a JS/CAPTCHA shell; Bing/DuckDuckGo egress was blocked or returned poisoned results), and Reddit (www, old, and JSON API), Product Hunt, Fiverr, and Invoice Ninja's pricing page (Cloudflare/PerimeterX) refused automated access. The research therefore relied on: (1) direct navigation to primary sources (vendor pricing/feature/support pages, MDN, web.dev, WebKit, gov.uk, emta.ee, Stripe), (2) full-text search of Hacker News via the Algolia API (including reading individual threads), and (3) GitHub repo pages/READMEs for star counts and feature claims. Reddit-specific sentiment is marked [U]. Tags: **[V]** = verified against an opened source; **[C]** = credible claim, not independently verified this session; **[U]** = unverifiable from this environment.

---

## 1. Market landscape

### 1.1 The incumbents

| Product | Pricing [V] | Offline | Keyboard-first | Invoicing depth |
|---|---|---|---|---|
| **Toggl Track** | Free $0; Starter $9/user/mo annual ($12 monthly); Premium $16 annual ($24 monthly); Enterprise custom | Desktop apps work offline, store locally, sync on reconnect | Partial: `@project`/`#tag` in the description field, Cmd+D manual mode, customizable global show/hide hotkey | **None native** — exports billable time to CSV/PDF "as a basis for your invoices"; invoicing via integrations |
| **Clockify** | Free $0 (up to 5 users, no invoicing); Basic $3.99; Standard $5.49; Pro $7.99; Enterprise $11.99 (per seat/mo, annual billing; monthly prices $4.99/$6.99/$9.99/$14.99) | Desktop apps track offline, save locally, sync later; "Force offline" mode; **unsynced entries are lost on logout** | No first-class keyboard mode found on any opened page | Full invoicing (items, totals, discounts & tax, import of billable hours, recurring invoices, PDF, payment statuses) — **gated behind Standard ($5.49+/seat/mo)** |
| **Harvest** | Free (1 seat, 2 projects); Pro $9/seat/mo annual ($11 monthly); usage-based tier $14/$17.50 | Cloud-based; no offline mode documented on any opened page | No | Invoicing + payments on **all** plans incl. Free: auto-invoice from tracked time & expenses, Stripe/PayPal, QuickBooks/Xero export |
| **Wave** | Starter $0 (unlimited invoices/estimates/bills; online payments 2.9% + $0.60); Pro $19/mo | Cloud/account-based | No | Unlimited invoicing even on free tier; the paid upsell is bookkeeping/payments, not invoicing |
| **Zoho Invoice** | **Free** for small businesses/freelancers | Cloud/account-based ("offline" on their site means recording offline payments, not offline use) | No | Full invoicing, free, incl. recurring invoices and templates |
| **Invoice Ninja** | Current tiers unverifiable (Cloudflare-blocked) [U]; self-hosted is free/open-source, all hosted Pro/Enterprise features included, **$30/year white-label license** | Self-hosted = your own server; not a no-backend app | No | Deep invoicing (it is an invoicing product); the OSS repo states all hosted features ship in the open-source code |
| **Fiverr Workspace** (ex-AND.CO) | Rebranded 2021; **current availability unverifiable** (Fiverr blocks all automated access) [U] | — | — | Was free invoicing/proposals/time-tracking for freelancers |

Sources: [toggl.com/pricing](https://toggl.com/pricing/), [toggl.com/features/time-tracking-invoicing](https://toggl.com/features/time-tracking-invoicing), [Toggl Windows app support article](https://support.toggl.com/en-us/article/toggl-track-desktop-app-for-windows-5w1y5/), [Toggl macOS app support article](https://support.toggl.com/en-us/article/toggl-track-desktop-app-for-macos-1669b8x/), [clockify.me/pricing](https://clockify.me/pricing), [Clockify Windows app help](https://clockify.me/help/apps/windows-desktop-app), [clockify.me/features/invoicing](https://clockify.me/features/invoicing), [getharvest.com/pricing](https://www.getharvest.com/pricing), [getharvest.com/features](https://www.getharvest.com/features), [waveapps.com/pricing](https://www.waveapps.com/pricing/), [zoho.com/invoice/pricing](https://www.zoho.com/invoice/pricing/), [zoho.com/invoice/features](https://www.zoho.com/invoice/features/), [Invoice Ninja README](https://github.com/invoiceninja/invoiceninja), [Wikipedia: Fiverr](https://en.wikipedia.org/wiki/Fiverr).

**Correction to the tasking premise:** "Watomatic" is **not** a time tracker — it is an Android auto-reply app for messaging apps (README title: "Atomatic – Auto reply for Messaging apps so you can stop using it"; 557 stars) [V: [github.com/adeekshith/watomatic](https://github.com/adeekshith/watomatic)]. It should be dropped from the competitive set.

### 1.2 The open-source / offline-first trackers

- **SuperProductivity** — 23,427 stars [V: [repo](https://github.com/johannesjo/super-productivity)]. Self-described "A to-do list, time tracker and daily planner for focused personal work. **Private, offline-first and open source**." Documents a keyboard-shortcuts wiki; optional E2E-encrypted sync (self-hostable). **No invoicing.**
- **ActivityWatch** — 19,516 stars [V: [repo](https://github.com/ActivityWatch/activitywatch)]. "The best free and open-source automated time tracker… privacy-focused," stores data on the user's local machine. **No invoicing; not a PWA (Electron); not keyboard-first (it's automatic tracking).**
- **solidtime** — 9,110 stars [V: [repo](https://github.com/solidtime-io/solidtime)]. "Modern open-source time-tracking app" for freelancers/agencies; self-host (server) or cloud with account. **No invoicing; server-backed.**
- **Kimai** — 5,137 stars [V: [repo](https://github.com/kimai/kimai)]. Professional multi-user web time-tracking, self-hosted PHP/DB, paid plugin marketplace. Server-backed, not offline-first, not keyboard-first.
- **TimeTagger** — 1,813 stars [V: [repo](https://github.com/almarklein/timetagger)]. Open-source, aimed at individuals and freelancers; runs as a local Python server (or Docker); sync between devices; PDF/CSV reporting. **No invoicing; not a static no-backend PWA.** Its 2021 HN launch drew **199 points / 116 comments** [V: [thread](https://news.ycombinator.com/item?id=25762715)], and the most upvoted feedback in the thread was about *input speed*: "What I really care about is the time it takes to input tasks… Is there a faster way to start/stop the timer?" — to which the author replied "perhaps a keyboard shortcut to start a timer?" and another user asked for "keyboard control over the forms" [V].
- **timewarrior** — 1,666 stars; CLI time tracking/reporting [V: [repo](https://github.com/GothenburgBitFactory/timewarrior)]. Keyboard-only by nature, but terminal-only, no invoicing, no PWA.

### 1.3 The open-source invoicing side

The top open-source invoicing projects on GitHub are all **server-based self-hosted apps**: Akaunting, idurar, Dolibarr, InvoicePlane, frappe/books, Ever Gauzy (8,703 stars, ERP), Crater (8,361 stars, invoicing for individuals/businesses), Invio (1,200 stars, "self-hosted invoicing without the bloat"), DRYTRIX/TimeTracker (638 stars, self-hosted tracking+invoicing) [V: [github.com/topics/invoicing](https://github.com/topics/invoicing), plus the individual repos]. The one notable **offline-first** exception is:

- **Upcount** — 401 stars [V: [repo](https://github.com/namespace-ee/upcount)]. "A painless cross-platform invoicing application, built with React & Electron… **Offline-first for privacy**," free and open source. **No time tracking; not keyboard-first; Electron, not PWA; v2 still in planning.**

### 1.4 Real gaps — and evidence of demand

**Gap analysis [V, from the table above]:**
1. **No major commercial tracker does no-account/offline-first.** Toggl/Clockify offline support exists *in their desktop apps* as a sync feature (Clockify even **destroys unsynced entries on logout**); the products are account- and cloud-centric. Harvest, Wave, Zoho are cloud-only.
2. **Invoicing is either gated or bolted on.** Toggl (the most freelancer-popular tracker) creates **no invoices at all** — export/integration only. Clockify gates invoicing at $5.49/seat/mo. The free-and-unlimited invoicing products (Wave, Zoho Invoice) are account-based clouds with no time tracking.
3. **Nobody is keyboard-first.** Toggl has shortcuts; HN commenters explicitly asked TimeTagger's author for keyboard input speed. No product in the set markets keyboard-first operation.

**Demand evidence [V unless noted]:**
- The **local-first movement** has large, durable audiences: the Ink & Switch "Local-first software" essay threads drew 748 pts/239 comments (2019) and 883 pts/297 comments (2025 repost) [V: [21581444](https://news.ycombinator.com/item?id=21581444), [44473135](https://news.ycombinator.com/item?id=44473135)]; "Offline-First Apps: Why Should Apps Be Made to Work in an Offline State?" drew 121 pts/105 comments [V: [32544837](https://news.ycombinator.com/item?id=32544837)].
- **Local-first, no-signup trackers get warm receptions**: TimeRetain ("runs 100% in your browser. No sign up… Time data now never leaves your browser") — 61 pts, Feb 2025; its author ported it *off* a backend after "becoming interested in local-first" [V: [43077519](https://news.ycombinator.com/item?id=43077519)]. Star counts above (19.5k–23.4k for ActivityWatch/SuperProductivity) are the strongest quantitative signal.
- **Freelancers resent invoicing bloat and payment-fee capture**: in "Ask HN: An invoicing platform specifically for Freelancers" (Jan 2025), a long-time freelancer: "I never had enough clients… to need anything more complicated than a spreadsheet"; another: "I only need a PDF invoice… a few fields (xxx hours @ xx/hour)"; a FreshBooks user closing their account over overkill features [V: [42607269](https://news.ycombinator.com/item?id=42607269)]. A solo dev earning a living from a paid open-source invoicing app (open3A, 734 pts/462 comments, ~$9k/mo per the linked IndieHackers page) shows a paying niche exists for *simple, self-controlled* invoicing, with the commenter caveat that "invoices have different legal requirements everywhere" [V: [26423002](https://news.ycombinator.com/item?id=26423002)].
- **Counter-signal (important):** the same threads show many freelancers **will not pay** for this category ("I would not pay for such a product"; "spreadsheet suffices") [V: 42607269]. And the two closest prior attempts at Tempo's *exact* pitch got essentially zero traction: "Trackey – a local-first, keyboard-first, no-login time and task tracker" (2 pts, abandoned prototype, source lost) [V: [43108343](https://news.ycombinator.com/item?id=43108343)] and a macOS "local-first (no account), works offline, SQLite… generate simple PDF invoices" app (1 pt, Jan 2026) [V: [46695558](https://news.ycombinator.com/item?id=46695558)].
- **Reddit (r/freelance, r/webdev) could not be accessed from this environment** — no citation available [U]. HN + GitHub + Product-adjacent signals are the basis here; Product Hunt was also blocked [U].

---

## 2. PWA viability on desktop

- **Chrome and Edge on desktop:** when a page meets install criteria, an install icon appears in the URL bar; accepting installs the PWA, which then behaves like an installed application (own window, OS integration) [V: [MDN — Installing and uninstalling web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing)]. Install criteria (manifest + service worker making the app work offline) and the address-bar install affordance are documented at [web.dev install criteria](https://web.dev/articles/install-criteria) [V].
- **Safari on macOS:** "Before macOS 14 (Sonoma), PWAs could be installed on macOS from any browser except Safari. … PWAs can be installed on macOS 14.0 or later and iOS/iPadOS 16.4 or later from any supporting browser" [V: MDN, same page]. So desktop install support is **not** Chromium-exclusive — Safari has supported it since Sonoma.
- **Firefox desktop:** "requires a PWA extension" [V: MDN, same page].
- **iOS / the 2024 EU saga — current status:** In Feb 2024, iOS 17.4 betas removed Home Screen web apps in the EU; Apple confirmed it was DMA-driven, citing "the very low user adoption of Home Screen web apps" and the engineering cost of alternative-browser-engine isolation [V: [9to5Mac, Feb 15 2024](https://9to5mac.com/2024/02/15/ios-17-4-web-apps-european-union/); HN: 104 pts [39299007](https://news.ycombinator.com/item?id=39299007)]. On **March 1, 2024 Apple reversed**: Home Screen web apps remain available in the EU, but must stay WebKit-based ("For support, the Progressive Web Apps will still need to be built on WebKit, with all that entails" — quoted in the 775-pt/462-comment reversal thread) [V: [HN 39563618](https://news.ycombinator.com/item?id=39563618)]. Since then, iOS install support continues per MDN's current guidance (iOS/iPadOS 16.4+ from any supporting browser) [V: MDN]. Apple's track record here (remove → reverse within 3 weeks) is itself a platform-risk data point for any PWA-first roadmap [C].
- **localStorage vs IndexedDB for local-first apps:** localStorage is "synchronous and will block the main thread… limited to about 5MB and can contain only strings… not accessible from web workers or service workers"; web.dev's general recommendation for app data is IndexedDB, with the Cache Storage API for app resources [V: [web.dev — Storage for the web](https://web.dev/articles/storage-for-the-web)]. localStorage data has "no expiration time" and persists across sessions (but is cleared when the last incognito tab closes) [V: [MDN — localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)]. Under storage pressure, browsers **evict best-effort storage including Cache API and IndexedDB**; `navigator.storage.persist()` marks storage persistent ("kept by the browser, even if storage is running low… only deleted if the user chooses to remove it") [V: [web.dev — Persistent storage](https://web.dev/articles/persistent-storage)]. Practical read: a single-document JSON state in localStorage is durable in practice for a desktop Chromium profile, but the ~5MB string cap is a hard architectural ceiling, and the platform-blessed durable path for larger data is IndexedDB (+ persistence request).
- **Service-worker precache verification best practice:** Workbox precaching uses a manifest of `{url, revision}` entries; revision changes drive cache updates, and integrity of the precached set is what precache manifests exist to guarantee [V: [Workbox precaching docs](https://developer.chrome.com/docs/workbox/modules/workbox-precaching/)]. The repo already operationalizes this pattern in both siblings (`apps/coda/scripts/verify-precache.ts`, `apps/ostinato/scripts/verify-precache.ts` — the Ostinato lane adds CACHE_NAME validation, duplicate-entry and missing-file failure modes) [V: repo files].
- **Is "Chromium-desktop-only" honest?** Yes with caveats: install support on desktop exists in Chrome/Edge (URL-bar install), Safari (macOS 14+), and via extension in Firefox [V: MDN] — so the restriction is a **QA/support scope choice, not a technical boundary**. It is honest *if stated as "we support and test Chrome/Edge desktop in v1"* rather than implied as "PWAs only work in Chromium." The main genuine PWA platform risk lives on iOS (Apple's demonstrated willingness to remove Home Screen web apps in a market) [V/C above], which v1 sidesteps entirely.

---

## 3. Invoicing must-haves

**EU (mandatory invoice contents).** An EU member-state tax authority (Estonia) enumerates the required invoice contents — a direct national implementation of the VAT Directive's Article 226 (which itself I could not open directly from this environment — EUR-Lex bot-challenges — so Directive wording is [C] with the Estonian page as the verifiable implementation):
> "The following shall be set out in an invoice: **the serial number and date of issue of the invoice**; the name and address of the taxable person and the person's registration number as a taxable person; the name and address of the acquirer of goods or the recipient of services…; the name or a description of the goods or services; the quantity of the goods or extent of the services; the date of dispatch… if… it differs from the date of issue…; the price of the goods or services exclusive of value added tax and any discounts…; the taxable amount broken down by different rates of value added tax together with the applicable rates…; the amount of value added tax payable…"
Invoices must be preserved **7 years** in original (electronic) form [V: [Estonian Tax and Customs Board — Information included on invoices](https://www.emta.ee/en/business-client/taxes-and-payment/value-added-tax/vat-accounting-and-invoices/information-included-invoices)].

- The Directive's Article 226(15) phrasing — "a sequential number, based on one or more series, which uniquely identifies each invoice" — is the canonical requirement [C, widely quoted; the Estonian "serial number" line is the opened verification]. The "one or more series" wording is what legally blesses **per-client sequential series** (Tempo's design) [C].
- **UK:** invoices must include the VAT registration number and display VAT separately [V: [gov.uk — Charge, reclaim and record VAT](https://www.gov.uk/vat-record-keeping/vat-invoices)]. Post-Brexit UK retained the same invoice-content regime [C].
- **US:** no federal statute mandates invoice format or sequential numbering; standard practice is a unique invoice number, invoice date, itemized services (qty × rate), subtotal, taxes, and payment terms [V: [Stripe — Invoice requirements](https://stripe.com/en-us/resources/more/invoice-requirements)].

**What lightweight invoicing apps typically get wrong** (analysis, grounded in the requirements above and the surveyed products):
1. **Numbering gaps and non-monotonic numbers** — editing/deleting drafts reuses or skips numbers; EU practice wants an unbroken, auditable series [V-requirement / C-practice].
2. **One global series only** — freelancers invoicing multiple clients under one global counter leak client A's volume to client B; the "one or more series" allowance is under-used [C].
3. **Missing VAT scaffolding** — no per-line rate, no VAT IDs, no reverse-charge/negative-liability note for EU B2B cross-border services [V-requirement list].
4. **Supply-date vs issue-date confusion** — required when they differ [V: Estonian list].
5. **Float money math** — rounding drift on totals/VAT splits (the PRD's integer-cents stance is the correct mitigation) [V-requirement of exact per-rate taxable amounts].
6. **No credit notes / no immutability** — corrections require linked credit notes, not edits; and 7-year retention demands an exportable, byte-stable archive (the PRD's canonical-JSON export is the right primitive) [V-retention].
7. **Trust-destruction features** — forced payment rails taking ~2.9%+ fees as the price of "free" (Wave's model), which the HN freelancer thread shows breeds resentment [V: Wave pricing page; HN 42607269].

---

## 4. Differentiation check

**Does anyone deliver keyboard-first + offline-first + no-account + invoicing in one? No [V — survey of every opened source below].**

Closest competitors to Tempo's exact niche:
1. **Upcount** (offline-first invoicing, no account, free OSS) — closest on the invoicing side; Electron, **no time tracking, no keyboard-first**, v2 stalled [V: repo].
2. **SuperProductivity** (offline-first, private, keyboard-documented, no login for local use) — closest on the tracking side; **no invoicing**; Electron/web app rather than installable no-backend PWA; 23.4k stars proves the audience [V: repo].
3. **Trackey / the macOS trytimetracker.com app** — the only two products found pitching (nearly) Tempo's exact combination (local/keyboard/no-login + invoices in the macOS case); both ~zero traction (2 pts / 1 pt on HN; the former is literally an abandoned prototype) [V: threads 43108343, 46695558].
4. **Clockify** — the only mainstream tracker with real invoicing, but cloud/account-based, invoicing paywalled at $5.49+/seat/mo, offline only as a desktop-app sync mode with data-loss-on-logout semantics [V: pricing + help pages].
5. **Self-hosted combos** (Kimai + Invoice Ninja, Crater, DRYTRIX/TimeTracker, InvoicePlane…) — full features but demand a server and ops; that's a different buyer than "no account, install, done" [V: repos/topics].

**Verdict on the wedge: real but small.** The four-axis combination is verifiably unoccupied, each individual axis has demonstrated demand (local-first tracking: 19.5k–23.4k-star projects; no-signup web trackers: positive HN receptions; keyboard speed: explicit top-thread feedback on TimeTagger's launch; anti-bloat invoicing: recurring freelancer complaints), and the SaaS incumbents are structurally unable to go no-account/offline-first without cannibalizing their cloud per-seat revenue (Clockify even monetizes invoicing specifically). However: the two prior direct attempts at this exact pitch died unnoticed, the loudest freelancer voices say "a spreadsheet suffices," and the category's demonstrated willingness-to-pay is weak. This is a wedge for **adoption and portfolio coherence, not for near-term revenue** — which, for a zero-backend, zero-maintenance PWA shipped inside an existing PWA suite (Coda, Ostinato), is a rational cost/benefit position.

---

## Verdict

**Yes, with bounded expectations — approve the E-0 gate, subject to the amendments below.**

- The exact niche (keyboard-first + offline-first + no-account + tracking + invoicing, zero backend, installable PWA) is **unoccupied** [V §4].
- Every axis has independent, citable demand evidence [V §1.4], and the incumbents' pricing/architecture leave the gap structurally open [V §1.1].
- The technical scope choices are sound and precedented inside the repo (Ostinato's atomic-write localStorage adapter; Coda's IndexedDB seam; shared verify-precache lanes) [V: repo files].
- The honest risks: (1) weak willingness-to-pay in this segment; (2) localStorage's ~5MB ceiling for a data type (invoice history + exports) that grows forever; (3) "Chromium-only" is a support policy, not a platform fact — it must be worded honestly; (4) prior near-identical attempts gained no traction, so distribution (the existing suite's audience) — not features — will be the binding constraint.

## PRD amendments

1. **Reword the platform scope as a support policy, not a capability claim.** State: "v1 is tested and supported on Chrome and Edge desktop; Safari (macOS 14+) and Firefox (with extension) also support PWA install but are unsupported in v1" [V: MDN]. Ban Chromium-only web APIs unless feature-detected with a graceful path, so the Safari door stays open. Add an explicit "unsupported browser" screen rather than silent breakage. This keeps "Chromium-desktop-only" honest without marketing a falsehood.
2. **Add a storage budget and a migration seam to the localStorage decision.** Keep localStorage for v1 (Ostinato's atomic temp-key/commit-key adapter is the proven in-repo pattern [V: `apps/ostinato/src/storage/local-storage.ts`]), but the PRD should (a) fix a byte budget with headroom under the ~5MB cap [V: web.dev], (b) require `QuotaExceededError` handling with user-facing remediation [V: web.dev], (c) define the IndexedDB migration seam up front as Coda did [V: `apps/coda/src/db/idb.ts`], and (d) make "export early, export often" a first-class product behavior (canonical-JSON export already planned) — because web.dev's platform guidance for local-first app data is IndexedDB, and invoice history is unbounded while localStorage is not [V].
3. **Pin the invoice-numbering invariants to the legal requirements.** Per-client series, strictly monotonic, no gaps, no reuse, no user-editable numbers after issue; issue date mandatory, optional supply date when different; per-line VAT rate, VAT-ID fields for both parties, reverse-charge toggle; corrections only via linked credit notes; immutable issued-invoice snapshot embedded in the canonical-JSON export (7-year retention rationale) [V: Estonian/EU list; C: Directive Art. 226(15) "one or more series"]. Include a short jurisdiction checklist doc (EU/UK/US) as a v1 deliverable — it is also the marketing differentiator vs. "lightweight" competitors who get these wrong (§3).
4. **Define "keyboard-first" as a testable contract, since it is the actual wedge.** Concretely: start/stop/switch timers, create/edit entries, generate and export an invoice — all completable without touching the mouse; a command palette; a visible shortcut sheet. This converts an adjective into an acceptance-testable PRD requirement and is directly responsive to documented demand (TimeTagger launch feedback; Trackey's positioning) [V: threads 25762715, 43108343].
5. **Set success metrics for a portfolio play, not a SaaS funnel.** Given the counter-signals on willingness-to-pay [V: HN 42607269] and the zero-traction precedents [V: 43108343, 46695558], target suite-level outcomes (installs, 30-day retention of the installed PWA, export-usage as the "real usage" proxy — no telemetry means export/button events only, locally counted) and treat paid-tier ideas (e.g., a future white-label license à la Invoice Ninja's $30/yr [V: README]) as out-of-scope for v1. Also drop Watomatic from the PRD's competitive set — it is not a time tracker [V].

---

## Appendix — sources opened this session

Vendor: toggl.com (pricing; /features/time-tracking-invoicing), support.toggl.com (Windows + macOS desktop articles), clockify.me (pricing; /features/invoicing; /help/apps/windows-desktop-app), getharvest.com (pricing; features), waveapps.com (pricing), zoho.com/invoice (pricing; features), stripe.com (invoice-requirements resource).
Open source: github.com repos + raw READMEs — almarklein/timetagger, johannesjo/super-productivity, kimai/kimai, adeekshith/watomatic, ActivityWatch/activitywatch, solidtime-io/solidtime, crater-invoice/crater, namespace-ee/upcount, kittendevv/Invio, DRYTRIX/TimeTracker, ever-co/ever-gauzy, GothenburgBitFactory/timewarrior, invoiceninja/invoiceninja; github.com/topics/time-tracking and /topics/invoicing listings.
HN (via Algolia API, ~25 searches; threads read in full or part): 25762715 (TimeTagger), 43077519 (TimeRetain), 43108343 (Trackey), 46695558 (macOS Time Tracker), 26423002 (open3A), 42607269 (freelancer invoicing Ask HN), 21581444/44473135 (local-first software), 32544837 (offline-first apps), 39299007/39386244/39563618 (Apple PWA EU removal + reversal), 7434995 (Invoice Ninja launch), 8432305/21037982/4396737/13104204/49942264/46086086 (time-tracking+invoicing Show HNs).
Platform/docs: developer.mozilla.org (Installing and uninstalling web apps; Window/localStorage; Web Storage API), web.dev (storage-for-the-web; persistent-storage; install-criteria), developer.chrome.com (Workbox precaching), webkit.org (tracking-prevention policy), 9to5mac.com (iOS 17.4 EU web apps), appleinsider.com (blocked — Cloudflare, not cited).
Legal/tax: emta.ee (Information included on invoices; VAT accounting and invoices), gov.uk (Charge, reclaim and record VAT).
Not accessible (excluded from citations): reddit.com / old.reddit.com (blocked), producthunt.com (Cloudflare), fiverr.com/workspace + workspace.fiverr.com (PerimeterX), invoiceninja.com/pricing (Cloudflare), eur-lex.europa.eu (bot challenge), taxation-customs.ec.europa.eu VAT-invoicing page (moved/404), web.archive.org (timeout), general web-search engines (blocked/poisoned egress).

## Related pages

- [The Tempo PRD](etude-prd.md) — the PRD the amendments landed in
- [The Etude round log](etude-round-session.md) — the E-0 decision record
- [The Etude benchmark round](../benchmarks/etude-round/README.md) — the baseline suite + calibration canaries
- [The Ostinato PRD](ostinato-prd.md) — the house pattern Tempo follows

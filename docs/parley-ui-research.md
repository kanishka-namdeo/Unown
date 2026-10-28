# Parley UI-phase research — how 2025-26 support inboxes actually look

> The UI phase's grounding research (2026-10-29, the operator's lane):
> what Zendesk Agent Workspace, Intercom Inbox, Front, Help Scout and
> Freshdesk converge on for agent workspaces, SLA rendering, list anatomy,
> admin surfaces, demo/role-switch patterns, composers and accessibility —
> and the blueprint Parley's UI adopts from it. Companion to the round's
> competitor research ([parley-round-competitor-research.md](parley-round-competitor-research.md)).

## Method

General search engines were unreliable from the sandbox (Bing off-topic,
DuckDuckGo CAPTCHA), so the research ran 25+ targeted queries against
vendor help-center search APIs and sitemaps (Zendesk, Front, Freshdesk,
Intercom, Help Scout) plus direct fetches of MDN and the WAI-ARIA APG.
Every finding below comes from a page actually read.

## Findings

### 1. Agent workspace layouts — three-pane is the consensus

Every major tool converges on **nav/sidebar + conversation list + thread,
with a right context panel**:

- **Zendesk Agent Workspace**: ticket tabs on top; customer context and
  apps in a right-side context panel; composer at the bottom ("natural
  conversation flow"); ticket actions in an options menu on the header.
- **Front (2025-26 redesign)**: icon nav rail + sidebar with
  Open/Later/Done sections; compact header expandable to tags/custom
  fields; the filter icon renders removable filter chips ABOVE the list.
- **Intercom**: ⌘K command palette; optional table layout with
  configurable columns; lists designed so "every action is immediate —
  no spinners".
- **Help Scout**: toolbar row (snooze, tag, workflow, more) above an
  editable subject; right sidebar of draggable cards (Details: Status,
  Assigned to, SLA, Topic), resizable/collapsible.

Keyboard flows: Front ↑/↓ between conversations, `R` reply, `E` archive;
Intercom `A` assign, `P` priority, ⌘Enter send.

### 2. SLA / priority / status rendering

- **SLA structure** (Zendesk): policies = conditions + metrics +
  per-priority targets; Help Scout adds first-match ordering + FRT and
  time-to-resolution targets; Intercom allows one active SLA per
  conversation.
- **Timer rendering** (Front): a countdown in the conversation ("18h")
  flips to **negative elapsed after breach ("−1m")**, with an opt-in
  "at risk" warn state before breach; breach adds an "SLA breach" tag.
  Help Scout exposes an "SLA Target" sortable column; Intercom views
  filter by "SLA due in less than X minutes".
- **Priority scales conflict**: Intercom five levels (None/Low/Medium/
  High/Urgent); Zendesk/Freshdesk four (Low/Normal|Medium/High/Urgent).
  Sorting "priority first, newest second" is Intercom's convention.
- **Statuses conflict**: Zendesk six (New/Open/Pending/On-hold/Solved/
  Closed); Front three tabs (Open/Waiting/Resolved); Help Scout
  Active(bold)/Pending/Closed(grey) with auto-reopen on customer reply.
  Parley's API model (open/pending/resolved) matches the Front/Help Scout
  three-state shape.

### 3. List item anatomy

- **Help Scout semantics**: Active = bold, top of list; Closed = light-grey
  background; the "Waiting since" column (time since last customer
  message; internal notes don't reset it) is the default sort.
- **Front timestamps**: user-switchable relative ("3h") vs exact;
  unread/active state, assignee avatar, status chips per row.
- **Intercom**: saved views = filter sets with And/Or groups; bulk-select
  checkboxes open a bulk-edit menu.
- **NN/g layer-cake scanning**: users scan in a layer-cake pattern when
  key info visually stands out — bold requester/subject, de-emphasized
  preview; status must always be visible (visibility of system status).

### 4. Admin surfaces

- **Roles/team** (Zendesk Admin Center): roles list sortable by
  member count, edit/clone/delete from an options menu; Intercom gates
  admin features per custom role.
- **Audit log** (Zendesk): columns Time · Actor · Activity type (+ change
  details), filterable by event, CSV export; Help Scout embeds audit
  line items inside the thread timeline (Show/Hide Details).
- **Usage/quota**: metered-products pages show usage vs included quota
  per product; NN/g dashboard guidance: encode at-a-glance state with
  preattentive attributes (length/position/color).

### 5. Demo mode / role switcher / embedded showcase

- **Freshdesk "Assume identity"**: admins preview the helpdesk as another
  agent; **admins' identities can never be assumed** — a privilege
  guardrail worth copying (Parley's switcher is explicit, labeled,
  demo-only).
- **Sandbox conventions** (Storylane, Stripe): isolated environment,
  seeded fake data, "no real customer data", shareable links, resistance
  to breakage are the selling points.
- **Iframe auth mechanics** (MDN): `SameSite=Lax` cookies are not sent on
  requests inside `<iframe>`s — an embedded demo's session must be
  established through a demo lane; the app must serve
  `CSP: frame-ancestors` (which the host's next.config.ts block does)
  rather than `X-Frame-Options: DENY`.

### 6. Composer conventions

- **Public vs internal**: Zendesk/Intercom use a mode toggle inside ONE
  composer (Reply ↔ Internal note); Front uses a separate internal-comment
  field. Zendesk's public→private conversion is one-way and logged.
- **Note styling** (Help Scout): notes get a yellow background + border.
- **Canned replies/macros** (Intercom): picker via icon or typing `/` +
  name; ⌘/Ctrl+Enter sends.
- **Send-and-set-status** (Front): split button — "Send as resolved" with
  a caret menu of other statuses.

### 7. Accessibility

- **List semantics** (WAI-ARIA APG Listbox): `role="listbox"` +
  `role="option"` with `aria-selected`, ↑/↓/Home/End keys,
  `aria-activedescendant` as the sanctioned alternative to moving DOM
  focus per keystroke; DOM focus ≠ selection.
- **SLA countdowns** (MDN): `role="timer"` has implicit `aria-live="off"`
  — ticking values only announce when focus is inside the element; state
  transitions (at-risk, breach) go through a separate polite live region.

## The adopted blueprint

The three-pane workspace (top bar / left nav / list + thread + context),
the list-item anatomy (unread dot, bold requester, de-emphasized preview,
status/priority/SLA chips, assignee avatar), the SLA chip's three states
(safe countdown / amber at-risk / red breached with negative elapsed),
the composer's segmented Reply|Note toggle with amber note tint + `/`
canned picker + split send button, the admin inventory (members+seats,
invites, canned, audit table, usage quota bars), the explicit demo role
switcher (Freshdesk pattern), and the a11y contract (listbox semantics,
timer roles, polite transition announcements). Full layout tree in the
phase brief (`.unown/briefs/parley-ui.md`, the operator staging lane).

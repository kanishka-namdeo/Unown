/**
 * The /aria live-demo route (Phase 3's UI mounts here — this is a
 * placeholder div only, so the API routes mount under a valid
 * app shell). The `?embed=1` server-side read + the `aria_ses`
 * cookie probe land with the UI in Phase 3 (the F3 pin).
 */
export default function AriaPage() {
  return (
    <div
      data-aria-shell
      className="aria-root flex min-h-screen items-center justify-center"
    >
      <div className="text-center">
        <p className="text-sm">Aria — the enterprise CRM (UI arrives in Phase 3)</p>
      </div>
    </div>
  );
}

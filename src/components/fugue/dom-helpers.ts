/**
 * DOM test helpers — swap window.location.search for tests that need
 * query parameters.
 *
 * happy-dom's `history.pushState` does NOT update `window.location.search`;
 * assigning a `URL` object to `window.location` does. These helpers do that
 * assignment cleanly and restore the original URL when done.
 */
export function withSearch(search: string, fn: () => Promise<void> | void): Promise<void> {
  const w = globalThis as { window: Window & { location: Location } };
  const saved = w.window.location.href;
  const url = new URL("http://localhost:3100/");
  url.search = search;
  (w.window as unknown as Record<string, unknown>).location = url as unknown as Location;
  const result = fn();
  return Promise.resolve(result).finally(() => {
    const restore = new URL("http://localhost:3100/");
    (w.window as unknown as Record<string, unknown>).location = restore as unknown as Location;
    void saved;
  });
}

export {};

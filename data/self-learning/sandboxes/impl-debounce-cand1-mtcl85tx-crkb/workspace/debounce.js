// TODO: implement debounce.
// debounce(fn, delay, { now }) returns a debounced fn that:
//  - delays invoking fn until `delay` ms have elapsed since the last call
//  - `now` is an injectable clock: () => ms (defaults to Date.now)
//  - exposes .cancel() which prevents any pending invocation
//  - the debounced function returns undefined
export function debounce(fn, delay = 200, { now = Date.now } = {}) {
  throw new Error("not implemented");
}

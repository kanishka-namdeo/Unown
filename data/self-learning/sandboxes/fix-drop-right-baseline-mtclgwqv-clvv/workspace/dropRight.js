// Returns a new array with the last n elements removed.
export function dropRight(arr, n = 1) {
  // BUG: off-by-one — removes one element too many
  return arr.slice(0, Math.max(0, arr.length - n));
}

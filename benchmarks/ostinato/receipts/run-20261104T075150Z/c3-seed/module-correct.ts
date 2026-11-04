/** luhn.ts — the Luhn checksum. */
export function luhnValid(digits: string): boolean {
  const s = digits.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(s) || s.length < 2) return false;
  let sum = 0;
  let double = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

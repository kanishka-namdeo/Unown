/**
 * Pure validators for the checkout wizard. Each returns null when valid,
 * or a short, actionable message (WCAG 3.3.3 error suggestion) otherwise.
 */

export interface ShippingField {
  name: string;
  email: string;
  address: string;
  city: string;
  zip: string;
}

export type ShippingErrors = Partial<Record<keyof ShippingField, string>>;

export function validateShipping(field: keyof ShippingField, value: string): string | null {
  const v = value.trim();
  switch (field) {
    case "name":
      return v ? null : "Please enter the full name for the shipment.";
    case "email":
      if (!v) return "Please enter an email address.";
      // practical email check: something@something.tld
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v))
        return "That email looks incomplete — check for typos.";
      return null;
    case "address":
      return v ? null : "Please enter a street address.";
    case "city":
      return v ? null : "Please enter a city.";
    case "zip":
      if (!v) return "Please enter a ZIP code.";
      if (!/^\d{5}$/.test(v))
        return "ZIP must be exactly 5 digits, e.g. 94103.";
      return null;
  }
}

export function shippingErrors(shipping: ShippingField): ShippingErrors {
  const errors: ShippingErrors = {};
  (Object.keys(shipping) as (keyof ShippingField)[]).forEach((k) => {
    const err = validateShipping(k, shipping[k]);
    if (err) errors[k] = err;
  });
  return errors;
}

/** True when the card digits pass the Luhn checksum. Non-digits ignored. */
export function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  // Standard test vectors: Luhn-valid numbers of any length.
  // 4242424242424242 (Visa sandbox), 79927398713 (classic 11-digit example)
  if (digits === "") return false;
  let sum = 0;
  const n = digits.length;
  for (let i = 0; i < n; i++) {
    let d = Number(digits[n - 1 - i]);
    if (i % 2 === 1) { // every second digit from the right, doubled
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function validateCardNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "Please enter a card number.";
  if (digits.length !== 16)
    return "Card numbers are 16 digits — this one has " + digits.length + ".";
  if (!luhnValid(digits))
    return "This card number fails the Luhn check — retype it and double-check each digit.";
  return null;
}

/** Expiry as MM/YY. Valid when the month is 01–12 and the end-of-month is not in the past. */
export function expiryNotPast(expiry: string, now: Date = new Date()): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(expiry.trim());
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
  return endOfMonth >= now;
}

export function validateExpiry(expiry: string, now: Date = new Date()): string | null {
  if (!expiry.trim()) return "Please enter the expiry as MM/YY.";
  if (!/^\d{2}\/\d{2}$/.test(expiry.trim()))
    return "Use the MM/YY format, e.g. 08/29.";
  if (!expiryNotPast(expiry, now))
    return "This card has expired — check the printed date.";
  return null;
}

export function validateCvv(cvv: string): string | null {
  if (!cvv.trim()) return "Please enter the CVV.";
  if (!/^\d{3}$/.test(cvv.trim()))
    return "CVV is the 3 digits on the back of the card.";
  return null;
}

export interface PaymentField {
  cardNumber: string;
  expiry: string;
  cvv: string;
}

export type PaymentErrors = Partial<Record<keyof PaymentField, string>>;

export function paymentErrors(
  payment: PaymentField,
  now: Date = new Date(),
): PaymentErrors {
  const errors: PaymentErrors = {};
  const c = validateCardNumber(payment.cardNumber);
  if (c) errors.cardNumber = c;
  const e = validateExpiry(payment.expiry, now);
  if (e) errors.expiry = e;
  const v = validateCvv(payment.cvv);
  if (v) errors.cvv = v;
  return errors;
}

/** Format a raw card number into 4-digit groups while typing. */
export function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

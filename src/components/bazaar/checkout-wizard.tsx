"use client";

import { useMemo, useState } from "react";
import { useBazaar } from "@/lib/bazaar/store";
import { buildOrder, generateOrderId } from "@/lib/bazaar/orders";
import {
  paymentErrors,
  shippingErrors,
  formatCardNumber,
  type ShippingField,
  type PaymentField,
} from "@/lib/bazaar/validation";
import { cartTotals } from "@/lib/bazaar/cart";
import { money, fmt } from "./format";

/**
 * 3-step checkout wizard (brief §5).
 * Step 1 shipping → Step 2 payment (mock, Luhn-validated) → Step 3 confirm.
 * A persistent order summary sits beside the form on every step so shipping
 * and tax are never a surprise (the #1 cart-abandonment driver).
 */
export function CheckoutWizard({ onClose }: { onClose: () => void }) {
  const { state, placeOrder, setView } = useBazaar();
  const [step, setStep] = useState(1);
  const [shipping, setShipping] = useState<ShippingField>({
    name: "",
    email: "",
    address: "",
    city: "",
    zip: "",
  });
  const [payment, setPayment] = useState<PaymentField>({
    cardNumber: "",
    expiry: "",
    cvv: "",
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const [placedId, setPlacedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const shipErrs = useMemo(() => shippingErrors(shipping), [shipping]);
  const payErrs = useMemo(() => paymentErrors(payment), [payment]);

  function markTouched(k: string) {
    setTouched((t) => ({ ...t, [k]: true }));
  }

  function step1Valid() {
    const errs = shippingErrors(shipping);
    if (Object.keys(errs).length === 0) {
      setErrorSummary(null);
      return true;
    }
    setErrorSummary(Object.entries(errs).map(([k, m]) => m).join(" "));
    return false;
  }

  function step2Valid() {
    const errs = paymentErrors(payment);
    if (Object.keys(errs).length === 0) {
      setErrorSummary(null);
      return true;
    }
    setErrorSummary(Object.entries(errs).map(([k, m]) => m).join(" "));
    return false;
  }

  function submit() {
    if (step === 1) {
      if (!step1Valid()) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!step2Valid()) return;
      setPlacing(true);
      // simulate a brief network hop, then place the order locally
      setTimeout(() => {
        const id = generateOrderId();
        const order = buildOrder(state.cart, state.products, id, new Date().toISOString());
        placeOrder(order, true);
        setPlacedId(id);
        setPlacing(false);
        setStep(3);
      }, 350);
      return;
    }
    if (step === 3 && placedId) {
      // "View order history" CTA: close the wizard AND switch to the Orders view.
      setView("orders");
      onClose();
    }
  }

  const totals = cartTotals(state.cart, state.products);
  const deliveryRange = deliveryWindow();

  function deliveryWindow() {
    const from = new Date();
    from.setDate(from.getDate() + 3);
    const to = new Date();
    to.setDate(to.getDate() + 5);
    return { from: fmt(from), to: fmt(to) };
  }

  // Human-readable item list for the summary (titles, not ids) — VLM 04.2
  const summaryLines = useMemo(() => {
    return state.cart
      .map((l) => {
        const p = state.products.find((x) => x.id === l.productId);
        if (!p) return null;
        return { productId: p.id, name: p.name, quantity: l.quantity, line: p.price * l.quantity };
      })
      .filter((x): x is { productId: string; name: string; quantity: number; line: number } => x !== null);
  }, [state.cart, state.products]);

  // After an order is confirmed, the side panel reflects that order (the
  // cart has been cleared, so the live cart lines would read as empty).
  const placedOrder = placedId ? state.orders.find((o) => o.id === placedId) : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Checkout"
    >
      <button
        aria-label="Close checkout"
        onClick={onClose}
        className="fixed inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
        tabIndex={-1}
      />
      <div className="relative z-10 my-4 grid w-full max-w-4xl gap-6 rounded-2xl border border-line bg-surface p-5 shadow-2xl sm:grid-cols-[1fr_280px] animate-pop">
        {/* form column */}
        <div>
          <h2 className="text-xl font-bold">Checkout</h2>
          {/* 3-step progress with connector line — VLM 04.4 */}
          <ol className="mt-3 flex items-center gap-0 text-sm" aria-label="Checkout steps">
            {["Shipping", "Payment", "Confirm"].map((label, i) => (
              <li key={label} className={"flex items-center " + (i < 2 ? "flex-1" : "")}>
                <span className="flex items-center gap-2">
                  <span
                    aria-current={step === i + 1 ? "step" : undefined}
                    className={
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                      (step > i + 1
                        ? "bg-ok text-background"
                        : step === i + 1
                        ? "bg-accent-strong text-white"
                        : "bg-surface-2 text-muted")
                    }
                  >
                    {step > i + 1 ? "✓" : i + 1}
                  </span>
                  <span className={step >= i + 1 ? "font-medium" : "text-muted"}>{label}</span>
                </span>
                {i < 2 && (
                  <span
                    aria-hidden="true"
                    className={
                      "mx-2 h-px flex-1 " +
                      (step > i + 1 ? "bg-ok" : "bg-line")
                    }
                  />
                )}
              </li>
            ))}
          </ol>

          {/* live error summary announced to screen readers (brief §10) */}
          <div role="alert" aria-live="assertive" className="mt-3">
            {errorSummary && (
              <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
                {errorSummary}
              </div>
            )}
          </div>

          {step === 1 && (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="mt-4 space-y-3"
            >
              <h3 className="font-semibold">Shipping details</h3>
              <Field
                label="Full name"
                name="name"
                value={shipping.name}
                required
                error={touched.name ? shipErrs.name : null}
                onChange={(v) => {
                  setShipping({ ...shipping, name: v });
                  markTouched("name");
                }}
                autoComplete="name"
              />
              <Field
                label="Email"
                name="email"
                value={shipping.email}
                required
                type="email"
                error={touched.email ? shipErrs.email : null}
                onChange={(v) => {
                  setShipping({ ...shipping, email: v });
                  markTouched("email");
                }}
                autoComplete="email"
              />
              <Field
                label="Street address"
                name="address"
                value={shipping.address}
                required
                error={touched.address ? shipErrs.address : null}
                onChange={(v) => {
                  setShipping({ ...shipping, address: v });
                  markTouched("address");
                }}
                autoComplete="street-address"
              />
              {/* City wide, ZIP narrow — VLM 04.3 */}
              <div className="grid grid-cols-[2fr_1fr] gap-3">
                <Field
                  label="City"
                  name="city"
                  value={shipping.city}
                  required
                  error={touched.city ? shipErrs.city : null}
                  onChange={(v) => {
                    setShipping({ ...shipping, city: v });
                    markTouched("city");
                  }}
                  autoComplete="address-level2"
                />
                <Field
                  label="ZIP"
                  name="zip"
                  value={shipping.zip}
                  required
                  inputMode="numeric"
                  error={touched.zip ? shipErrs.zip : null}
                  onChange={(v) => {
                    setShipping({ ...shipping, zip: v });
                    markTouched("zip");
                  }}
                />
              </div>
              <WizardButtons
                onBack={onClose}
                nextLabel="Continue to payment"
                submitting={false}
                onSubmit={submit}
              />
            </form>
          )}

          {step === 2 && (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="mt-4 space-y-3"
            >
              <h3 className="font-semibold">Payment (mock)</h3>
              <p className="text-xs text-muted">
                Use the test card{" "}
                <span className="font-mono text-foreground">4242 4242 4242 4242</span>, any future
                MM/YY, and any 3-digit CVV.
              </p>
              <Field
                label="Card number"
                name="cardNumber"
                value={payment.cardNumber}
                required
                error={touched.cardNumber ? payErrs.cardNumber : null}
                onChange={(v) => {
                  setPayment({ ...payment, cardNumber: formatCardNumber(v) });
                  markTouched("cardNumber");
                }}
                inputMode="numeric"
                autoComplete="cc-number"
                placeholder="1234 5678 9012 3456"
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Expiry (MM/YY)"
                  name="expiry"
                  value={payment.expiry}
                  required
                  error={touched.expiry ? payErrs.expiry : null}
                  onChange={(v) => {
                    setPayment({ ...payment, expiry: v });
                    markTouched("expiry");
                  }}
                  autoComplete="cc-exp"
                  placeholder="08/29"
                />
                <Field
                  label="CVV"
                  name="cvv"
                  value={payment.cvv}
                  required
                  inputMode="numeric"
                  error={touched.cvv ? payErrs.cvv : null}
                  onChange={(v) => {
                    setPayment({ ...payment, cvv: v });
                    markTouched("cvv");
                  }}
                  autoComplete="cc-csc"
                  placeholder="123"
                />
              </div>
              <WizardButtons
                onBack={() => setStep(1)}
                nextLabel="Place order"
                submitting={placing}
                onSubmit={submit}
              />
            </form>
          )}

          {step === 3 && placedId && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-line bg-background/40 p-4 text-center">
                <div aria-hidden="true" className="text-3xl text-ok">
                  ✓
                </div>
                <h3 className="mt-2 text-lg font-bold">Order placed</h3>
                <p className="text-sm text-muted">Order ID</p>
                <p className="font-mono text-xl font-bold text-accent">{placedId}</p>
                <p className="mt-2 text-sm text-ok">
                  Estimated delivery {deliveryRange.from} – {deliveryRange.to}
                </p>
              </div>
              <OrderSummaryPanel orderId={placedId} />
              <WizardButtons
                onBack={null}
                nextLabel="View order history"
                submitting={false}
                onSubmit={submit}
              />
            </div>
          )}
        </div>

        {/* persistent order summary (brief §4/§5 — costs surfaced early) */}
        <aside
          aria-label="Order summary"
          className="rounded-xl border border-line bg-background/40 p-4 text-sm"
        >
          <h3 className="font-bold">Order summary</h3>
          <ul className="mt-3 space-y-1.5" aria-label="Items in your order">
            {placedOrder ? (
              placedOrder.items.map((it) => (
                <li key={it.productId} className="flex justify-between gap-2 text-xs">
                  <span className="truncate">{it.quantity}× {it.name}</span>
                  <span className="shrink-0 text-muted">{money(it.price * it.quantity)}</span>
                </li>
              ))
            ) : summaryLines.length === 0 ? (
              <li className="text-xs text-muted">No items yet.</li>
            ) : (
              summaryLines.map((l) => (
                <li key={l.productId} className="flex justify-between gap-2 text-xs">
                  <span className="truncate">{l.quantity}× {l.name}</span>
                  <span className="shrink-0 text-muted">{money(l.line)}</span>
                </li>
              ))
            )}
          </ul>
          <dl className="mt-3 space-y-1.5 border-t border-line pt-3">
            <div className="flex justify-between">
              <dt className="text-muted">Subtotal</dt>
              <dd>{placedOrder ? money(placedOrder.subtotal) : money(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Tax (8%)</dt>
              <dd>{placedOrder ? money(placedOrder.tax) : money(totals.tax)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">
                {(placedOrder ? placedOrder.shipping === 0 : totals.shipping === 0)
                  ? "Shipping — free"
                  : "Shipping"}
              </dt>
              <dd>
                {(placedOrder ? placedOrder.shipping : totals.shipping) === 0
                  ? "Free"
                  : money(placedOrder ? placedOrder.shipping : totals.shipping)}
              </dd>
            </div>
            {((placedOrder ? placedOrder.shipping === 0 : totals.shipping === 0) &&
              (placedOrder ? placedOrder.items.length > 0 : totals.itemCount > 0)) && (
              <p className="text-xs text-ok">Free shipping on orders $50+.</p>
            )}
            <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
              <dt>Total</dt>
              <dd>{placedOrder ? money(placedOrder.total) : money(totals.total)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            {(placedOrder ? placedOrder.items.reduce((n, i) => n + i.quantity, 0) : totals.itemCount)}{" "}
            item{(placedOrder ? placedOrder.items.reduce((n, i) => n + i.quantity, 0) : totals.itemCount) === 1 ? "" : "s"}
          </p>
        </aside>
      </div>
    </div>
  );
}

function WizardButtons({
  onBack,
  nextLabel,
  submitting,
  onSubmit,
}: {
  onBack: (() => void) | null;
  nextLabel: string;
  submitting: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={"Back: " + nextLabel}
          className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-2"
        >
          <span aria-hidden="true">← </span>Back
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-accent-strong px-5 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
      >
        {submitting ? "Placing…" : nextLabel}
      </button>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  error,
  required,
  type = "text",
  inputMode,
  autoComplete,
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  required?: boolean;
  type?: string;
  inputMode?: "numeric" | "text" | "email" | "tel" | "search";
  autoComplete?: string;
  placeholder?: string;
}) {
  const id = "f-" + name;
  const errId = id + "-err";
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        required={required}
        inputMode={inputMode as "numeric" | "text" | "email" | "tel" | "search" | undefined}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={
          "w-full rounded-lg border px-3 py-2.5 text-sm focus:border-accent " +
          (error ? "border-danger" : "border-line")
        }
      />
      {error && (
        <p id={errId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function OrderSummaryPanel({ orderId }: { orderId: string }) {
  const { state } = useBazaar();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return null;
  return (
    <div className="rounded-lg border border-line bg-background/40 p-3 text-sm">
      <div className="mb-2 font-semibold">Itemized summary</div>
      <ul className="space-y-1">
        {order.items.map((it) => (
          <li key={it.productId} className="flex justify-between">
            <span>{it.quantity}× {it.name}</span>
            <span>{money(it.price * it.quantity)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 space-y-1 border-t border-line pt-2">
        <div className="flex justify-between text-muted">
          <span>Subtotal</span>
          <span>{money(order.subtotal)}</span>
        </div>
        <div className="flex justify-between text-muted">
          <span>Tax (8%)</span>
          <span>{money(order.tax)}</span>
        </div>
        <div className="flex justify-between text-muted">
          <span>Shipping</span>
          <span>{order.shipping === 0 ? "Free" : money(order.shipping)}</span>
        </div>
        <div className="flex justify-between font-bold">
          <span>Total</span>
          <span>{money(order.total)}</span>
        </div>
      </div>
    </div>
  );
}

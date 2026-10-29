"use client";

/**
 * Ledger — the transactions table band (plan §3 band 4).
 *
 * Sortable by column (real buttons in the th, aria-sort on the
 * header, one click toggles direction), semantic status chips on the
 * DATA colors, and the row hover as a transform lift (compositing
 * only — the motion-designer law).
 */
import { useState } from "react";
import type { Txn } from "@/lib/ledger/types";
import { sortTxns, statusTone, type SortKey } from "@/lib/ledger/stats";
import { money, shortDate } from "@/lib/ledger/format";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "date", label: "Date", align: "left" },
  { key: "merchant", label: "Merchant", align: "left" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "status", label: "Status", align: "left" },
];

const ACCOUNT_LABEL: Record<Txn["account"], string> = {
  operating: "Operating",
  payroll: "Payroll",
  reserve: "Reserve",
  tax: "Tax",
};

export function TxnTable({ txns }: { txns: Txn[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  const rows = sortTxns(txns, sort.key, sort.dir);

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "amount" || key === "date" ? "desc" : "asc" }));

  return (
    <section className="lg-band" aria-labelledby="txns-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="lg-micro text-[var(--lg-faint)]">Transactions · this month</p>
          <h2 id="txns-heading" className="mt-2 text-[24px] font-semibold tracking-[-0.012em] text-[var(--lg-ink-deep)]">
            Where it went
          </h2>
        </div>
        <p className="lg-num text-[13px] text-[var(--lg-dim)]">{rows.length} rows · seeded fixture</p>
      </div>

      <div className="mt-6 overflow-x-auto rounded-[12px] border border-[var(--lg-line)] bg-white/60">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--lg-line)]">
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={`px-4 py-3 ${c.align === "right" ? "text-right" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={`lg-micro inline-flex items-center gap-1.5 transition-colors duration-150 hover:text-[var(--lg-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lg-clay-deep)] ${
                      sort.key === c.key ? "text-[var(--lg-ink)]" : "text-[var(--lg-faint)]"
                    }`}
                    aria-label={`Sort by ${c.label}${sort.key === c.key ? `, current sort ${sort.dir === "asc" ? "ascending" : "descending"}` : ""}`}
                  >
                    {c.label}
                    <span aria-hidden="true" className="opacity-60">
                      {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col" className="px-4 py-3">
                <span className="lg-micro text-[var(--lg-faint)]">Account</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const tone = statusTone(t.status);
              return (
                <tr key={t.id} className="lg-row border-b border-[var(--lg-line)]/60 last:border-b-0 hover:bg-[var(--lg-paper-2)] [&>td]:py-2.5">
                  <td className="lg-num px-4 py-3 text-[13px] text-[var(--lg-dim)]">{shortDate(t.date)}</td>
                  <td className="px-4 py-3">
                    <p className="text-[15px] text-[var(--lg-ink)]">{t.merchant}</p>
                    <p className="text-[12px] text-[var(--lg-faint)]">{t.category}</p>
                  </td>
                  <td className={`lg-num px-4 py-3 text-right text-[15px] font-medium ${t.amount < 0 ? "text-[var(--lg-ink)]" : "text-[var(--lg-pos)]"}`}>
                    {money(t.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`lg-num inline-block rounded-[4px] border px-1.5 py-0.5 text-[12px] font-medium ${
                        tone === "pos"
                          ? "border-[var(--lg-pos)]/40 bg-[var(--lg-pos)]/10 text-[var(--lg-pos)]"
                          : tone === "neutral"
                            ? "border-[var(--lg-line-strong)] bg-[var(--lg-paper-3)] text-[var(--lg-dim)]"
                            : "border-[var(--lg-neg)]/40 bg-[var(--lg-neg)]/10 text-[var(--lg-neg)]"
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[var(--lg-dim)]">{ACCOUNT_LABEL[t.account]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

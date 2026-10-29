"use client";

/**
 * Ledger — the shell: header, the KPI band (numbers-as-headlines), the
 * accounts strip, the compliance band and the footer (plan §3 bands
 * 1, 2, 5, 6, 7). The chart and table bands are their own components.
 *
 * The embed contract follows the encore pattern: `?embed=1` arrives as
 * a PROP from the server page (no client-side searchParams read — the
 * F3 hydration pin), the frame drops its header/footer chrome when
 * embedded, and the reset handshake is a window-message listener.
 */
import { useEffect, type ReactNode } from "react";
import type { Account, Kpi } from "@/lib/ledger/types";
import { flowSeries, kpis } from "@/lib/ledger/stats";
import { ACCOUNTS } from "@/lib/ledger/seed";
import { money } from "@/lib/ledger/format";
import { FlowChart } from "./flow-chart";
import { TxnTable } from "./txn-table";
import { Card, Delta, Link, PrimaryAction } from "./primitives";

function Header() {
  return (
    <header className="border-b border-[var(--lg-line)]">
      <div className="lg-container flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="inline-block size-6 rounded-[4px] bg-[var(--lg-clay)]" />
          <p className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--lg-ink-deep)]" style={{ fontFamily: "var(--lg-serif)" }}>
            Ledger
          </p>
        </div>
        <nav aria-label="Ledger sections" className="hidden items-center gap-6 md:flex">
          {[
            ["Overview", "#kpis"],
            ["Cash flow", "#flow"],
            ["Transactions", "#txns"],
            ["Accounts", "#accounts"],
          ].map(([label, href]) => (
            <a key={href} href={href} className="text-[15px] text-[var(--lg-dim)] transition-colors duration-150 hover:text-[var(--lg-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lg-clay-deep)]">
              {label}
            </a>
          ))}
        </nav>
        <PrimaryAction href="#accounts">Open an account</PrimaryAction>
      </div>
    </header>
  );
}

function KpiBand({ cards }: { cards: Kpi[] }) {
  return (
    <section id="kpis" className="lg-band scroll-mt-24" aria-labelledby="kpi-heading">
      <p className="lg-micro text-[var(--lg-faint)]">Overview · as of 30 Oct 2026</p>
      <h1 id="kpi-heading" className="mt-2 max-w-[680px] text-[32px] font-semibold leading-[1.15] tracking-[-0.018em] text-[var(--lg-ink-deep)]">
        The company&apos;s money, in plain figures
      </h1>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="list">
        {cards.map((k) => (
          <Card as="li" key={k.id} className="lg-row hover:border-[var(--lg-line-strong)]">
            <p className="lg-micro text-[var(--lg-faint)]">{k.label}</p>
            <p className="lg-figure mt-3 text-[var(--lg-ink-deep)]">{k.figure}</p>
            <div className="mt-3">
              <Delta pct={k.deltaPct} label={k.deltaLabel} />
            </div>
            <p className="mt-3 text-[12px] text-[var(--lg-faint)]">{k.receipt}</p>
          </Card>
        ))}
      </ul>
    </section>
  );
}

function AccountsStrip({ accounts }: { accounts: Account[] }) {
  return (
    <section id="accounts" className="lg-band scroll-mt-24" aria-labelledby="accounts-heading">
      <p className="lg-micro text-[var(--lg-faint)]">Accounts</p>
      <h2 id="accounts-heading" className="mt-2 text-[24px] font-semibold tracking-[-0.012em] text-[var(--lg-ink-deep)]">
        Four buckets, one position
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="list">
        {accounts.map((a) => (
          <Card as="li" key={a.id} className="lg-row hover:border-[var(--lg-line-strong)]">
            <p className="text-[15px] font-medium text-[var(--lg-ink)]">{a.name}</p>
            <p className="mt-1 text-[12px] leading-[1.5] text-[var(--lg-faint)]">{a.purpose}</p>
            <p className="lg-num mt-4 text-[17px] font-medium text-[var(--lg-ink-deep)]">{money(a.balance)}</p>
            <p className="lg-num mt-1 text-[12px] text-[var(--lg-faint)]">{a.number}</p>
          </Card>
        ))}
      </ul>
    </section>
  );
}

function Compliance() {
  return (
    <section className="lg-band" aria-labelledby="compliance-heading">
      <div className="rounded-[12px] border border-[var(--lg-line)] bg-[var(--lg-paper-2)] p-6">
        <p className="lg-micro text-[var(--lg-faint)]">Disclosures</p>
        <h2 id="compliance-heading" className="mt-2 text-[20px] font-semibold tracking-[-0.01em] text-[var(--lg-ink-deep)]">
          The fine print, on purpose
        </h2>
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          <p className="text-[13px] leading-[1.6] text-[var(--lg-dim)]">
            Banking services are provided by fictional partner banks, Members FDIC. Deposits are eligible for pass-through
            FDIC insurance up to applicable limits. This page is a design fixture and not a bank.
          </p>
          <p className="text-[13px] leading-[1.6] text-[var(--lg-dim)]">
            Sweep accounts may earn a variable rate. The runway and burn figures are derived from the seeded fixture&apos;s
            deterministic series (receipted in the app&apos;s test suite) and are not investment advice.
          </p>
          <p className="text-[13px] leading-[1.6] text-[var(--lg-dim)]">
            The annualized revenue figure is a trailing-twelve-month computation on the same fixture. Past performance
            does not guarantee anything, least of all in fiction.
          </p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--lg-line)]">
      <div className="lg-container flex flex-wrap items-center justify-between gap-4 py-6 text-[13px] text-[var(--lg-dim)]">
        <p>
          Ledger — a design fixture built under the Website Excellence framework.{" "}
          <Link href="https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/website-excellence-round-2/ledger-plan.md">
            Read the build contract
          </Link>
          .
        </p>
        <p className="lg-num text-[12px] text-[var(--lg-faint)]">Not a bank · Not advice · Just typography</p>
      </div>
    </footer>
  );
}

export function LedgerShell({ embed, txns }: { embed: boolean; txns: Parameters<typeof TxnTable>[0]["txns"] }) {
  // the reset handshake (the gallery contract): a postMessage from the
  // embedding page re-mounts the fixture state. Pure, no persistence.
  useEffect(() => {
    if (!embed) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "ledger-reset" && typeof window !== "undefined") window.location.reload();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [embed]);

  const cards = kpis();
  const series = flowSeries();

  return (
    <div className="ledger-scope">
      <a
        href="#kpis"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[8px] focus:bg-[var(--lg-clay)] focus:px-4 focus:py-2 focus:text-[var(--lg-paper)]"
      >
        Skip to overview
      </a>
      {!embed && <Header />}
      <main className="lg-container grid gap-16 py-12 lg:gap-24 lg:py-16">
        <KpiBand cards={cards} />
        <FlowChart series={series} />
        <TxnTable txns={txns} />
        <AccountsStrip accounts={ACCOUNTS} />
        <Compliance />
      </main>
      {!embed && <Footer />}
    </div>
  );
}

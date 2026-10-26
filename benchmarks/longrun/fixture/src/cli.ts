import { Ledger } from "./ledger";
import { formatEntry, formatCents } from "./format";

/**
 * CLI entry: `bun src/cli.ts <command> [args]`
 *
 * Commands (core): add, list, balance. Staged features add more; the CLI
 * stays a thin dispatcher over src/ modules.
 */

export function runCli(argv: string[]): { code: number; output: string } {
  const [cmd, ...rest] = argv;
  const ledger = new Ledger();
  switch (cmd) {
    case "add": {
      const [amountCents, category] = rest;
      if (!amountCents || !category) {
        return { code: 1, output: "usage: add <amount-cents> <category> [--payee p] [--note n] [--date YYYY-MM-DD]" };
      }
      const flag = (name: string) => {
        const i = rest.indexOf(`--${name}`);
        return i !== -1 ? rest[i + 1] : undefined;
      };
      try {
        const e = ledger.add({
          amountCents: Number(amountCents),
          category,
          date: flag("date") ?? "1970-01-01",
          payee: flag("payee"),
          note: flag("note"),
        });
        return { code: 0, output: `added ${e.id}` };
      } catch (err) {
        return { code: 1, output: String(err) };
      }
    }
    case "list": {
      const lines = ledger.entries().map((e) => formatEntry(e));
      return { code: 0, output: lines.length ? lines.join("\n") : "(no entries)" };
    }
    case "balance": {
      return { code: 0, output: formatCents(ledger.balance()) };
    }
    default:
      return { code: 1, output: `unknown command: ${cmd ?? "(none)"} - try: add, list, balance` };
  }
}

if (import.meta.main) {
  const { code, output } = runCli(process.argv.slice(2));
  console.log(output);
  process.exit(code);
}

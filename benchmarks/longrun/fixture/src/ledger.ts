import type { Entry, EntryInput } from "./types";
import { nextId } from "./ids";

/**
 * In-memory ledger. The staged feature work (see ../features/) extends this
 * with filters, persistence, budgets, undo, audit and recurring entries.
 */
export class Ledger {
  private readonly rows: Entry[] = [];

  add(input: EntryInput): Entry {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error(`amountCents must be a positive integer (got ${input.amountCents})`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new Error(`date must be YYYY-MM-DD (got ${input.date})`);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(input.category)) {
      throw new Error(`category must be lowercase slug (got ${input.category})`);
    }
    const entry: Entry = {
      id: nextId(this.rows.map((e) => e.id)),
      date: input.date,
      amountCents: input.amountCents,
      category: input.category,
      ...(input.payee ? { payee: input.payee } : {}),
      ...(input.note ? { note: input.note } : {}),
    };
    this.rows.push(entry);
    return entry;
  }

  remove(id: string): Entry | null {
    const i = this.rows.findIndex((e) => e.id === id);
    if (i === -1) return null;
    const [removed] = this.rows.splice(i, 1);
    return removed;
  }

  entries(): readonly Entry[] {
    return this.rows;
  }

  balance(): number {
    return this.rows.reduce((sum, e) => sum + e.amountCents, 0);
  }
}

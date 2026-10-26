export interface Entry {
  id: string;
  date: string;
  amountCents: number;
  category: string;
  payee?: string;
  note?: string;
}

export interface EntryInput {
  date: string;
  amountCents: number;
  category: string;
  payee?: string;
  note?: string;
}

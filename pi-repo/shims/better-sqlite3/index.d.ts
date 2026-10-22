export const driver: string;
export default class Database {
	constructor(path: string, options?: Record<string, unknown>);
	exec(sql: string): void;
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
		run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
	};
	transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
	close(): void;
}

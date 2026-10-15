/**
 * Minimal ambient declarations for the Bun APIs the self-learning engine
 * uses (the engine runs under Bun; the rest of the monorepo typechecks
 * under Node). Local on purpose: loading the full `bun-types` package
 * globally re-declares fetch/stream globals and conflicts with
 * @types/node. Extend ONLY when a new Bun API is adopted in this src/.
 */

declare const Bun: {
	/** Start an HTTP server; one fetch handler per request. */
	serve(options: {
		port?: number | string;
		idleTimeout?: number;
		fetch(request: Request, server?: unknown): Response | Promise<Response>;
	}): {
		port: number;
		stop(): void;
	};
	/** Sleep for ms milliseconds. */
	sleep(ms: number): Promise<void>;
	/** Spawn a subprocess; `exited` resolves to the exit code. */
	spawn(
		command: string[],
		options?: {
			cwd?: string;
			env?: Record<string, string | undefined>;
			stdout?: "pipe" | "ignore" | "inherit";
			stderr?: "pipe" | "ignore" | "inherit";
		},
	): {
		stdout: ReadableStream<Uint8Array> | null;
		stderr: ReadableStream<Uint8Array> | null;
		kill(signal?: number): void;
		exited: Promise<number>;
	};
	/** Bun transpiler — used by hooks for syntax checking. */
	Transpiler: new (options: {
		loader?: "ts" | "js" | "jsx" | "tsx";
	}) => {
		transformSync(code: string): string;
	};
};

declare module "bun:sqlite" {
	export class Database {
		constructor(path: string, options?: { create?: boolean });
		prepare(sql: string): {
			get(...params: unknown[]): unknown;
			all(...params: unknown[]): unknown[];
			run(...params: unknown[]): { changes: number; lastInsertRowid?: number | bigint };
		};
		exec(sql: string): void;
		close(): void;
	}
}

interface ImportMeta {
	/** Absolute directory of the module file (Bun runtime). */
	dir: string;
}

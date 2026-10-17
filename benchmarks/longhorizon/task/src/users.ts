import { nextId } from "./ids.ts";

/**
 * Registry of known users. The CLI registers authors on first use so every
 * name gets a stable user id.
 */
export class UserDirectory {
	private readonly names = new Map<string, string>(); // id -> display name

	/** Register a brand-new user; returns the new user id. */
	register(name: string): string {
		const id = nextId("u");
		this.names.set(id, name);
		return id;
	}

	/** Display name for a user id, if known. */
	nameOf(id: string): string | undefined {
		return this.names.get(id);
	}

	/** All known user ids in registration order. */
	ids(): string[] {
		return [...this.names.keys()];
	}
}

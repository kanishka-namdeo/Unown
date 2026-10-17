import { nextId } from "./ids.ts";
import type { Author } from "./types.ts";

/**
 * Registry of known users. The CLI resolves authors on first use so every
 * name maps to a stable structured author record ({ id, name }).
 */
export class UserDirectory {
	private readonly names = new Map<string, string>(); // id -> display name

	/** Register a brand-new user; returns the full author record. */
	register(name: string): Author {
		const id = nextId("u");
		this.names.set(id, name);
		return { id, name };
	}

	/** Return the author for a name, registering on first use. */
	ensure(name: string): Author {
		return this.lookupByName(name) ?? this.register(name);
	}

	/** Full author record for a user id, if known. */
	lookup(id: string): Author | undefined {
		const name = this.names.get(id);
		return name === undefined ? undefined : { id, name };
	}

	/** Display name for a user id, if known. */
	nameOf(id: string): string | undefined {
		return this.names.get(id);
	}

	/** All known user ids in registration order. */
	ids(): string[] {
		return [...this.names.keys()];
	}

	private lookupByName(name: string): Author | undefined {
		for (const [id, candidate] of this.names) {
			if (candidate === name) return { id, name: candidate };
		}
		return undefined;
	}
}

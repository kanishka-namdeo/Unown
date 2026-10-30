/**
 * plm-states.test.ts — the process state machine's math: the closed status
 * set, legal/illegal edges, terminality, and the outcome classification the
 * dashboard counts on. Pure module — no store, no env.
 */
import { describe, expect, test } from "bun:test";
import {
	ARCHIVED,
	isLegalTransition,
	isProcessKind,
	isProcessState,
	outcomeClass,
	PROCESS_KINDS,
	PROCESS_STATES,
	TERMINAL_STATES,
} from "../src/plm/states.ts";

describe("the transition table", () => {
	test("every state has an entry", () => {
		for (const state of PROCESS_STATES) {
			expect(isLegalTransition(state, "ARCHIVED")).toBeDefined();
		}
	});
	test("the happy path walks CREATED → … → SUCCEEDED → ARCHIVED", () => {
		const path = ["CREATED", "PLANNED", "QUEUED", "RUNNING", "VALIDATING", "SUCCEEDED", "ARCHIVED"] as const;
		for (let i = 0; i < path.length - 1; i++) {
			expect(isLegalTransition(path[i], path[i + 1])).toBe(true);
		}
	});
	test("waiting and blocked are first-class (a human gate parks the process)", () => {
		expect(isLegalTransition("RUNNING", "WAITING")).toBe(true);
		expect(isLegalTransition("WAITING", "RUNNING")).toBe(true);
		expect(isLegalTransition("WAITING", "BLOCKED")).toBe(true);
		expect(isLegalTransition("RUNNING", "BLOCKED")).toBe(true);
		expect(isLegalTransition("BLOCKED", "RUNNING")).toBe(true);
	});
	test("retrying is explicit and returns to RUNNING or dies", () => {
		expect(isLegalTransition("RUNNING", "RETRYING")).toBe(true);
		expect(isLegalTransition("RETRYING", "RUNNING")).toBe(true);
		expect(isLegalTransition("RETRYING", "FAILED")).toBe(true);
		expect(isLegalTransition("RETRYING", "SUCCEEDED")).toBe(false); // must validate first
	});
	test("no state bypasses the machine (mission rule)", () => {
		expect(isLegalTransition("CREATED", "SUCCEEDED")).toBe(false);
		expect(isLegalTransition("CREATED", "RUNNING")).toBe(false); // planned/queued first
		expect(isLegalTransition("QUEUED", "SUCCEEDED")).toBe(false);
		expect(isLegalTransition("PLANNED", "FAILED")).toBe(false);
	});
	test("ARCHIVED is absorbing and terminals only archive", () => {
		for (const state of PROCESS_STATES) {
			if (state !== ARCHIVED) expect(isLegalTransition(ARCHIVED, state)).toBe(false);
		}
		expect(isLegalTransition("SUCCEEDED", "RUNNING")).toBe(false);
		expect(isLegalTransition("FAILED", "RUNNING")).toBe(false);
		expect(isLegalTransition("SUCCEEDED", "FAILED")).toBe(false);
		expect(isLegalTransition("SUCCEEDED", ARCHIVED)).toBe(true);
		expect(isLegalTransition("FAILED", ARCHIVED)).toBe(true);
		expect(isLegalTransition("ABANDONED", ARCHIVED)).toBe(true);
	});
});

describe("terminality + outcome classes", () => {
	test("exactly three terminals + the archive", () => {
		expect(TERMINAL_STATES.has("SUCCEEDED")).toBe(true);
		expect(TERMINAL_STATES.has("FAILED")).toBe(true);
		expect(TERMINAL_STATES.has("ABANDONED")).toBe(true);
		expect(TERMINAL_STATES.size).toBe(3);
	});
	test("outcome classes partition the states", () => {
		expect(outcomeClass("RUNNING")).toBe("open");
		expect(outcomeClass("WAITING")).toBe("waiting");
		expect(outcomeClass("BLOCKED")).toBe("blocked");
		expect(outcomeClass("SUCCEEDED")).toBe("ok");
		expect(outcomeClass("FAILED")).toBe("ko");
		expect(outcomeClass("ABANDONED")).toBe("dropped");
		expect(outcomeClass("ARCHIVED")).toBe("history");
	});
});

describe("input guards", () => {
	test("state strings are validated, never trusted", () => {
		expect(isProcessState("RUNNING")).toBe(true);
		expect(isProcessState("running")).toBe(false);
		expect(isProcessState("STOPPED")).toBe(false);
		expect(isProcessState(null)).toBe(false);
		expect(isProcessState(42)).toBe(false);
	});
	test("kind strings are validated", () => {
		expect(isProcessKind("job")).toBe(true);
		expect(isProcessKind("run")).toBe(true);
		expect(isProcessKind("made-up")).toBe(false);
		expect(PROCESS_KINDS.length).toBe(10);
	});
});

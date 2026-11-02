declare module "bun:test" {
  export function test(
    name: string,
    fn: (t: TestContext) => void | Promise<void>,
  ): void;
  export const describe: {
    (name: string, fn: () => void | Promise<void>): void;
    each: never;
  };
  export function it(
    name: string,
    fn: (t: TestContext) => void | Promise<void>,
  ): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function skip(
    name: string,
    fn: (t: TestContext) => void | Promise<void>,
  ): void;

  export interface TestContext {
    expect: typeof expect;
  }

  export function expect(actual: unknown): Expectation;

  export interface Expectation {
    (expected: unknown): void;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toThrow(
      expected?:
        | string
        | RegExp
        | Error
        | (abstract new (...args: never[]) => Error)
        | ((err: Error) => boolean),
    ): void;
    toHaveLength(n: number): void;
    toContain(needle: unknown): void;
    toContainEqual(needle: unknown): void;
    toMatch(re: RegExp | string): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeGreaterThan(n: number): void;
    toBeLessThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toBeInstanceOf(ctor: unknown): void;
    not: Expectation;
    resolves: Expectation;
    rejects: Expectation;
  }
}

// Minimal ambient for the scanner's fs import (no @types/node at the root,
// Coda keeps zero deps; bun's runtime types win under `bun test`).
declare module "node:fs/promises" {
  export function readdir(
    path: string,
    options?: { withFileTypes?: boolean },
  ): Promise<
    Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
  >;
  export function readFile(
    path: string,
    encoding?: "utf8",
  ): Promise<string>;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function dirname(p: string): string;
}

// Bun exposes import.meta.dir on every module; the ambient lib types
// (ES2022 + DOM) do not, so the scanner's path resolution needs it.
// NOTE: this file is a global script (no top-level import/export), so the
// interface must sit at top level — `declare global {}` only augments from
// external modules and would never merge with lib's ImportMeta here.
interface ImportMeta {
  dir: string;
  url: string;
}

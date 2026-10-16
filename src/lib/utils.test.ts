// Unit tests for src/lib/utils.ts (`cn` — clsx + tailwind-merge).
//
// Backlog reference: docs/testing-strategy.md §2 flags that `src/` has no unit
// tests. `cn` is trivial pure logic, so it is covered in the same pass as the
// two modules the doc calls out by name (use-toast, agent-format).
//
// Runs on `bun test` (bun:test is built in — zero new deps).

import { describe, expect, test } from "bun:test"

import { cn } from "./utils"

describe("cn", () => {
  test("no arguments -> empty string", () => {
    expect(cn()).toBe("")
  })

  test("joins plain class names with single spaces", () => {
    expect(cn("a", "b")).toBe("a b")
    expect(cn("px-2", "py-1", "text-sm")).toBe("px-2 py-1 text-sm")
  })

  test("filters falsy and empty inputs", () => {
    expect(cn("a", undefined, null, false, "b")).toBe("a b")
    expect(cn("", "a")).toBe("a")
    expect(cn(undefined, null, false, "")).toBe("")
  })

  test("supports clsx conditional syntax (arrays and objects)", () => {
    expect(cn(["a", "b"])).toBe("a b")
    expect(cn({ a: true, b: false, c: true })).toBe("a c")
    expect(cn("a", false && "b", true && "c")).toBe("a c")
  })

  test("later tailwind classes win over conflicting earlier ones", () => {
    expect(cn("px-2", "px-4")).toBe("px-4")
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500")
  })

  test("non-conflicting classes are preserved in a stable order", () => {
    expect(cn("p-2 m-2", "p-4")).toBe("m-2 p-4")
    expect(cn("px-2 text-sm", "px-4")).toBe("text-sm px-4")
  })

  test("mixes conditionals with conflict resolution", () => {
    expect(cn("font-bold", { "font-normal": true }, "mt-1")).toBe("font-normal mt-1")
    expect(cn("font-bold", { "font-normal": false }, "mt-1")).toBe("font-bold mt-1")
  })

  test("a single class is returned as-is", () => {
    expect(cn("only")).toBe("only")
  })
})

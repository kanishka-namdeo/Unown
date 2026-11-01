// Unit test for the dev-origin allowlist in next.config.ts (the browser
// autonomy round, F4): Next 16's dev server blocks "cross-origin" dev
// resources — fonts, the HMR socket — when the browser reaches the dev
// server by an origin it does not recognize, and the failure is silent on
// the page: SSR HTML renders, no console error, hydration never completes,
// every interactive element dead. `127.0.0.1` must be allowlisted or the
// dev server is un-interactable by IP-literal access. The e2e lane boots a
// production build (playwright.config.ts, NODE_ENV=production), so this
// contract cannot be pinned there — it is pinned here.
//
// Runs on `bun test` (bun:test is built in — zero new deps). Importing the
// config is safe at test time: its only import is a type-only `import type
// { NextConfig } from "next"`, erased at runtime.

import { describe, expect, test } from "bun:test"

import nextConfig from "../next.config"

describe("next.config allowedDevOrigins (the silent no-hydration guard)", () => {
  test("127.0.0.1 is allowlisted for dev-server access by IP literal", () => {
    const origins = (nextConfig as { allowedDevOrigins?: string[] }).allowedDevOrigins
    expect(origins).toBeDefined()
    expect(origins).toContain("127.0.0.1")
  })

  test("the allowlist is exact — no wildcard that would disarm the dev-origin block", () => {
    const origins = (nextConfig as { allowedDevOrigins?: string[] }).allowedDevOrigins ?? []
    expect(origins).not.toContain("*")
    for (const o of origins) expect(o.trim()).toBe(o)
  })
})

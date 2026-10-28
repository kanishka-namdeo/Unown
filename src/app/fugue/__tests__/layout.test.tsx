/**
 * The /fugue layout contract, drift-pinned.
 *
 * The cadence round has no layout test to mirror (src/app/cadence/__tests__
 * holds only page.test.tsx), so this file pins the layout directly. It is a
 * PASS-THROUGH like the /cadence and /parley layouts — the landing's root
 * layout owns <html>/<body> — that imports the scoped stylesheet (Next
 * injects it for /fugue routes only) and renders the `.fugue-scope` wrapper
 * carrying the app's element-level rules. Unlike the dark-default demos,
 * fugue is light-by-default: the wrapper must NOT carry the `dark` class
 * (the standalone app shipped no dark mode at all).
 *
 * Rendering the layout under bun exercises the scoped-css import too
 * (bun's loader handles it natively; the root layout's next/font modules
 * are the reason src/app/__tests__/layout.test.tsx pins source text only).
 */
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import Layout, { metadata } from "../layout";

describe("/fugue layout (the route's pass-through contract)", () => {
  test("renders the .fugue-scope wrapper around the route's children", () => {
    const { container } = render(
      <Layout>
        <p>fugue-layout-child</p>
      </Layout>,
    );
    const scope = container.querySelector<HTMLElement>(".fugue-scope");
    expect(scope).not.toBeNull();
    expect(scope!.className).toContain("min-h-screen");
    // Light-by-default: the fugue scope must not ship the `dark` class the
    // dark-default demos (/cadence, /parley) carry on their scopes.
    expect(scope!.className).not.toContain("dark");
    const child = container.querySelector("p");
    expect(child).not.toBeNull();
    expect(child!.textContent).toBe("fugue-layout-child");
    expect(scope!.contains(child)).toBe(true);
  });

  test("pins the demo metadata: branded title, description, noindex", () => {
    expect(metadata.title).toBe("Fugue — live demo | unown");
    expect(metadata.description).toContain("workflow-automation");
    // The live demo is embed-only surface: never indexed, never followed.
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  test("the default export takes children as an explicit typed prop", () => {
    // The explicit-prop contract (no spread): children are consumed by
    // name, so a renamed prop is a type error, not a silent miss.
    expect(typeof Layout).toBe("function");
    expect(Layout.length).toBe(1); // destructured ({ children }) counts as one param
  });
});

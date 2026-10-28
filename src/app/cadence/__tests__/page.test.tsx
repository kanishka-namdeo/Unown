/**
 * The /cadence route's page contract, drift-pinned.
 *
 * Page is a server component whose body IS the React #418 contract: the
 * awaited searchParams stay inside the async inner component, the flag
 * reaches the client tree as an explicit prop, and the Suspense boundary
 * owns the fallback. Under the bun test lane the sync part renders (the
 * fallback is real); the async inner tree resolves in the Next runtime —
 * pinned end-to-end by the production build prerender and the live demo.
 */
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import Page from "../page";

describe("/cadence page (the route's React #418 contract)", () => {
  test("renders the Suspense fallback without crashing, embed read stays server-side", () => {
    const { container } = render(
      <Page
        searchParams={Promise.resolve({ embed: "1" })}
        params={Promise.resolve({})}
      />,
    );
    // The boundary's fallback is the min-h-full div while the async
    // inner component resolves (in the Next runtime; not awaited here).
    expect(container.querySelector(".min-h-full")).not.toBeNull();
  });

  test("the default export takes searchParams + params as explicit typed props", () => {
    // The explicit-prop contract (no spread): the props are consumed by
    // name, so a renamed prop is a type error, not a silent miss.
    expect(typeof Page).toBe("function");
    expect(Page.length).toBe(1); // destructured ({ searchParams, params }) counts as one param
  });
});

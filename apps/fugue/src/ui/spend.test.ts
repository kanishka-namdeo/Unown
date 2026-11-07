/**
 * spend.test.ts — the spend meter (Lane A, DOM-guarded: pure render
 * helpers; the adapter data comes through the seam — the tests inject
 * through FakeEngineAdapter / the contract fixtures, never invent
 * engine numbers).
 */
import { describe, test, expect } from "bun:test";
import {
  spendMeterViewModel,
  formatShare,
  renderSpendMeter,
} from "./spend.js";
import { SPEND_FIXTURE } from "../adapter/contract.js";
import { FakeEngineAdapter, makeFakeClock } from "../adapter/fake-engine-adapter.js";
import type { SpendReport } from "../adapter/engine-adapter.js";

function spend(partial: Partial<SpendReport>): SpendReport {
  return { ...SPEND_FIXTURE, ...partial };
}

describe("spend meter: the E-04 canned-spend-throttle pin", () => {
  test("canned spend JSON says throttled → the meter shows the throttled state (never a silent zero)", () => {
    const sp = spend({ throttled: true, calls: 60, windowLimit: 60 });
    const vm = spendMeterViewModel(sp);
    expect(vm.throttled).toBe(true);
    expect(vm.throttleLine.toLowerCase()).toContain("throttled");
    const html = renderSpendMeter(sp);
    expect(html).toContain('data-throttled="true"');
    expect(html).toContain("throttled — the governor is holding new jobs");
    // The bar pins at 100% (not zero) when throttled.
    expect(html).toContain('aria-valuenow="100"');
    expect(html).not.toContain('aria-valuenow="0"');
  });

  test("the adapter seam serves a canned throttled spend (injected, not invented)", async () => {
    const fake = new FakeEngineAdapter(
      makeFakeClock(0).now,
      { spend: spend({ throttled: true, calls: 25, windowLimit: 25 }) },
    );
    const sp = await fake.spend();
    expect(sp.throttled).toBe(true);
    const html = renderSpendMeter(sp);
    expect(html).toContain('data-throttled="true"');
  });

  test("an unthrottled meter shows the consumed share honestly", () => {
    const sp = spend({ throttled: false, calls: 41, windowLimit: 82 });
    const vm = spendMeterViewModel(sp);
    expect(vm.throttled).toBe(false);
    expect(vm.consumedShare).toBeCloseTo(41 / 82);
    const html = renderSpendMeter(sp);
    expect(html).toContain('data-throttled="false"');
    expect(html).toContain("41 / 82 calls");
  });

  test("an unlimited window shows 'unlimited', not 0%", () => {
    const vm = spendMeterViewModel(spend({ windowLimit: 0, calls: 41 }));
    expect(vm.consumedShare).toBeNull();
    expect(vm.throttleLine).toBe("unlimited window");
    expect(formatShare(null)).toBe("unlimited");
    expect(renderSpendMeter(spend({ windowLimit: 0 }))).toContain("unlimited window");
  });
});

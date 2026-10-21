// DOM test environment for bun test (landing component tests).
//
// Wired in via bunfig.toml [test] preload, so every test file — including the
// pure unit tests in src/lib and src/hooks — runs with a happy-dom global DOM
// available. Registration is additive DOM globals only (window, document,
// EventSource, …); the pure tests never touch them and must stay green — that
// is the contract this file exists to keep (verify with `bun test src`).
//
// Why a global preload instead of per-file registration: bun test runs all
// files in one process, and @testing-library/react needs the globals to exist
// before the component modules evaluate. A single registration in the preload
// is the happy-dom-documented setup for bun.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// React 19: mark the act() environment that @testing-library/react expects;
// without this React logs "The current testing environment is not configured
// to support act(...)" warnings into every component test.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

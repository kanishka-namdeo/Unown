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

// Node web classes (Response, Request, Headers — NOT fetch):
// happy-dom's GlobalRegistrator replaces the global Response/Request with
// browser-like implementations that FILTER the forbidden WHATWG headers —
// Set-Cookie on responses, Cookie on requests. The landing component tests
// never touch those; the demo apps' API-route tests DO (the fugue round's
// auth/api suites drive the real route handlers with Request objects
// carrying a session cookie and pin the httpOnly Set-Cookie flags on the
// response — parley needed the x-parley-cookie fallback workaround for the
// same filter). We capture Node's classes BEFORE register() and restore
// them AFTER, so DOM components get happy-dom's window/document while API
// tests get the real Node Response/Request/Headers (the same documented
// pattern the fugue build repo's preload uses). `fetch` itself STAYS
// happy-dom's: the cadence store's fire-and-forget sync posts a relative
// URL that Node's fetch would reject synchronously inside the effect
// (happy-dom's settles harmlessly), and no test needs the Node one.
const NodeResponse = globalThis.Response;
const NodeRequest = globalThis.Request;
const NodeHeaders = globalThis.Headers;

GlobalRegistrator.register();

// Restore Node's web classes so Set-Cookie/Cookie headers round-trip.
globalThis.Response = NodeResponse;
globalThis.Request = NodeRequest;
globalThis.Headers = NodeHeaders;

// React 19: mark the act() environment that @testing-library/react expects;
// without this React logs "The current testing environment is not configured
// to support act(...)" warnings into every component test.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

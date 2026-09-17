# Verify `@usesonar/react`

This verifier treats the React package as an adapter over the public `@usesonar/effect` client. A passing result proves the adapter behavior in a deterministic Happy DOM process; it does not prove a hosted API, upstream providers, credentials, or network transport.

## Conditions

| ID | Condition |
| --- | --- |
| R-01 | `SonarProvider` creates one private TanStack `QueryClient` and one Effect runtime per mounted provider. A consumer does not need a `QueryClientProvider`. |
| R-02 | `useSonar` and `useDeepSonar` return `{ resolve, data, status, loading, error }`. Before `resolve`, the values are `null`, `undefined`, `false`, and `null`, respectively. |
| R-03 | Each hook dispatches to the matching `SonarClient` operation and exposes snapshot status instead of TanStack query success. A stream must start with the exact all-pending tree, can progress monotonically through pending snapshots, and must end after exactly one complete snapshot; premature EOF, regressed terminal leaves, and post-complete snapshots preserve the latest data and surface `ProtocolError`. |
| R-04 | A resolve call compiles research validators to serializable JSON Schema, deep-captures the resulting entity selectors and seed, and uses the canonical identity `["sonar", tier, canonicalConfig, normalizedSeed]`. A rerender or later caller mutation cannot change the captured request, canonically equal requests share one query, distinct requests remain isolated, and identity normalization cannot throw from render. |
| R-05 | Resolving a new key switches the observer and interrupts the superseded stream. Late values from the old stream cannot replace data for the latest key. |
| R-06 | The last observer detaching interrupts an active stream. React Strict Mode does not duplicate an active stream or leak the probe mount. |
| R-07 | A completed query is reused inside one provider for five minutes. Expiry and provider teardown are tested with fake time, and a true provider unmount cancels active work, clears cached results, and disposes the runtime. |
| R-08 | The internal query client disables retry and automatic focus, reconnect, mount, and staleness refetch. Its stale time is infinite, and its garbage-collection time is five minutes. |
| R-09 | `loading` reflects active fetching. A typed `SonarClientError` keeps the latest partial snapshot visible, clears on a later resolve, and does not trigger an implicit retry. |
| R-10 | Research and deep-research configs preserve exact entity-owned built-ins and question namespaces through nested and whole-config spreads. Research validators infer their output types, raw JSON Schema produces `JSONValue`, and deep-research prompts produce strings. Finite entity and question maps produce exact required fields, while broad maps expose optional reads with the correct catalog or answer type. Optional-keyed, callable, constructable, reserved, malformed, cross-tier, union, and numeric or symbol key hybrid maps are rejected. Seeds require one supported identity branch, and TTLs stay between 12 hours and 365 days. |
| R-11 | A missing provider and malformed client output fail visibly. Runtime-invalid LinkedIn and X URL strings surface `RequestError` through hook state instead of throwing from render. Tests replace global `fetch` with a throwing guard, so a passing runtime suite proves that the injected Effect client is the only data source. |
| R-12 | The package uses React `19.2.8`, exact `@tanstack/react-query` `5.102.6`, exact Effect `4.0.0-rc.112`, and `experimental_streamedQuery`. Its `@usesonar/effect` dependency is an exact publishable semver, and runtime source cannot import Ky, API, backend, provider SDKs, or workspace source files. |
| R-13 | The public root exports only the intended React API and types: `SonarProvider`, `useSonar`, `useDeepSonar`, `SonarProviderProps`, and `SonarResult`. The packed manifest preserves the live internal dependency version without a `workspace:` protocol, and the built package remains neutral ESM with declarations and no tracked `dist` changes. |

## Commands

Run the focused verifier first:

```sh
bunx ultracite check packages/react/src packages/react/test
bun test packages/react/src/*.test.ts packages/react/test
bunx tsc -p packages/react/tsconfig.json --noEmit --composite false
```

Then run the repository and package checks:

```sh
just fmt
just check
just build
just check-packages
bun changeset status
git diff --check
git status --short packages/react
```

Inspect the packed package only after the build succeeds:

```sh
cd packages/react
npm pack --dry-run --ignore-scripts
```

## Verdict

Mark each condition `PASS` only when its focused assertions pass and the relevant source or packed-package inspection agrees. Print one line per condition in ID order, followed by exactly one overall line:

```text
PASS R-01
PASS R-02
PASS R-03
PASS R-04
PASS R-05
PASS R-06
PASS R-07
PASS R-08
PASS R-09
PASS R-10
PASS R-11
PASS R-12
PASS R-13
OVERALL PASS @usesonar/react
```

Replace `PASS` with `FAIL` and append a concise reason when any assertion or inspection fails. Print `OVERALL FAIL @usesonar/react` if any condition fails. Never award an overall pass from test names, documentation claims, or a successful build alone.

# Sonar cross-stack standing verifier

This is the immutable plan-goal for the Sonar stack. Re-read this file before each plan, implementation, or verification cycle. It verifies the observable contract across the private backend and the four public package surfaces; it does not ask whether a particular implementation strategy was followed.

The verifier is adversarial. A passing package test, a build, a typecheck, or a README claim is not evidence for a condition unless the condition names that evidence. Do not weaken, remove, rename, or reinterpret a condition because an implementation currently fails it. Change this file only when the product contract itself was mis-recorded; record that contract decision before changing the condition and rerun every affected check.

## Fixed scope and architecture

The required proof is local, deterministic, keyless with respect to real credentials, and networkless. It may use an in-memory backend, fake provider, fake clock, real `Request`/`Response`/`ReadableStream` objects, and a temporary DOM for React. It must not call a hosted endpoint, a real provider, Redis, Next.js, Vercel Workflow, or a real model. A gpt-5.6-luna evaluation is optional and never changes the required verdict.

The selected architecture is fixed for this goal:

- `@usesonar/api` owns the Zod v4 wire schemas and transport. `createSonar` returns the raw `KyInstance`; typed JSON, POST-SSE, and retrieve helpers use that instance and preserve Ky errors.
- `@usesonar/effect` owns the Effect `4.0.0-rc.112` v4 client service, Layers, Streams, tagged errors, and deterministic testing primitives. It reaches Sonar only through the public API package.
- `@usesonar/backend` is private. Its test harness supplies deterministic fake auth, HMAC hashing, cache, provider, run, and Fetch-handler behavior; those controls never appear in a public response or public package.
- `@usesonar/react` owns `SonarProvider`, `useSonar`, and `useDeepSonar`, using TanStack `experimental_streamedQuery` and a provider-owned shared cache.
- `@usesonar/eve` owns generated static/dynamic tools. Foreground execution is the default; deep research may opt into Eve background execution, which still returns the final full snapshot normally.

The seed union accepts branches `linkedinURL`, `fullName + xURL`, or `fullName + email`; supported identity fields may coexist; optional `domain` or JSON `context` may accompany a valid branch; neither alone satisfies it; TTL is inclusive from 12 hours through 365 days. The API stream begins with a pending snapshot, emits field events, completes once, and permits three reconnects. Hash identity is an HMAC over the server secret, authenticated tenant ID, route, and canonical seed/config including TTL. Publishable and secret capabilities are distinct, and required tests use deterministic fixture keys only.

The golden research request uses the two-field seed branch `fullName + xURL`, `ttl: "12h"`, one built-in field and one described research schema under each entity. Result data lists `person` then `company`; each entity keeps its custom answers under `research`. Research authors may supply a Zod validator, raw JSON Schema, or `StandardJSONSchemaV1`, and the compiled wire schema's nonblank root description is the prompt. Deep research uses prompt strings and keeps answers under each entity's `deepResearch` namespace. Finite interfaces and finite type aliases produce exact required fields, while broad configs preserve catalog types but make reads optional. Callable or constructable maps and numeric or symbol key hybrids fail at compile time. Raw retrieval and model-owned dynamic Eve questions use their documented finite-map exceptions.

## Required conditions

Each ID is required. `tests/stack.test.ts` is the executable evidence for the runtime conditions; the commands and static inspections below are part of the same verdict.

### STK-001 — One wire contract across the stack

The same canonical request is accepted by the private Fetch handler, raw API JSON helper, and Effect client; React and Eve receive its config and seed through their designed split call boundary. Every representation has the same ordered root keys (`person`, `company`) and retains each question and answer under its owning entity and tier. The verifier also sends one deep-research prompt under each entity through the raw API and Effect client. Every requested leaf begins as `{ status: "pending" }` and settles to a terminal field before `status: "complete"`.

FAIL if any surface flattens or moves an entity-owned custom result, drops a requested leaf, invents a fifth field state, accepts a different seed/config, or reports complete while a leaf is pending.

### STK-002 — Backend Fetch handler to raw API

The test harness accepts deterministic capability keys and an in-memory handler. `createSonar` uses the injected handler as its only transport; `createResearch` sends the exact compiled `/v1/research` JSON request, `createDeepResearch` sends the exact `/v1/deepResearch` prompt request, and `retrieveSonar` reads the same completed research snapshot. The public raw JSON may contain the HMAC hash, but its body contains no provider, processor, job, cache, run, Layer, workflow, or secret details.

FAIL if the raw API silently uses ambient `fetch`, changes the request body, loses custom-question configuration, returns a different snapshot from the handler, or leaks transport/backend internals.

### STK-003 — API SSE to Effect Stream

The same raw Ky instance feeds `layerFromAPI`. Its Effect `SonarClient` research stream receives the initial all-pending snapshot, applies indexed field events in order, ignores no terminal field, and exposes the completed snapshot with the same data shape as raw API retrieval. The raw Fetch stream exposes snapshot ID `0`, field IDs `1` through `4` for `person.title`, `person.research.isTechnical`, `company.name`, and `company.research.sellsToSMB`, then complete ID `5`. The verifier deliberately disconnects after ID `1`, reconnects with `Last-Event-ID: 1`, and proves the resumed sequence has no duplicate, gap, or changed path. The Effect deep-research stream independently proves nested person and company answers. The backend records one in-memory run for equivalent JSON and SSE POSTs, and a disconnect does not cancel it.

FAIL if Effect sees an API-specific envelope, misses an event, receives a hash or provider detail in its snapshot, starts duplicate work, or turns a client disconnect into run cancellation.

### STK-004 — React adapter semantics

With the same `layerFromAPI` and deterministic handler, `SonarProvider` and `useSonar` produce an idle result, then the all-pending snapshot, then the same complete data tree as Effect and raw retrieval. React shares an identical request inside one provider and never exposes the raw hash, capability key, question transport, provider, cache, or run metadata. The test mounts a real React tree in the test-only in-memory DOM helper; it does not replace hooks with a copied reducer.

FAIL if the hook requires a separately mounted `QueryClientProvider`, flattens an entity-owned custom answer, uses a different request identity, refetches the same key, or exposes raw API/backend metadata.

### STK-005 — Eve adapter semantics

`researchSonar` receives the same Effect Layer and golden seed. Its foreground async generator yields the full pending and complete snapshots, with the same ordered data tree as the other surfaces. Its `toModelOutput` projection strips pending/terminal status, sources, timestamps, raw envelope hash, and backend-owned transport metadata while retaining resolved values and confidence. A schema-valid custom answer keeps its configured name even when that name resembles metadata. The static tool keeps `ttl`, field selection, and the question map developer-owned; it exposes only the seed to the model.

FAIL if Eve calls the wrong tier, emits only the projection instead of full snapshots, mutates the full snapshot while projecting, or leaks a raw response hash or backend-owned provider/cache/run detail outside a configured custom answer. Deep background behavior is covered by the Eve package verifier and is not duplicated here.

### STK-006 — Tenant and identity boundaries remain cross-surface

The raw API hash differs for tenant, route, and TTL changes and is stable for equivalent canonical values within one tenant, including reordered JSON properties and normalized seed whitespace. A known hash retrieved with a different tenant key returns the same safe 404 as an unknown hash. React and Eve never return that raw response hash as envelope metadata. Positive built-in cache sharing, custom tenant-scoped caching, negative TTL, and skipped-field behavior remain owned by the backend verifier; this condition checks only their public cross-surface boundary.

FAIL if a caller can select a tenant through request JSON, cross-tenant GET is distinguishable, client adapters expose the hash, or a surface computes a different identity for the same normalized request.

### STK-007 — Public package dependency boundaries

The workspace contains public `@usesonar/api`, `@usesonar/effect`, `@usesonar/react`, and `@usesonar/eve` packages plus private `@usesonar/backend`. Runtime dependency direction is one-way: Effect may use the public API, React and Eve may use the public Effect package, and no public package imports backend source, Next.js, providers, Node-only modules, or a sibling workspace source path. Backend remains private and exposes its production root plus an explicit testing seam; public packages never import it.

FAIL if a public manifest or source bypasses a public package export, makes backend public, or couples browser/Eve packages to server transport details.

### STK-008 — Workspace and release coverage

The root build TypeScript config, build/check scripts, CI package checks, and release enumerations include every published API, Effect, React, and Eve package. Each published package has its own release metadata and per-package changeset coverage; the private backend is never published. Runtime and development dependencies are inspected separately so a forbidden backend edge cannot hide in the dev graph. Generated `dist` output for API, Effect, React, and Eve is not tracked, and tests contain no disabled cases.

FAIL if any public package is omitted from a root enumeration, a changeset cannot account for a user-visible package, backend appears in a publish loop, or generated output/disabled test markers are used as proof.

### STK-009 — Required verification is offline and reproducible

The focused stack test passes with global `fetch` poisoned and Firecrawl, Parallel, SixtyFour, model, Vercel, and Sonar environment variables poisoned, so only injected in-memory transport and deterministic fake keys can be used. Settlement and reconnect assertions use backend promises and controls, never sleeps or timer polling. Repeating the deterministic golden fingerprint helper in two fresh processes produces the same canonical identity; the runtime path separately proves the same snapshots, event order, hashes for the same tenant/config, and adapter projections.

FAIL if the test depends on ambient network/environment state, logs a secret, uses `Bun.sleep`, `setTimeout`, or timer polling instead of harness controls, recursively invokes the test suite as its reproducibility probe, or cannot be rerun without external services.

## Commands and static evidence

Run from `/Users/knrz/Git/usesonar/monorepo`. The focused test is the first check so a cross-stack contract failure is not hidden by unrelated workspace work. Tests may fail before implementation; a failure is evidence of the remaining condition, not permission to weaken it.

```sh
bun test tests/stack.test.ts
bun run typecheck
just check
just check-packages
bun changeset status
git diff --check
```

Inspect the static package graph and release surface independently:

```sh
for package_dir in packages/api packages/effect packages/react packages/eve; do
  jq -e '.name | startswith("@usesonar/")' "$package_dir/package.json"
done
jq -e '.private == true and .name == "@usesonar/backend"' packages/backend/package.json
rg -n 'packages/(api|effect|react|eve)' tsconfig.json package.json justfile .github/workflows
rg -n "@usesonar/backend|packages/.*/src|from [\"']next|from [\"']node:" packages/api/src packages/effect/src packages/react/src packages/eve/src
git ls-files 'packages/*/dist/**'
```

The last command must not report generated output for newly implemented packages, and forbidden-import inspection must only find deliberate test-only references documented by the package verifiers. Use each package’s own `VERIFY.md` for its detailed schema, cache, protocol, React, Eve, build, and packed-artifact proof; do not duplicate those package conditions here.

Optional model evaluation is separate and informational:

```sh
# Optional only; never required for the local verdict.
bun packages/eve/verify/live-responses.ts
```

## Verdict format

Print exactly one line per required condition in ID order, followed by one overall line. A failed condition gets the shortest concrete reason; do not replace a failed condition with `SKIP` because another condition failed.

```text
PASS STK-001 one wire contract
PASS STK-002 backend to raw API
PASS STK-003 API SSE to Effect
PASS STK-004 React adapter
PASS STK-005 Eve adapter
PASS STK-006 tenant and identity boundaries
PASS STK-007 package dependency boundaries
PASS STK-008 workspace and release coverage
PASS STK-009 offline reproducibility
OVERALL PASS Sonar cross-stack
```

Replace `PASS` with `FAIL` and append ` — <reason>` for any condition that does not hold. The overall line is `OVERALL FAIL Sonar cross-stack — STK-NNN` when any required condition fails. Report the optional model evaluation as `PASS`, `FAIL`, or `UNAVAILABLE` separately; it never changes the required overall verdict.

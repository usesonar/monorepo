# Verify `@usesonar/api`

Use this verifier to decide whether the published `@usesonar/api` package satisfies its local, network-independent contract. Run it from the repository root at `/Users/knrz/Git/usesonar/monorepo` against the implementation and the packed artifact. Do not edit the verifier or its tests to make an implementation pass.

The required conditions are immutable for this milestone. A condition passes only when every statement under its ID is true. A repository-authored test name, a README claim, or a successful build does not substitute for the observable behavior described here.

## Required conditions

### V-API-00 — Verifier integrity

- `packages/api/VERIFY.md`, `packages/api/test/**/*.ts`, and `packages/api/src/**/*.test.ts` contain no `.only`, `.skip`, or `.todo` calls and no disabled assertions.
- The test fixtures use injected `fetch` functions and real `Request`, `Response`, and `ReadableStream` objects. They do not call a hosted endpoint.
- The implementation does not modify or conditionally bypass verifier behavior.

Report `PASS V-API-00 verifier-integrity` only if all three statements hold.

### V-API-01 — Wire schemas and request validation

- The root export exposes same-name Zod v4 values and types for `JSONValue`, `SonarSeed`, `TTL`, `ResearchRequest`, `DeepResearchRequest`, `Field`, `SonarSnapshot`, `SonarResponse`, `SnapshotEvent`, `FieldEvent`, `CompleteEvent`, and `SonarEvent`.
- A seed satisfies at least one identity branch: `linkedinURL`, `fullName` plus `xURL`, or `fullName` plus `email`. Parsing trims `linkedinURL`, `xURL`, and `email` before returning them and accepts ordinary and punycode email domains. Malformed dot-atoms, empty or consecutive domain labels, and DNS labels with a leading or trailing hyphen fail, including nested labels such as `a@foo-.example.com`. Email limits are measured after trimming in UTF-8 bytes: a local part accepts 64 and rejects 65, a DNS label accepts 63 and rejects 64, and a domain accepts 253 and rejects 254. `domain` is any non-empty trimmed string, `context: Record<string, JSONValue>` is optional, and fields from multiple branches can coexist.
- A TTL is a compact integer followed by `ms`, `s`, `m`, `h`, `d`, or `w`. Equivalent durations below 12 hours or above 365 days fail.
- Research accepts person fields `linkedin`, `title`, `x`, and `github`, and company fields `domain`, `name`, `logo`, `colors`, `location`, `description`, and `funding`. Deep research accepts person field `phone` and company field `legalName`. Wrong-tier fields fail locally before `fetch` runs.
- Runtime decoding ties resolved values to their catalog paths. `linkedin`, `x`, `github`, and `logo` require absolute URLs; `title`, `domain`, `name`, `description`, `phone`, and `legalName` require strings; and `colors`, `funding`, `location`, and custom answers accept any `JSONValue`. The directly exported `FieldEvent` and `SonarEvent` schemas enforce the same families and reject unknown or wrong-catalog dotted paths.
- Custom question keys are camelCase, exclude `ttl`, `person`, `company`, `research`, and `deepResearch`, and contain non-empty questions. Their result fields appear at the top level of `data` after `person` and `company`.
- The public `Field<T>` discriminated union has exactly four schema options, one each for the `pending`, `resolved`, `notFound`, and `skipped` variants from `SPEC.md`. Runtime decoding rejects invalid confidence, timestamps, reasons, JSON values, extra variant fields, and a `complete` snapshot that contains a pending field.

Report `PASS V-API-01 wire-contract` only if all seven statements hold.

### V-API-02 — Ky client and JSON transport

- `createSonar(options)` requires an absolute `baseURL` and exactly one non-empty `publishableKey` or `secretKey`.
- `createSonar` returns the `KyInstance` from `ky.create` directly. Caller headers, hooks, retry and timeout options, injected `fetch`, and `.extend()` behavior remain effective.
- `createResearch` POSTs the validated JSON body to `/v1/research`; `createDeepResearch` POSTs it to `/v1/deepResearch`; and `retrieveSonar` GETs `/v1/{encodedHash}`. Each create helper parses the request once into an owned normalized copy before transport, so changing getters or caller mutation during a delayed fetch cannot alter the sent body or the request-relative response check. Retrieval rejects the empty string and URL dot segments `.` and `..` locally, while otherwise opaque hashes such as strings containing slashes remain supported through percent-encoding.
- All requests carry `Authorization: Bearer <capability key>`. JSON helpers force `Accept: application/json` and `Content-Type: application/json` case-insensitively even when instance headers conflict, while unrelated instance headers and hooks remain effective.
- JSON helpers decode untrusted responses with the exported Zod schemas. They reject malformed JSON, missing hashes, invalid fields, impossible completion states, and empty responses. Request-derived leaf equality compares own properties, so an inherited `Object.prototype` key cannot stand in for a requested custom answer. `retrieveSonar` keeps its nested `person` and `company` objects closed to the combined research and deep-research catalogs while allowing JSON-valued custom answers only as top-level `data` fields.
- Raw HTTP failures remain Ky errors. In particular, a JSON HTTP error preserves its status and Ky's parsed `HTTPError.data`; the package does not replace it with an Effect error.
- Replacing `globalThis.fetch` with a throwing function does not affect a client configured with an injected `fetch`.

Report `PASS V-API-02 json-transport` only if all seven statements hold.

### V-API-03 — SSE framing and event protocol

- `streamResearch` and `streamDeepResearch` POST the same validated request bodies to their tier routes, force `Accept: text/event-stream` and `Content-Type: application/json` case-insensitively even when instance headers conflict, preserve unrelated instance headers and hooks, and return `Promise<ReadableStream<SonarEvent>>`.
- The parser uses real response bytes and accepts arbitrary chunk boundaries, including a split multibyte UTF-8 code point, lines terminated by LF, CRLF, or CR, comments, and multiline `data` fields. Its 1 MiB event limit counts encoded UTF-8 bytes, not JavaScript characters, and checks a paired CRLF byte before a following blank delimiter can reset the event count.
- The first emitted event is `{ id, type: "snapshot", snapshot }`, and the snapshot contains exactly every requested field as an own property in the `pending` state; inherited prototype keys do not satisfy the request. Indexed `{ id, type: "field", path, field }` events settle those exact paths, and one `{ id, type: "complete", hash }` event ends the stream only after every requested leaf is terminal.
- Event IDs are canonical non-negative decimal integers serialized as strings, begin at `"0"`, and advance contiguously for every newly accepted event. On a reconnect, one replay of an already accepted ID may be suppressed only when its event name and parsed JSON are semantically identical; JSON object key order does not affect that comparison. Malformed or colliding accepted IDs fail before suppression, and a second identical replay in the same connection fails.
- The parser rejects a missing initial snapshot, a missing ID, an unknown event name, malformed JSON, an invalid payload, a repeated ID, a duplicate completion, a field after completion, an event larger than 1 MiB, and EOF before completion. Post-complete events already present in the same parser feed fail, including an otherwise suppressible old replay after a reconnect completes; after a valid complete event, the stream closes promptly and cancels unread upstream bytes without waiting for EOF or inspecting later chunks. Rejecting malformed protocol data also actively cancels an established response body even when that body remains open.
- The normalized response media type must equal `text/event-stream`; parameters such as `charset=utf-8` are allowed, while prefix lookalikes such as `text/event-streaming` fail. A null response body or a non-success HTTP response also fails visibly, including when the supplied Ky instance has `throwHttpErrors: false`. The implementation does not use native `EventSource`.

Report `PASS V-API-03 stream-protocol` only if all six statements hold.

### V-API-04 — Reconnection, duplicate suppression, and cancellation

- An interrupted stream reconnects at most three times by default, for four total connection attempts. A caller can set `maxReconnects` to a different non-negative integer.
- Each reconnect sends the latest accepted SSE ID in `Last-Event-ID`. Replayed events with already accepted IDs do not reach the consumer or advance the resume point.
- Protocol errors do not reconnect. Ky `NetworkError` and `TimeoutError` failures while acquiring a reconnect consume one reconnect attempt and continue while allowance remains. A raw caller `TypeError`, including one thrown from a reconnect hook, surfaces unchanged without another attempt or `SonarStreamError` wrapping. Exhausting the allowance through body interruptions or retryable acquisition failures errors the returned stream with `SonarStreamError`, never a raw network error.
- Aborting before response acquisition rejects immediately. Aborting while consuming a body errors the stream with the original abort reason, cancels the active response body, and starts no reconnect or timer. A body cancellation promise that stalls or rejects cannot delay or replace that result.
- Cancelling the returned stream propagates to the active response body and leaves no reader locked after the caller releases its reader. Every internal body cancellation is fire-and-forget with rejection handling, so rejected cleanup never becomes an unhandled rejection.

Report `PASS V-API-04 reconnect-cancel` only if all five statements hold.

### V-API-05 — Static type contract

- `createSonar` is assignable to `KyInstance`, and its options require exactly one capability key at compile time.
- Literal request arrays reject wrong-tier fields and invalid seed branches at compile time.
- The root exports `question<Answer = JSONValue>(prompt)`, which returns the original prompt string with compile-time answer metadata. Branded questions become exact top-level `Field<Answer>` results; unbranded and default-branded questions become `Field<JSONValue>`.
- Full literal requests infer only their selected built-in fields and retain every mixed custom question. Question brands survive nested question-map spreads and whole-request spreads; wrong-tier fields and invalid seed branches fail at compile time.
- Finite create question maps declared as interfaces or type aliases produce the same exact required fields. Broad `Record<string, string>` and request annotations remain accepted, with arbitrary custom reads exposed as `Field<JSONValue> | undefined`. Union, optional-keyed, callable, constructable, reserved, malformed, and numeric or symbol key hybrid maps fail at compile time.
- Broadly annotated request arrays expose every possible tier catalog field as optional, while literal tuples remain exact and required. A union of literal selection tuples distributes into a union of exact result maps rather than requiring every possible key, and a singleton tuple whose element is a field union exposes those possible fields as optional. Mutable and readonly tuples containing `any` fail for every research and deep-research person and company selection.
- Default retrieval exposes only the closed partial person and company catalogs. `retrieveSonar<Answers>` is the sole custom-answer typing mechanism and adds exact top-level `Field<Answer>` keys for a finite interface or type alias with required lower-camel keys, without widening the nested built-in catalogs. Open string-indexed, optional-keyed, callable, constructable, reserved, malformed, numeric or symbol key hybrid, and union maps fail at compile time, including disjoint unions whose branches are each valid alone.
- Known scalar built-ins remain their catalog types, while rich built-ins remain `JSONValue`. Custom-answer typing cannot replace `person` or `company`.

Report `PASS V-API-05 type-contract` only if all eight statements hold and the `@ts-expect-error` directives are all exercised.

### V-API-06 — Package and dependency boundary

- `packages/api/package.json` names `@usesonar/api`, publishes neutral ESM with declarations, sets `sideEffects` to `false`, and exposes the supported root entry point.
- Runtime dependencies are exactly `ky@2.0.2`, `zod@4.4.3`, and `eventsource-parser@4.1.0`. The source and packed JavaScript do not import Effect, Next.js, provider SDKs, Node built-ins, workspace source paths, or a second SSE parser.
- The package exports the locked functions `createSonar`, `createResearch`, `createDeepResearch`, `streamResearch`, `streamDeepResearch`, and `retrieveSonar`, the `question` typing helper, the locked wire schemas and types, and `SonarStreamError`. Extra exports exist only when they provide custom config-derived typing; parser internals and module-level clients remain private.
- The packed artifact contains package metadata, license and package documentation, and expected `dist` files. It excludes source, verifier files, tests, generated maps that reveal source when maps are not part of the package policy, and unrelated workspace files.
- Generated `dist` output remains untracked.

Report `PASS V-API-06 package-boundary` only if all five statements hold.

### V-API-07 — Independent consumer and workspace integration

- The repository typecheck, API tests, API build, `publint`, and Are the Types Wrong pass.
- An ESM consumer in a temporary directory installs the packed tarball, imports only `@usesonar/api`, and passes one injected-fetch JSON request and one byte-stream SSE request against `dist`.
- A browser-target bundle of that consumer succeeds and contains no Node built-in import or `EventSource` reference.
- The root TypeScript references, build and package-check scripts, CI dry-pack checks, release version staging, registry verification, and tag verification include `@usesonar/api` wherever they enumerate published packages.
- A changeset covers the new public package, and `git diff --check` passes.

Report `PASS V-API-07 consumer-packaging` only if all five statements hold.

## Commands

Run the focused checks first so a contract failure is distinct from an unrelated workspace failure:

```sh
rg -n '\.(only|skip|todo)\s*\(' packages/api/VERIFY.md packages/api/test packages/api/src -g '*.ts' -g '*.md'
bun test packages/api/test packages/api/src/type.test.ts
bun run typecheck
bun run --filter @usesonar/api build
bunx publint packages/api
bunx @arethetypeswrong/cli --pack packages/api --profile esm-only
git diff --check
git status --short packages/api
```

The first `rg` command must return no matches. Inspect the exact dependency versions and forbidden runtime imports independently:

```sh
jq -e '.dependencies == {"eventsource-parser":"4.1.0","ky":"2.0.2","zod":"4.4.3"}' packages/api/package.json
rg -n 'EventSource|node:|@usesonar/(effect|backend)|next/|from "effect"|from "@effect' packages/api/src packages/api/dist
git ls-files packages/api/dist
```

The forbidden-import `rg` and `git ls-files` commands must return no matches. Then run the repository command surface:

```sh
just check
just build
just check-packages
bun changeset status
```

Build before inspecting the tarball. Pack from `packages/api` with lifecycle scripts disabled, send the tarball to a directory created by `mktemp -d`, and inspect `npm pack --json` plus `tar -tf` output. In a second temporary directory, create an ESM package that depends on the tarball. Its smoke test must replace ambient `fetch`, pass an injected `fetch`, inspect the `Request` received by that injection, decode a real JSON `Response`, and consume a real fragmented SSE `ReadableStream`. Bundle that same consumer for the browser and inspect the generated imports.

## Hosted-only claims

The required conditions prove client-side validation, request construction, runtime decoding, byte-level SSE behavior, bounded reconnection, cancellation, typing, and packaging. They do not prove any deployed service behavior.

Defer these claims until a hosted verifier runs against an authenticated deployment:

- capability-key validity, origin allowlists, CORS, tenant isolation, and rate limits;
- server-side content hashing, POST idempotency, durable replay retention, and Redis persistence;
- provider accuracy, source quality, confidence calibration, provider timeouts, and deep-research completion time;
- per-field cache freshness, billing, credit accounting, and concurrent workflow behavior;
- production routes, DNS, availability, and compatibility with a deployed server revision.

Do not fail this package verifier because these claims are deferred. Do fail any implementation or documentation that presents a deferred claim as proven by injected fixtures.

## Verdict format

Print exactly one line for every required condition, in this order. Replace `PASS` with `FAIL` and append ` — <concise reason>` when any statement under that condition fails.

```text
PASS V-API-00 verifier-integrity
PASS V-API-01 wire-contract
PASS V-API-02 json-transport
PASS V-API-03 stream-protocol
PASS V-API-04 reconnect-cancel
PASS V-API-05 type-contract
PASS V-API-06 package-boundary
PASS V-API-07 consumer-packaging
```

Print `OVERALL PASS @usesonar/api` only when all eight required lines are `PASS`. Otherwise, print `OVERALL FAIL @usesonar/api`, followed by the failed condition IDs. Report hosted-only checks separately as `DEFERRED` and never count them toward the local overall verdict.

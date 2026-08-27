# Sonar product contract (v3)

Sonar turns a thin identity seed and a requested schema into progressive person and company data. This version defines one observable contract across the raw API, Effect, React, Eve, and the private backend.

The repository implements the package foundation and a deterministic in-memory backend. A hosted service, provider integrations, durable storage, billing, and the `apps/next` product remain outside this scope.

## Surfaces and dependency direction

| Workspace | Visibility | Responsibility |
| --- | --- | --- |
| `@usesonar/api` | Public | Zod wire schemas, raw Ky client, JSON helpers, and POST-SSE transport |
| `@usesonar/effect` | Public | Effect 4 service, Layers, Streams, typed errors, protocol reducer, and deterministic scenarios |
| `@usesonar/backend` | Private | Effect Fetch handler and deterministic in-memory auth, run, hash, cache, and provider seams |
| `@usesonar/react` | Public | React provider and hooks backed by TanStack streamed queries |
| `@usesonar/eve` | Public | Static and dynamic Eve tool factories |
| `apps/next` | Private | Reserved for the hosted product; not part of the implemented request path |

Dependencies flow from API to Effect, then from Effect to React and Eve. Public packages never import the private backend, app code, provider SDKs, or sibling source files.

## Shared request contract

### Identity seed

A seed must satisfy at least one of three prerequisites:

```ts
type SonarSeed = (
  | { linkedinURL: string }
  | { fullName: string; xURL: string }
  | { fullName: string; email: string }
) & {
  domain?: string
  context?: Record<string, JSONValue>
}
```

Supported identity fields can coexist, so a LinkedIn seed can also carry a name, an X URL, an email address, or a domain. `domain` and `context` add evidence but cannot form a seed by themselves. URLs and email addresses must be valid, names and domains must be non-empty, unknown properties are rejected, and `context` must contain JSON values.

### TTL

`ttl` is a compact integer duration with one of these units: `ms`, `s`, `m`, `h`, `d`, or `w`. The effective duration must be between 12 hours and 365 days, inclusive. Values such as `12h`, `7d`, and `52w` are valid; decimals, spaces, `11h`, `366d`, and `1y` are invalid.

### Tiers and fields

Person fields appear before company fields on every surface.

| Tier | Person fields | Company fields | Custom question map |
| --- | --- | --- | --- |
| Research | `linkedin`, `title`, `x`, `github` | `domain`, `name`, `logo`, `colors`, `location`, `description`, `funding` | `research` |
| Deep research | `phone` | `legalName` | `deepResearch` |

A request cannot use a field from the other tier, and each built-in selection must be unique. Custom keys must be lower-camel identifiers, questions must be non-empty strings, and `ttl`, `person`, `company`, `research`, and `deepResearch` are reserved.

### Flat request shape

The request keeps its tier-specific question map and does not wrap configuration in another object:

```ts
type ResearchRequest = {
  seed: SonarSeed
  ttl: TTL
  person: readonly ResearchPersonField[]
  company: readonly ResearchCompanyField[]
  research: Readonly<Record<string, string>>
}

type DeepResearchRequest = {
  seed: SonarSeed
  ttl: TTL
  person: readonly DeepResearchPersonField[]
  company: readonly DeepResearchCompanyField[]
  deepResearch: Readonly<Record<string, string>>
}
```

### Typed questions

`@usesonar/api` owns `question<Answer>(prompt)`, and `@usesonar/effect` re-exports it for Effect, React, and Eve consumers. The helper returns the same prompt string with compile-time answer metadata, so a configured `accountSignals: question<AccountSignals>("...")` produces a top-level `Field<AccountSignals>`. A plain string or `question(prompt)` produces `Field<JSONValue>`. Selected built-ins retain their exact catalog types, and unselected built-ins remain absent. The brand declares the caller's expected TypeScript type; runtime custom answers are JSON-validated rather than structurally checked against that type.

API create operations, Effect operations, React hooks, and static Eve factories derive answer types from their question map; they do not accept a separate operation-level answer map. Literal configs, spreads of literal configs, and `satisfies` preserve question brands and exact field selection. Finite question maps declared as interfaces or type aliases produce exact required fields. A broad annotation such as `ResearchConfig` or `Record<string, string>` erases question brands and exposes arbitrary custom reads as `Field<JSONValue> | undefined`; broad selection arrays similarly make catalog reads optional while preserving each catalog value type. Union, optional-keyed, callable, constructable, and numeric or symbol key hybrid maps are rejected.

Raw `retrieveSonar(client, hash)` has no config from which to derive custom keys, so its default type does not claim any. `retrieveSonar<Answers>(client, hash)` is the one safe explicit map for callers that already know those keys. Dynamic Eve is the other exception because the model owns the question map at execution time; its type-only explicit map adds optional possible fields without requesting those keys or runtime-validating their answer shapes. Both explicit maps require finite, non-union interfaces or type aliases with required lower-camel keys. They reject callable or constructable maps and numeric or symbol key hybrids. Without an explicit dynamic map, Eve exposes optional built-in catalogs but does not invent custom names.

## Shared result contract

Every requested leaf has exactly one of four states:

```ts
type Field<T = JSONValue> =
  | { status: "pending" }
  | {
      status: "resolved"
      value: T
      confidence: number
      sources: string[]
      resolvedAt: string
    }
  | {
      status: "notFound"
      reason?: "timeout" | "identityFailed" | "providerEmpty"
    }
  | {
      status: "skipped"
      reason: "consumerEmail" | "noPersonSeed" | "noCompanySeed"
    }
```

The first snapshot contains every requested leaf as `pending`. A leaf then settles once to `resolved`, `notFound`, or `skipped`. The snapshot remains `pending` through field settlement and becomes `complete` only after an explicit completion event verifies that no field remains pending.

Built-in fields stay nested, while custom answers become top-level fields after `person` and `company`:

```ts
type SonarSnapshot = {
  status: "pending" | "complete"
  data: {
    person: Record<string, Field>
    company: Record<string, Field>
    [customAnswer: string]: Field | Record<string, Field>
  }
}

type SonarResponse = SonarSnapshot & { hash: string }
```

For a request with `research: { accountSignals: "..." }`, the result is `data.accountSignals`, not `data.research.accountSignals`. Only the raw HTTP/API response can expose `hash`; Effect, React, and Eve return `SonarSnapshot` without it.

## HTTP and SSE protocol

The raw service contract has three routes:

```text
POST /v1/research
POST /v1/deepResearch
GET  /v1/{hash}
```

Every route requires `Authorization: Bearer <capability>`. If allowed origins are configured for a publishable capability, requests using that capability must include a matching `Origin`. Secret-capability requests can omit `Origin`. The capability determines the tenant; request JSON cannot select one.

A POST with `Accept: application/json` returns the current `SonarResponse`. Reposting a canonically identical request within one tenant names the same in-memory run. `GET /v1/{hash}` returns the latest raw snapshot for the authenticated tenant, while a foreign or unknown hash returns the same safe `404` response.

A POST with `Accept: text/event-stream` emits:

```ts
type SonarEvent =
  | { id: string; type: "snapshot"; snapshot: SonarSnapshot }
  | { id: string; type: "field"; path: string; field: Field }
  | { id: string; type: "complete"; hash: string }
```

The snapshot is event ID `0` and contains the full all-pending data tree. Field IDs are contiguous from `1`, each field event is terminal, and `complete` appears once after every requested path settles. No event is accepted after completion.

The raw client reconnects an interrupted POST-SSE stream up to three times by default. It sends the last accepted ID in `Last-Event-ID`, suppresses replayed IDs, and fails on duplicates within one connection, malformed events, premature completion, or a stream that exhausts its reconnect budget. Cancelling the returned stream or aborting its signal stops transport work immediately; disconnecting a client does not cancel the backend run.

## Identity, authorization, and cache boundaries

The backend computes run identity as:

```text
HMAC-SHA256(serverSecret, tenantId + route + canonicalSeed + canonicalConfig)
```

Canonicalization normalizes seed strings and URLs, recursively orders JSON object keys, orders selected fields, and includes the tier-specific questions and TTL. Changing the tenant, route, or TTL changes the hash. Equivalent property order, field order, casing, and surrounding whitespace normalize to the same request identity where the seed rules permit it.

The hash is tenant-derived and unguessable without the server secret. Possessing another tenant's hash does not grant access, and cross-tenant reads are indistinguishable from unknown hashes.

Fields cache independently:

- Positive built-in fields can be reused across tenants when their identity and requested TTL remain fresh.
- Custom answers are tenant-scoped because customer questions and answers cannot cross that boundary.
- A `notFound` field expires after the shorter of the request TTL and five minutes.
- A `skipped` field is never cached.
- Positive freshness uses the field's `resolvedAt`, not its cache-write time.

## Raw API package

`@usesonar/api` owns the Zod schemas and transport. `createSonar(options)` requires an absolute `baseURL` and exactly one non-empty `publishableKey` or `secretKey`, then returns the actual `KyInstance`. Callers retain Ky headers, hooks, retry, timeout, custom `fetch`, and `.extend()` behavior; Sonar sets the bearer authorization header from the selected capability.

The JSON helpers are `createResearch`, `createDeepResearch`, and `retrieveSonar`. The stream helpers are `streamResearch` and `streamDeepResearch`. All helpers validate untrusted protocol data. HTTP failures retain Ky error behavior, schema failures retain Zod behavior, and SSE framing or protocol failures use `SonarStreamError`.

## Effect package

`@usesonar/effect` targets Effect `4.0.0-rc.112`. `SonarClient` exposes research and deep-research Streams plus a retrieve Effect:

```ts
type SonarClientService = {
  research(request): Stream.Stream<SonarSnapshot, SonarClientError>
  deepResearch(request): Stream.Stream<SonarSnapshot, SonarClientError>
  retrieve(hash, config): Effect.Effect<SonarSnapshot, SonarClientError>
}
```

`layer(options)` creates the raw API capability lazily with the same options as `createSonar`, while `layerFromAPI(client)` adapts an existing Ky instance. Tagged failures are `RequestError`, `TransportError`, `HTTPError`, and `ProtocolError`.

The Effect reducer keeps snapshots pending through terminal field events. A required `CompleteEvent` checks that no pending leaf remains before changing the snapshot to complete, and any event after completion fails.

`@usesonar/effect/testing` exports isolated `Scenario`, `scenarioLayer`, and `SonarTestProbe` primitives. They provide deterministic keyless Streams and request/interruption inspection without reading the environment or calling a network.

## React package

`@usesonar/react` exports `SonarProvider`, `useSonar`, `useDeepSonar`, `SonarProviderProps`, and `SonarResult`. The provider accepts an Effect `Layer<SonarClient>` and owns one TanStack Query client and one Effect runtime, so consumers do not mount a separate `QueryClientProvider`.

Both hooks accept their tier configuration and return:

```ts
type SonarResult<Data> = {
  resolve(seed: SonarSeed): void
  data: Data | null
  status: "pending" | "complete" | undefined
  loading: boolean
  error: SonarClientError | null
}
```

Before `resolve`, data and error are `null`, status is `undefined`, and loading is false. The hooks use TanStack `experimental_streamedQuery`; identical canonical requests share one active query and completed result inside a provider. Cached results remain reusable for five minutes, separate providers remain isolated, and resolving a new key switches to the latest request and interrupts the superseded stream. Automatic retries and focus, reconnect, mount, and stale refetches are disabled.

## Eve package

`@usesonar/eve` exports only `researchSonar` and `deepResearchSonar`. Both factories produce Eve `0.45.1` tools whose schemas, descriptions, execution, and model projection derive from one validated config.

Static tools keep TTL, selected fields, and questions under developer control, so model input contains only `SonarSeed`:

```ts
import { question } from "@usesonar/effect"
import { researchSonar } from "@usesonar/eve"

type AccountSignals = {
  intent: "low" | "medium" | "high"
  evidence: string[]
}

export default researchSonar({
  ttl: "7d",
  person: ["title"],
  company: ["domain"],
  research: {
    accountSignals: question<AccountSignals>("Which buying signals are publicly visible?"),
  },
})
```

`dynamic: true` keeps TTL under developer control but moves the person fields, company fields, and matching question map into model input. Dynamic input must still select at least one valid built-in or custom field.

Research and deep research run in the foreground by default and stream full progressive snapshots. Deep research can opt into Eve background semantics with `{ execution: "background" }`; that form drains the Effect stream and returns the final full snapshot normally. It does not create a delegated receipt, polling executor, or callback reconciliation path.

Eve runtime consumers receive the full snapshot. `toModelOutput` includes only resolved leaves as `{ value, confidence }`, preserves nested `person` and `company` fields plus top-level custom answers, and omits empty containers and unresolved fields. Static tools project only the factory's configured custom keys. Dynamic tools project every schema-valid, non-reserved top-level answer they receive; the upstream Effect protocol guarantees that those data keys came from the request. The projection ignores envelope and transport extras, including a raw envelope hash, and strips each field's `status`, `sources`, and `resolvedAt`. A validated custom answer named `provider`, `cache`, `jobId`, or `hash` remains answer data. Projection never mutates the full result.

Without an injected Layer, Eve reads `SONAR_BASE_URL` and `SONAR_SECRET_KEY` only when execution starts. Tests inject a Layer, so imports and factory creation never require credentials or make a network request.

## Private backend

`@usesonar/backend` is an Effect implementation seam, not a published package. Its production root exports the `SonarBackend` Context service, `layer`, and `createSonarHandler`. The `@usesonar/backend/testing` subpath provides fake capability tenants, scenarios, time, cache controls, settlement controls, probes, and cleanup around that same Fetch handler.

The implemented backend is deliberately in-memory and deterministic. It proves validation, capability-derived tenancy, HMAC identity, idempotent runs, SSE replay, terminal gates, field-cache boundaries, safe errors, and Effect scope cleanup. It does not claim provider accuracy, Redis or workflow durability, hosted key management, or deployed origin enforcement.

## Verification

Required verification is offline and reproducible:

```sh
bun test tests/stack.test.ts
bun run typecheck
just check
just check-packages
bun changeset status
git diff --check
```

Each package's `VERIFY.md` defines its detailed verdict. The optional Eve live smoke test calls the OpenAI Responses API with `gpt-5.6-luna`, low reasoning effort, `store: false`, one attempt, and an injected deterministic Sonar Layer. It reports `UNAVAILABLE` without `OPENAI_API_KEY` and never affects the required verdict:

```sh
bun packages/eve/verify/live-responses.ts
```

## Deferred work

- Build the hosted application and route integration in `apps/next`.
- Select and verify live enrichment providers.
- Add durable storage and orchestration without changing the public contract.
- Build capability issuance, origin management, rate limits, usage accounting, and billing.
- Deploy the service behind the already-connected `usesonar.dev` Vercel domain and verify the live route.
- Bootstrap and publish the four public npm packages.

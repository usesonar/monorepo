# Sonar backend

`@usesonar/backend` is the private implementation seam behind Sonar's HTTP contract. It owns capability authentication, tenant-scoped run identity, in-memory orchestration and caching, SSE replay, provider normalization, and the deterministic test harness. It is a workspace dependency, not an npm package, and its provider modules are not part of any public Sonar API.

The backend implements the contract in [`../../SPEC.md`](../../SPEC.md). The wire schemas still belong to `@usesonar/api`, so the backend parses requests and public snapshots with those exported schemas instead of maintaining a second contract.

## Package boundary

The production root exports four pieces:

- `SonarBackend` is the Effect `Context.Service` whose `fetch` method returns an `Effect<Response>`.
- `layer` adapts an injected `BackendEnvironment` into `SonarBackend`. This lower-level seam exists so the test harness can exercise the production handler with a deterministic engine.
- `layerWithProviders` composes the implemented provider adapters, the provider gateway, and one `BackendEngine` into a `Layer<SonarBackend>`.
- `createSonarHandler` turns a backend Layer into a `(Request) => Promise<Response>` Fetch handler.

The `@usesonar/backend/testing` subpath exports `createBackendTestHarness`, `FakeScenario`, and `TestTenant`. Keep settlement controls, fake time, cache mutation, and inspection probes on that subpath. Other workspaces must not import `src/engine.ts`, `src/providers.ts`, or another backend source file directly.

This package does not provide durable storage, distributed coordination, hosted capability issuance, rate limiting, billing, or a deployment adapter. Runs, cache entries, provider job mappings, and capability configuration live in memory and disappear with the process. The implemented provider runner handles custom research, custom deep research, and four company-site fields; the other built-in fields still depend on the engine's deterministic settlement seam and do not have a production resolver here.

## Compose the backend

Pass every credential and tenant explicitly at the hosting boundary. The backend never reads environment variables or creates module-level credential state.

```ts
import { createSonarHandler, layerWithProviders } from "@usesonar/backend"
import type { ProviderLayerOptions } from "@usesonar/backend"

type RuntimeConfig = {
  readonly firecrawlAPIKey: string
  readonly parallelAPIKey: string
  readonly serverSecret: string
  readonly sixtyFourAPIKey: string
  readonly tenants: ProviderLayerOptions["tenants"]
}

export const makeSonarFetch = (config: RuntimeConfig) =>
  createSonarHandler(
    layerWithProviders({
      firecrawl: { apiKey: config.firecrawlAPIKey },
      parallel: { apiKey: config.parallelAPIKey },
      serverSecret: config.serverSecret,
      sixtyFour: { apiKey: config.sixtyFourAPIKey },
      tenants: config.tenants,
    })
  )
```

Resolve `RuntimeConfig` from the hosting system's secret manager or environment boundary before you call `makeSonarFetch`. You can also set provider base URLs, the Parallel result timeout, the Firecrawl request timeout, and the SixtyFour polling interval and limit through `ProviderLayerOptions`; this package supplies defaults but does not own deployment policy.

`layerWithProviders` builds the runtime in one direction:

1. The Firecrawl and Parallel SDK Layers, the SixtyFour Ky transport, the provider clock, and the in-memory provider-run store supply private dependencies.
2. `ProviderGateway` submits and normalizes provider work without exposing provider-native jobs or errors.
3. `makeProviderRunner` owns the gateway's `ManagedRuntime` and presents abortable promises to `BackendEngine`.
4. `SonarBackend` exposes the engine through the production Fetch handler, and each handler evaluation acquires and releases its Effect scope.

## Request and run lifecycle

The handler serves `POST /v1/research`, `POST /v1/deepResearch`, and `GET /v1/{hash}`. A POST must contain JSON that matches the route-specific `@usesonar/api` schema and must negotiate either `application/json` or `text/event-stream`.

Authentication comes from `Authorization: Bearer <capability>`. Each configured capability names one tenant, so request JSON cannot select a tenant. A publishable capability with a nonempty `allowedOrigins` list requires a matching `Origin`; a secret capability can omit `Origin`. Authentication and validation failures return small public errors without private causes.

For a valid POST, the engine computes this identity:

```text
HMAC-SHA256(serverSecret, tenantId + route + canonicalSeed + canonicalConfig)
```

Canonicalization normalizes seed strings and URLs, orders JSON object keys, and includes the selected fields, entity-owned question maps, and TTL. The engine reuses an existing in-memory run for the same hash, so concurrent JSON and SSE requests attach to one orchestration. A different tenant, route, or TTL produces a different hash, and a foreign hash returns the same `404` body as an unknown hash.

Every requested leaf starts as `pending` and can settle once as `resolved`, `notFound`, or `skipped`. Provider failures become `notFound` with either `timeout` or `providerEmpty`; provider error bodies, job IDs, and provider names never enter the public snapshot. The run becomes `complete` only after every requested path is terminal.

An SSE subscription receives snapshot event `0`, contiguous terminal field events, and one complete event. `Last-Event-ID` resumes from the next stored event. Disconnecting a client finalizes only that subscription because the run and its provider work belong to the backend; closing the backend closes active streams, aborts active provider runners, and disposes their runtime.

## Identity gates and cache scope

Company work needs a domain from `seed.domain`, a non-consumer email domain, or a resolved `company.domain` field. If a custom-only company request has no company anchor, the engine settles its custom fields as `skipped/noCompanySeed` instead of leaving them pending. If a requested `company.domain` settles unsuccessfully and no seed domain exists, remaining company fields settle as `notFound/identityFailed`. A consumer email also settles `person.phone` as `skipped/consumerEmail` without provider work.

The cache stores fields independently because each field has a different reuse boundary:

- Resolved built-in fields can cross tenant boundaries for the same normalized subject, while custom answers include the tenant, route, entity, tier, key, authored schema or prompt, and subject in their cache identity.
- A resolved field remains fresh according to its own `resolvedAt` and the request TTL, so writing an old result into the cache does not make that result fresh again.
- A `notFound` entry expires after the shorter of the request TTL and five minutes, while a `skipped` field is never cached.

This cache and the run map are process-local. Do not infer cross-process idempotency or durability from the deterministic in-memory behavior.

## Provider routing and failure policy

The engine creates at most one custom batch per entity and tier. Public responses contain normalized values, confidence, sources, and timestamps; the following routing stays private:

| Work | Adapter behavior | Retry and idempotency constraint |
| --- | --- | --- |
| `person.research` and `company.research` | Parallel receives one Task Run with the `core-fast` processor and an object output schema assembled from the entity's questions. The adapter accepts native object data from `output.content`, validates each value against its JSON Schema, and derives field-specific sources and confidence from `output.basis`. | The Parallel request uses the backend `requestId` as the SDK idempotency key, disables SDK retries, and stores the returned run ID before fetching the result. |
| `person.deepResearch` and `company.deepResearch` | SixtyFour receives `medium` People Intelligence or Company Intelligence work, polls `job-status/{id}`, and accepts only nonblank string leaves from `structured_data`. | The Ky transport sets `retry: 0`, and the gateway stores a confirmed task ID. SixtyFour submissions do not have a documented idempotency key, so do not add a blind retry around an ambiguous submission failure. |
| `company.name`, `company.logo`, `company.colors`, and `company.description` | Firecrawl scrapes one known HTTPS domain and requests only the branding or summary formats needed for the selected fields. The adapter validates URLs, colors, and nonblank strings and removes SDK metadata. | The SDK is configured for one total attempt and a bounded timeout. Its `scrape` method does not accept an `AbortSignal`, so backend shutdown stops Sonar from awaiting or applying a late result, but the underlying HTTP request can continue until that timeout. |

The provider run store is also in memory. It prevents duplicate submissions while one backend runtime survives, but it cannot recover provider jobs after a restart. Preserve the single-submit behavior when replacing it with durable storage, especially for SixtyFour.

## Deterministic testing

Use `createBackendTestHarness` for contract tests. It requires a server secret and explicit tenants, uses the same `SonarBackend` Layer and Fetch handler as production, and makes no ambient network or credential reads.

```ts
import { createBackendTestHarness } from "@usesonar/backend/testing"

const backend = createBackendTestHarness({
  scenario: {
    autoSettle: false,
    now: "2026-08-26T12:00:00.000Z",
  },
  serverSecret: "test-only-server-secret",
  tenants: [
    {
      capability: "secret",
      key: "sk_test_tenant",
      tenantId: "tenant-test",
    },
  ],
})

try {
  const response = await backend.fetch(
    new Request("https://backend.test/v1/research", {
      body: JSON.stringify({
        company: {},
        person: { title: true },
        seed: { linkedinURL: "https://linkedin.com/in/ada" },
        ttl: "12h",
      }),
      headers: {
        accept: "text/event-stream",
        authorization: "Bearer sk_test_tenant",
        "content-type": "application/json",
      },
      method: "POST",
    })
  )
  const initial = await backend.nextSSE(response)

  backend.settle("person.title", {
    status: "resolved",
    value: "Engineer",
  })
  const remaining = await backend.collectSSE(response)

  // Assert against initial, remaining, and backend.inspect().
} finally {
  await backend.close()
}
```

Use `settle`, `settleAll`, `settleIdentify`, and `timeout` to drive terminal transitions without sleeps. Use `cacheField` and `advanceBy` to test freshness boundaries, `nextSSE`, `collectSSE`, and `disconnect` to test stream behavior, and `inspect` or `snapshot` for private assertions. Always call `close`; it is idempotent and proves that subscriptions, provider work, and Effect scopes finalize cleanly.

## Verify a backend change

Run the focused backend suites and type check first:

```sh
mise exec -- bun test packages/backend/src/contract.test.ts packages/backend/src/providers.test.ts
mise exec -- bunx tsc -p packages/backend/tsconfig.json --pretty false
```

Before you hand off a backend change, run the repository gates because the private handler shares its contract with every public client:

```sh
just fmt
just check
```

See [`VERIFY.md`](./VERIFY.md) for the backend's required validation, authorization, identity, run, SSE, terminal-state, cache, read, Layer, and root-export conditions.

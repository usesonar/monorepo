# `@usesonar/effect`

`@usesonar/effect` provides an Effect 4 service for Sonar research, with config-derived snapshot types, scoped streams, tagged failures, and a deterministic test Layer. It wraps `@usesonar/api`, so your application works with Effect services and Streams instead of a Ky instance or raw SSE events.

The Effect boundary returns only `{ status, data }`. If you need the raw response hash or direct Ky behavior, use `@usesonar/api`; provider details and backend job metadata aren't part of either public result model.

## Install

```sh
bun add @usesonar/effect effect@4.0.0-rc.112
```

If you author research validators with Zod, add `zod@4` as a direct dependency. You don't need Zod when you use raw JSON Schema or another validator that implements `StandardJSONSchemaV1`.

## Create the client Layer

`layer(options)` creates the underlying API client when Effect builds the Layer. Provide an absolute `baseURL` and exactly one nonblank `secretKey` or `publishableKey`; you can also pass Ky options such as `timeout`, `hooks`, and a custom `fetch` implementation.

```ts
import { layer } from "@usesonar/effect"

const secretKey = process.env.SONAR_SECRET_KEY
if (!secretKey) {
  throw new Error("SONAR_SECRET_KEY is required")
}

const SonarLive = layer({
  baseURL: "https://sonar.example",
  secretKey,
  timeout: 30_000,
})
```

Use a secret capability in server code. If you use a publishable capability, the request must include an `Origin` that its Sonar configuration permits.

If your application already owns an `@usesonar/api` client, `layerFromAPI(client)` adapts that exact Ky instance and preserves its hooks, retry policy, timeout, and custom transport.

## Create a research run and stream its snapshots

Research combines fast built-in fields with schema-backed questions. Put each question inside the entity it describes, under `person.research` or `company.research`; the same question name can appear under both entities because each answer keeps its full entity path.

```ts
import { SonarClient } from "@usesonar/effect"
import type { ResearchConfig, ResearchRequest, StandardJSONSchemaV1 } from "@usesonar/effect"
import { Effect, Stream } from "effect"

type AccountSignals = {
  intent: "low" | "medium" | "high"
  evidence: string[]
}

const AccountSignals: StandardJSONSchemaV1<unknown, AccountSignals> = {
  "~standard": {
    jsonSchema: {
      input: () => ({
        description: "Which buying signals are publicly visible?",
        type: "object",
      }),
      output: () => ({
        additionalProperties: false,
        description: "Which buying signals are publicly visible?",
        properties: {
          evidence: { items: { type: "string" }, type: "array" },
          intent: { enum: ["low", "medium", "high"] },
        },
        required: ["intent", "evidence"],
        type: "object",
      }),
    },
    types: undefined,
    vendor: "example",
    version: 1,
  },
}

const researchConfig = {
  ttl: "7d",
  person: {
    linkedin: true,
    title: true,
  },
  company: {
    domain: true,
    name: true,
    research: { accountSignals: AccountSignals },
  },
} as const satisfies ResearchConfig

const researchRequest = {
  ...researchConfig,
  seed: {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
  },
} as const satisfies ResearchRequest<typeof researchConfig>

const collectResearch = SonarClient.use((sonar) =>
  Stream.runCollect(sonar.research(researchRequest))
).pipe(Effect.provide(SonarLive))

const snapshots = await Effect.runPromise(collectResearch)
const latest = [...snapshots].at(-1)

if (latest) {
  const field = latest.data.company.research.accountSignals
  if (field.status === "resolved") {
    const signals: AccountSignals = field.value
    console.log(signals.intent)
  }
}
```

Calling `research` posts the request and returns a `Stream` for the resulting run. The first snapshot contains every requested leaf as `pending`; later snapshots settle one field at a time, and only the server's explicit completion event changes the snapshot status to `complete`.

Sonar compiles each authored validator to wire JSON Schema before transport. A Zod schema gets its required nonblank prompt from `.describe()`, while raw JSON Schema and `StandardJSONSchemaV1` output must contain a nonblank root `description`. The validator output becomes the resolved value type, so `accountSignals` above is a `Field<AccountSignals>`. A raw JSON Schema question produces a `Field<JSONValue>` because TypeScript can't infer a more specific output from the schema object.

Keep the config literal or use `satisfies ResearchConfig` to preserve exact field selection. Selected built-ins and finite question keys are required in the result type, while broad record configs make reads optional and preserve the known value type.

## Run deep research

Deep research uses a separate operation and accepts nonblank prompt strings instead of validators. Its built-in fields and custom answers remain under `person` and `company`, so a prompt at `person.deepResearch.background` resolves to a `Field<string>` at `snapshot.data.person.deepResearch.background`.

```ts
import type { DeepResearchConfig, DeepResearchRequest } from "@usesonar/effect"

const deepResearchConfig = {
  ttl: "30d",
  person: {
    phone: true,
    deepResearch: {
      background: "Summarize this person's career and cite the strongest sources.",
    },
  },
  company: {
    legalName: true,
    deepResearch: {
      ownership: "Describe this company's ownership structure.",
    },
  },
} as const satisfies DeepResearchConfig

const deepResearchRequest = {
  ...deepResearchConfig,
  seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
} as const satisfies DeepResearchRequest<typeof deepResearchConfig>

const collectDeepResearch = SonarClient.use((sonar) =>
  Stream.runCollect(sonar.deepResearch(deepResearchRequest))
).pipe(Effect.provide(SonarLive))

const deepResearchSnapshots = await Effect.runPromise(collectDeepResearch)
```

Research and deep research use distinct request types and routes. A research config can't select `phone` or `legalName`, and a deep-research config can't select research-tier built-ins or a `research` map.

## Retrieve a known run

`retrieve(hash, config)` gets the latest snapshot for a hash and checks that its selected fields and answer namespaces match the config. Passing the config restores the same precise result type without trusting the remote response shape.

```ts
const retrieveResearch = (hash: string) =>
  SonarClient.use((sonar) =>
    sonar.retrieve<typeof researchConfig.person, typeof researchConfig.company>(
      hash,
      researchConfig
    )
  ).pipe(Effect.provide(SonarLive))

const snapshot = await Effect.runPromise(retrieveResearch("sonar_hash_from_an_api_response"))

// Field<AccountSignals>
const accountSignals = snapshot.data.company.research.accountSignals
```

The returned value remains a hash-free `SonarSnapshot`. The Effect stream doesn't expose the completion hash, so use `retrieve` when another trusted boundary already supplies that hash; use `@usesonar/api` if this process must create a run and retain its hash.

## Handle failures by tag

Every operation fails with `SonarClientError`, a union of four `Data.TaggedError` types. The public errors contain a stable tag and safe fields instead of a raw Ky error, request headers, response bodies, or private causes.

```ts
const loggedResearch = SonarClient.use((sonar) =>
  Stream.runDrain(sonar.research(researchRequest))
).pipe(
  Effect.catchTag("RequestError", (error) => Effect.logWarning(error.message)),
  Effect.catchTag("HTTPError", (error) => Effect.logWarning(`Sonar returned HTTP ${error.status}`)),
  Effect.catchTag("TransportError", (error) => Effect.logWarning(error.message)),
  Effect.catchTag("ProtocolError", (error) => Effect.logWarning(error.message)),
  Effect.provide(SonarLive)
)
```

- `RequestError` means Sonar rejected the local request before transport, such as a malformed seed, TTL, config, or retrieve hash.
- `HTTPError` exposes the response `status` when the server returns an unsuccessful HTTP response.
- `TransportError` means the request couldn't complete because the transport failed.
- `ProtocolError` means the response or event sequence violated the Sonar contract, including an unexpected field or premature completion.

## Cancel stream work with the consumer scope

The response body lives for the stream consumer's scope. If you interrupt the fiber or stop consumption with a Stream operator, Effect cancels the underlying API body and runs its finalizers; the server-side run can continue independently.

```ts
const firstSnapshot = SonarClient.use((sonar) =>
  sonar.research(researchRequest).pipe(Stream.take(1), Stream.runCollect)
).pipe(Effect.provide(SonarLive))

await Effect.runPromise(firstSnapshot)
```

This program receives the initial pending snapshot and then closes its response body. You don't need a separate `AbortController`, because Effect propagates stream interruption to the transport signal.

## Test without credentials or a network

`@usesonar/effect/testing` provides an isolated Layer from exact requests and protocol events. Each `scenarioLayer` owns its request history and interruption count, so parallel tests don't share mutable state or read environment variables.

```ts
import { CompleteEvent, SonarClient } from "@usesonar/effect"
import { Scenario, SonarTestProbe, scenarioLayer } from "@usesonar/effect/testing"
import { Effect, Stream } from "effect"

const request = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "12h",
  person: { title: true },
  company: {},
} as const

const scenario = Scenario.make({
  request,
  events: [
    {
      _tag: "FieldEvent",
      path: "person.title",
      field: {
        status: "resolved",
        value: "Mathematician",
        confidence: 0.98,
        sources: [],
        resolvedAt: "2026-08-26T12:00:00.000Z",
      },
    },
    CompleteEvent,
  ],
})

const SonarTest = scenarioLayer(scenario)

const snapshots = await Effect.runPromise(
  SonarClient.use((sonar) => Stream.runCollect(sonar.research(request))).pipe(
    Effect.provide(SonarTest)
  )
)

const requests = await Effect.runPromise(
  SonarTestProbe.use((probe) => probe.requests).pipe(Effect.provide(SonarTest))
)
```

The scenario emits a config-derived all-pending snapshot before it reduces your events. It fails with `RequestError` if no scenario matches the canonical request, and it uses the production reducer to reject duplicate, unrequested, nonterminal, premature-completion, and post-completion events. Read `probe.interruptions` when a test needs to verify cancellation.

## Exports

The root entry point groups its public surface by responsibility:

| Area | Exports |
| --- | --- |
| Service and Layers | `SonarClient`, `SonarClientService`, `layer`, `layerFromAPI`, `LayerOptions` |
| Config and request types | `ResearchConfig`, `DeepResearchConfig`, `ResearchRequest`, `DeepResearchRequest`, `ValidConfig`, `ValidResearchConfig`, `ValidDeepResearchConfig`, `ValidResearchRequest`, `ValidDeepResearchRequest` |
| Research validator types | `ResearchQuestion`, `ResearchValidator`, `ResearchJSONSchema`, `ResearchOutput`, `StandardJSONSchemaV1`, `StandardJSONSchemaOptions`, entity input and question-map validation types, `compileResearchRequest` |
| Snapshot model | `SonarSnapshot`, `SonarData`, `Field`, `JSONValue`, `SonarSeed`, `TTL` |
| Errors | `SonarClientError`, `RequestError`, `HTTPError`, `TransportError`, `ProtocolError` |
| Protocol utilities | `CompleteEvent`, `FieldEvent`, `SonarProtocolEvent`, `initialSnapshot`, `reduceSnapshot`, `canonicalRequestIdentity` |

`ResearchRequest`, `DeepResearchRequest`, `Field`, `JSONValue`, `SonarSeed`, and `SonarSnapshot` are both Effect Schema values and TypeScript types. Import them normally when you need a schema value and with `import type` when you need only the type.

The `@usesonar/effect/testing` subpath exports exactly `Scenario`, `scenarioLayer`, and `SonarTestProbe` at runtime.

# `@usesonar/effect`

`@usesonar/effect` wraps Sonar in an Effect 4 service with typed Streams, Layers, failures, schemas, and deterministic test scenarios.

## Install after the first public release

```sh
bun add @usesonar/effect effect@4.0.0-rc.112
```

## Stream research

```ts
import { SonarClient, layer, question } from "@usesonar/effect"
import { Effect, Stream } from "effect"

type AccountSignals = {
  intent: "low" | "medium" | "high"
  evidence: string[]
}

const secretKey = process.env.SONAR_SECRET_KEY
if (!secretKey) {
  throw new Error("SONAR_SECRET_KEY is required")
}

const program = SonarClient.use((sonar) =>
  Stream.runCollect(
    sonar.research({
      seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
      ttl: "7d",
      person: ["title"],
      company: ["domain"],
      research: {
        accountSignals: question<AccountSignals>("Which buying signals are publicly visible?"),
      },
    })
  )
)

const snapshots = await Effect.runPromise(
  program.pipe(
    Effect.provide(
      layer({
        baseURL: "https://sonar.example",
        secretKey,
      })
    )
  )
)
```

`question` is re-exported from `@usesonar/api`. Its answer brand makes `snapshot.data.accountSignals` a `Field<AccountSignals>`; plain prompt strings produce `Field<JSONValue>`, and selected built-ins keep their exact catalog types. Keep configs literal or use `as const satisfies ResearchConfig` for precise inference. Finite interfaces and finite type aliases keep exact required fields. A question map annotated as `Readonly<Record<string, string>>` exposes arbitrary custom reads as `Field<JSONValue> | undefined`, while broad catalog arrays make reads optional without changing catalog value types. Union, optional-keyed, callable, constructable, and numeric or symbol key hybrid maps are rejected.

`SonarClient` infers those types from the config for `research`, `deepResearch`, and `retrieve`; none of the operations accepts a separate answer map. Streamed field events keep a snapshot pending, and only the required complete event can produce a complete snapshot. Effect snapshots contain `{ status, data }` and never expose the raw API hash.

`layer(options)` accepts the same capability and Ky options as `createSonar`. Use `layerFromAPI(client)` when you already have an `@usesonar/api` Ky instance. Failures use the tagged `RequestError`, `TransportError`, `HTTPError`, and `ProtocolError` types, so programs can handle them with `Effect.catchTag`.

## Test without credentials

```ts
import { CompleteEvent, SonarClient } from "@usesonar/effect"
import { Scenario, scenarioLayer } from "@usesonar/effect/testing"
import { Effect, Stream } from "effect"

const request = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "12h",
  person: ["title"],
  company: [],
  research: {},
} as const

const fixture = Scenario.make({
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

const snapshots = await Effect.runPromise(
  SonarClient.use((sonar) => Stream.runCollect(sonar.research(request))).pipe(
    Effect.provide(scenarioLayer(fixture))
  )
)
```

`@usesonar/effect/testing` exports `Scenario`, `scenarioLayer`, and `SonarTestProbe`. Each Layer owns isolated requests and interruption counters, starts from the config-derived pending snapshot, and needs no environment variables or network access.

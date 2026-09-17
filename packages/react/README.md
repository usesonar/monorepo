# `@usesonar/react`

`@usesonar/react` connects Sonar's progressive Effect client to React 19. You provide a `SonarClient` Layer once, call a hook with the fields and questions your component needs, and start each request from an event handler with `resolve(seed)`.

The package owns the React lifecycle and a provider-local TanStack Query cache. HTTP transport stays below `@usesonar/effect`, provider integrations stay in the private backend, and only the raw API surface exposes a response hash.

## Installation

This package is a pre-release workspace package. Inside this repository, run `bun install` from the workspace root. After the package is published, install it with its Effect adapter and React peer:

```sh
bun add @usesonar/react @usesonar/effect react@19.2.8 zod@4.4.3
```

React `19.2.8` is the package's exact peer dependency. `@usesonar/react` installs its locked TanStack Query and Effect runtime dependencies; install `@usesonar/effect` directly because your application creates the client Layer. Zod is required only when you author research questions with Zod schemas.

## Provide the client

Create a browser-safe Layer with a publishable capability, then mount `SonarProvider` around the subtree that shares requests and cached results:

```tsx
import { layer } from "@usesonar/effect"
import { SonarProvider } from "@usesonar/react"
import type { ReactNode } from "react"

const sonarLayer = layer({
  baseURL: "https://sonar.example.com",
  publishableKey: "pk_example",
})

export const Providers = ({ children }: { children: ReactNode }) => (
  <SonarProvider layer={sonarLayer}>{children}</SonarProvider>
)
```

`SonarProvider` includes its own `QueryClientProvider`, so you don't add a TanStack provider for Sonar. You can keep an application-wide TanStack provider for other queries; Sonar uses its private client inside this subtree.

If the capability restricts allowed origins, the browser's `Origin` must match one of them. Never include a secret capability in browser code.

The provider creates one Query client and one Effect runtime for its mounted lifetime. Keep the Layer stable and mount the provider near the application root. If you need to change the capability or tenant, remount the provider with a new Layer instead of changing its `layer` prop in place.

## Run schema-backed research

`useSonar` accepts research built-ins and entity-owned question maps. Each question uses a Zod 4 schema, a raw JSON Schema object, or a validator that implements `StandardJSONSchemaV1`; the root schema description supplies the research prompt.

```tsx
import { useSonar } from "@usesonar/react"
import { z } from "zod"

const researchConfig = {
  ttl: "7d",
  person: {
    linkedin: true,
    title: true,
  },
  company: {
    domain: true,
    name: true,
    research: {
      accountSignals: z
        .object({
          evidence: z.array(z.string()),
          intent: z.enum(["low", "medium", "high"]),
        })
        .describe("Which buying signals are publicly visible?"),
    },
  },
} as const

export const ProfileResearch = () => {
  const sonar = useSonar(researchConfig)
  const signals = sonar.data?.company.research.accountSignals

  return (
    <section>
      <button
        disabled={sonar.loading}
        onClick={() =>
          sonar.resolve({
            email: "ada@example.com",
            fullName: "Ada Lovelace",
          })
        }
        type="button"
      >
        {sonar.loading ? "Researching…" : "Research profile"}
      </button>

      {signals?.status === "resolved" ? <p>Buying intent: {signals.value.intent}</p> : null}
    </section>
  )
}
```

The config determines the result type. In this example, `data.person.title` is a `Field<string>`, and `data.company.research.accountSignals` is a `Field<{ evidence: string[]; intent: "low" | "medium" | "high" }>`. Unselected built-ins and unconfigured question names do not appear in the exact result type.

Keep the config as a literal, or use `satisfies ResearchConfig` from `@usesonar/effect`, to preserve exact selectors and validator output types. A broad `ResearchConfig` annotation intentionally produces optional catalog fields and optional custom-answer reads because the compiler no longer knows which keys exist at runtime.

Set `ttl` to an integer duration from 12 hours through 365 days, such as `12h`, `7d`, or `52w`. Question keys must be lower-camel identifiers; `ttl`, `person`, `company`, `research`, and `deepResearch` are reserved.

Research and deep research have separate field catalogs. `useSonar` accepts `linkedin`, `title`, `x`, and `github` for a person, plus `domain`, `name`, `logo`, `colors`, `location`, `description`, and `funding` for a company. A research config cannot select the deep-research fields or namespace.

## Run prompt-based deep research

`useDeepSonar` keeps the same entity-owned shape, but its questions are nonblank prompt strings and every custom answer resolves to a string. The deep-research built-ins are `phone` for a person and `legalName` for a company.

```tsx
import { useDeepSonar } from "@usesonar/react"

const deepResearchConfig = {
  ttl: "30d",
  person: {
    phone: true,
    deepResearch: {
      careerSummary: "Summarize this person's career and cite the strongest sources.",
    },
  },
  company: {
    legalName: true,
    deepResearch: {
      ownership: "Describe this company's ownership structure.",
    },
  },
} as const

export const CompanyDeepResearch = () => {
  const sonar = useDeepSonar(deepResearchConfig)
  const ownership = sonar.data?.company.deepResearch.ownership

  return (
    <>
      <button
        disabled={sonar.loading}
        onClick={() => sonar.resolve({ linkedinURL: "https://linkedin.com/in/ada" })}
        type="button"
      >
        {sonar.loading ? "Researching…" : "Research company"}
      </button>

      {ownership?.status === "resolved" ? <p>{ownership.value}</p> : null}
    </>
  )
}
```

Both hooks accept the same identity seed contract. Supply a LinkedIn URL, a full name with an X URL, or a full name with an email address. You can add a domain and JSON-valued context as supporting evidence, but neither value identifies a person by itself.

## Read progressive state

The hooks return `{ resolve, data, status, loading, error }`. `resolve` is imperative because components usually begin research from a form submission, selection, or button press instead of mounting a request automatically.

| Phase | `data` | `status` | `loading` | `error` |
| --- | --- | --- | --- | --- |
| Before `resolve` | `null` | `undefined` | `false` | `null` |
| While the stream is active | The latest full snapshot | `pending` | `true` | `null` |
| After explicit completion | The final full snapshot | `complete` | `false` | `null` |
| After a failure | The latest snapshot, or `null` | Its latest value | `false` | A `SonarClientError` |

Every requested leaf starts as `{ status: "pending" }` and settles once to `resolved`, `notFound`, or `skipped`. Narrow on a field's `status` before reading `value`, `confidence`, `sources`, or `resolvedAt`. The top-level `status` remains `pending` while individual fields settle and changes to `complete` only after Sonar sends an explicit completion event.

The hooks use TanStack Query's `experimental_streamedQuery` internally and reduce each chunk to the latest validated full snapshot. You read ordinary hook state rather than consuming an async iterator. The package pins the TanStack version because this adapter API is experimental.

## Share results and control lifecycle

Within one `SonarProvider`, canonically identical configs and seeds share one active stream and one completed result. Property order and normalized identity values do not create duplicate requests, while research and deep research always use distinct cache entries.

Completed results remain available for five minutes after their last observer detaches. The query client marks them as never stale during that window and disables retries and automatic refetches on mount, focus, reconnect, or network recovery. A `resolve` call selects a request, which either reuses its cache entry or starts a stream.

Calling `resolve` with a different request switches that hook to the new cache key. If no other component observes the old request, TanStack aborts the old stream; if another component still observes it, that shared request continues. Unmounting the last observer cancels active work, and unmounting `SonarProvider` cancels all of its work, clears its cache, and disposes the Effect runtime.

## Handle errors

`error` is `SonarClientError | null` from `@usesonar/effect`. Narrow its `_tag` to distinguish `RequestError`, `TransportError`, `HTTPError`, and `ProtocolError`:

```tsx
if (sonar.error) {
  return (
    <p role="alert">
      {sonar.error._tag}: {sonar.error.message}
    </p>
  )
}
```

If a stream fails after delivering progress, the hook keeps the latest partial `data` and its `status` while setting `loading` to `false`. It does not retry implicitly. Switching to a different request switches the component to that request's independent data and error state.

`ProtocolError` means the injected client produced a stream that violated the React adapter's snapshot rules, such as ending before completion or changing a terminal field. This validation protects component state even when you inject a custom `SonarClient` Layer.

## Test without network access

`@usesonar/effect/testing` provides deterministic scenarios that use the same Layer boundary as production. A scenario matches an exact request, emits the initial all-pending snapshot automatically, applies your field events, and completes only when you include `CompleteEvent`.

```tsx
import { CompleteEvent } from "@usesonar/effect"
import { Scenario, scenarioLayer } from "@usesonar/effect/testing"
import { SonarProvider, useSonar } from "@usesonar/react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test } from "bun:test"

const config = {
  ttl: "12h",
  person: { title: true },
  company: {},
} as const

const seed = {
  email: "ada@example.com",
  fullName: "Ada Lovelace",
} as const

const testLayer = scenarioLayer(
  Scenario.make({
    request: { ...config, seed },
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
)

const Profile = () => {
  const sonar = useSonar(config)
  const title = sonar.data?.person.title

  return (
    <>
      <button onClick={() => sonar.resolve(seed)} type="button">
        Research
      </button>
      {title?.status === "resolved" ? <p>{title.value}</p> : null}
    </>
  )
}

test("renders the resolved title", async () => {
  const user = userEvent.setup()
  render(
    <SonarProvider layer={testLayer}>
      <Profile />
    </SonarProvider>
  )

  await user.click(screen.getByRole("button", { name: "Research" }))
  expect(await screen.findByText("Mathematician")).toBeTruthy()
})
```

If a research scenario contains custom validators, call `compileResearchRequest` from `@usesonar/effect` when you build the scenario request so it matches the hook's compiled JSON Schema. Use `SonarTestProbe` from `@usesonar/effect/testing` when you need to assert the captured requests or stream interruptions.

The package's own verifier uses Happy DOM, injected Layers, fake time, and a throwing global `fetch` guard. These tests cover React behavior without credentials or hosted services; they do not verify provider accuracy or network transport.

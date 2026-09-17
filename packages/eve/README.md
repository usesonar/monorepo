# `@usesonar/eve`

`@usesonar/eve` turns Sonar research and deep research into Eve tools. You choose which parts of the request your agent controls, and the package derives the tool description, input schema, output schema, execution, and model projection from that choice.

The package exports two factories:

- `researchSonar` returns fast research fields and typed custom answers.
- `deepResearchSonar` returns deep-research fields and custom string answers. It can run as a foreground or Eve background tool.

## Install

```sh
bun add @usesonar/eve zod
```

You need `zod` only when you author research questions with Zod schemas. If you inject a Sonar Layer in tests or application code, add `@usesonar/effect` and `effect` as direct dependencies too.

## Create a static research tool

A static tool keeps the TTL, selected fields, and questions in your code. The model can supply an identity seed, but it can't expand the request or replace your schemas.

```ts
// agent/tools/research-sonar.ts
import { researchSonar } from "@usesonar/eve"
import { z } from "zod"

const AccountSignals = z
  .object({
    intent: z.enum(["low", "medium", "high"]),
    evidence: z.array(z.string()),
  })
  .describe("Which buying signals are publicly visible?")

export default researchSonar({
  ttl: "7d",
  person: {
    linkedin: true,
    title: true,
  },
  company: {
    domain: true,
    name: true,
    research: {
      accountSignals: AccountSignals,
    },
  },
})
```

Eve derives the tool name from the filename, so this file registers `research-sonar`. The generated input accepts only a Sonar identity seed:

```ts
{
  fullName: "Ada Lovelace",
  email: "ada@example.com"
}
```

A seed must contain one of these combinations:

- `linkedinURL`
- `fullName` and `xURL`
- `fullName` and `email`

You can include the other supported seed properties—`domain` and JSON `context`—as additional evidence, but neither property identifies a person by itself.

The result keeps the answer under the entity and tier that requested it:

```ts
snapshot.data.company.research.accountSignals
```

The Zod output gives that field the type `Field<{ intent: "low" | "medium" | "high"; evidence: string[] }>`. Keep the factory config literal, as in the example, to preserve exact fields and answer types.

### Define research questions

A static `research` question accepts a Zod 4 schema, raw JSON Schema, or a validator that implements `StandardJSONSchemaV1`. Every form must produce a JSON Schema with a nonblank root `description`; Sonar uses that description as the research prompt and compiles the schema before transport.

```ts
company: {
  research: {
    sellsToSMB: {
      description: "Does this company sell to small and medium businesses?",
      type: "boolean",
    },
  },
}
```

A typed validator preserves its output type. Raw JSON Schema produces `JSONValue` because TypeScript can't infer a value type from a JSON object alone.

Custom keys must start with a lowercase letter and contain only letters or digits. The names `ttl`, `person`, `company`, `research`, and `deepResearch` are reserved.

## Create a deep-research tool

Deep-research questions are nonblank prompt strings. Their answers are `Field<string>` values under `person.deepResearch` or `company.deepResearch`.

```ts
// agent/tools/deep-research-sonar.ts
import { deepResearchSonar } from "@usesonar/eve"

export default deepResearchSonar({
  ttl: "30d",
  person: {
    phone: true,
    deepResearch: {
      biography: "Write a sourced professional biography.",
    },
  },
  company: {
    legalName: true,
    deepResearch: {
      ownership: "Describe this company's ownership structure.",
    },
  },
})
```

The custom results appear at `snapshot.data.person.deepResearch.biography` and `snapshot.data.company.deepResearch.ownership`.

Research and deep research have separate field catalogs:

| Route | Person fields | Company fields | Custom namespace |
| --- | --- | --- | --- |
| Research | `linkedin`, `title`, `x`, `github` | `domain`, `name`, `logo`, `colors`, `location`, `description`, `funding` | `research` |
| Deep research | `phone` | `legalName` | `deepResearch` |

Each selected built-in uses literal `true`. Both `person` and `company` must be present in a static config, even when one entity is `{}`, and the complete config must select at least one built-in or custom field. The TTL must be a compact duration from `12h` through `365d`, such as `12h`, `7d`, or `52w`.

## Let the model select fields

Use `dynamic: true` when the model must choose the fields and author the matching question maps at execution time. You still own the TTL, so the model can't change cache freshness or cost by supplying one in its input.

```ts
// agent/tools/flexible-research-sonar.ts
import { researchSonar } from "@usesonar/eve"

type PossibleAnswers = {
  person: {
    careerFit: boolean
  }
  company: {
    accountSignals: {
      intent: string
      evidence: string[]
    }
  }
}

export default researchSonar<PossibleAnswers>({
  dynamic: true,
  ttl: "7d",
})
```

The model input now includes the seed plus `person` and `company` selections. Dynamic research questions use raw JSON Schema because model input is JSON:

```ts
{
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  person: {
    title: true,
    research: {
      careerFit: {
        description: "Does this person's public work fit a research role?",
        type: "boolean"
      }
    }
  },
  company: {}
}
```

Dynamic deep research uses the same entity shape, but its question values are prompt strings under `deepResearch`.

The generic argument is a type-only map of possible custom answers. It records entity ownership and value types, but it doesn't request those answers or validate their runtime values. Because the model can omit a key, each declared custom answer remains optional in the snapshot:

```ts
snapshot.data.person.research?.careerFit
snapshot.data.company.research?.accountSignals
```

Without the generic argument, dynamic output still types every built-in as optional, but it doesn't invent custom answer names. The explicit map must contain finite, required, lower-camel keys under `person` or `company`; broad records, unions, optional-keyed maps, and callable or constructable maps are rejected.

## Choose foreground or background execution

Both factories run in the foreground by default. Their `execute` method is an async generator that yields every full progressive snapshot, starting with requested fields in `pending` state and ending after Sonar emits a complete snapshot.

Deep research can use Eve's background scheduling when the agent shouldn't hold the foreground turn:

```ts
// agent/tools/deep-background-sonar.ts
import { deepResearchSonar } from "@usesonar/eve"

export default deepResearchSonar(
  {
    ttl: "30d",
    person: {},
    company: {
      legalName: true,
      deepResearch: {
        taxExposure: "Describe this company's multi-state tax exposure.",
      },
    },
  },
  {
    description: "Use this tool when the user explicitly requests background research.",
    execution: "background",
  }
)
```

The background form drains the Sonar stream and returns its final full snapshot as the normal Eve action result. It doesn't create a delegated receipt, call `task.send`, or add a polling workflow. Research doesn't accept background execution.

You can append a tool-specific instruction with the `description` option. The package keeps its generated field and latency description first, then appends your text, so Eve retains the route and output contract in the model-visible tool description.

## Understand snapshots and model output

Eve runtime consumers receive the full snapshot. Each requested leaf has one lifecycle state:

```ts
{ status: "pending" }
{ status: "resolved", value, confidence, sources, resolvedAt }
{ status: "notFound", reason? }
{ status: "skipped", reason }
```

This full value appears in foreground partial and result events, background results, channels, and hooks. It preserves lifecycle and provenance data so your application can render progress, retain sources, and diagnose why a field didn't resolve.

The model receives a separate `toModelOutput` projection. The projection:

- includes only resolved leaves as `{ value, confidence }`;
- preserves `person`, `company`, `research`, and `deepResearch` nesting;
- omits empty containers and unresolved fields; and
- removes the snapshot envelope, `status`, `sources`, `resolvedAt`, and an envelope `hash` if one is present.

The projection keeps execution metadata out of the model context because that metadata belongs to application control flow and provenance handling, while the model needs the resolved answer and Sonar confidence. This separation also reduces tool-result size without mutating the full snapshot your Eve code receives.

Static tools project only the fields and custom keys in their validated config. Dynamic tools project every schema-valid key returned for the model-authored request. A legitimate custom answer named `provider`, `cache`, `jobId`, or `hash` remains answer data under its entity namespace; only envelope and field metadata are removed.

## Configure the Sonar client

Without an injected Layer, the tool reads these environment variables when execution starts:

```sh
SONAR_BASE_URL=https://api.example.com
SONAR_SECRET_KEY=your-secret-capability
```

Importing `@usesonar/eve` and creating tools don't read the environment, validate credentials, or start network work. This lazy boundary lets Eve load an agent before its execution environment provides secrets.

Pass `{ layer }` as the second factory argument when your application already owns a `Layer<SonarClient>` or when a test needs deterministic behavior:

```ts
export default researchSonar(config, {
  layer: sonarLayer,
})
```

The injected Layer takes precedence over the environment. The adapter uses only the public `@usesonar/effect` service and doesn't make direct HTTP or provider calls.

## Handle errors and cancellation

Factory configuration and tool input are validated before a Sonar request reaches the injected client. Execution reports sanitized failures in four categories: validation, configuration, execution, and cancellation. Error values don't retain causes, stacks, credentials, HTTP bodies, provider details, job IDs, hashes, or cache keys, so handle them as public tool failures rather than transport diagnostics.

Eve passes an `AbortSignal` to each tool execution. Aborting it interrupts foreground research, foreground deep research, and background deep research, closes the Effect stream, and prevents a successful final value from appearing after cancellation.

## Test without credentials

`@usesonar/effect/testing` provides deterministic scenario Layers. Define the exact request your static tool produces, then inject the Layer through the factory options:

```ts
import { CompleteEvent } from "@usesonar/effect"
import { Scenario, scenarioLayer } from "@usesonar/effect/testing"
import { researchSonar } from "@usesonar/eve"

const config = {
  ttl: "12h",
  person: { title: true },
  company: {},
} as const

const seed = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
} as const

const fixture = Scenario.make({
  request: { seed, ...config },
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

export const researchTool = researchSonar(config, {
  layer: scenarioLayer(fixture),
})
```

The scenario starts with the config-derived pending snapshot and applies each event in order. It doesn't read Sonar environment variables or call the network. `SonarTestProbe` lets you inspect captured requests and interruption counts when you need to assert routing or cancellation.

For an Eve-native integration test, put each default-exported tool in `agent/tools`, mount the agent normally, and assert the filename-derived tool name plus its `action.partial` and `action.result` events. The foreground result retains the full snapshot, while the model response receives only the projection described above.

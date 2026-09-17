# `@usesonar/api`

`@usesonar/api` is the low-level TypeScript client for the Sonar HTTP API. It gives you Zod schemas, a configured Ky client, JSON request helpers, and validated server-sent event (SSE) streams.

Use this package when you want to own transport and stream handling. If you want Effect services, React hooks, or Eve tools, use `@usesonar/effect`, `@usesonar/react`, or `@usesonar/eve` instead. This package calls a Sonar service; it doesn't run enrichment providers in your application.

## Install the package

```sh
npm install @usesonar/api zod@^4
```

The package is ESM-only. Install Zod 4 directly when your application authors Zod research schemas, as the examples below do; you can omit Zod if you only use raw JSON Schema or another supported validator.

## Create a client

`createSonar` requires an absolute `baseURL` and exactly one capability key. It returns the `KyInstance` created by Ky, so Ky options such as hooks, retries, timeouts, custom headers, an injected `fetch`, and `.extend()` remain available.

```ts
import { createSonar } from "@usesonar/api"

const sonar = createSonar({
  baseURL: "https://api.example.com",
  publishableKey: "pk_example",
  retry: 2,
  timeout: 30_000,
})
```

Use `publishableKey` in browser code and restrict that capability to your application origins on the service. Use `secretKey` only in trusted server code. Sonar sets the selected capability as the bearer token, and either key must be a nonblank string.

## Request research

Research combines built-in fields with structured questions. Put each question under the entity it describes, and describe the root Zod schema with the prompt Sonar uses for that question.

```ts
import { createResearch, createSonar, type ResearchInput } from "@usesonar/api"
import { z } from "zod"

const sonar = createSonar({
  baseURL: "https://api.example.com",
  secretKey: "sk_example",
})

const request = {
  seed: {
    fullName: "Dana A.",
    email: "dana@example.com",
    domain: "example.com",
  },
  ttl: "7d",
  person: {
    linkedin: true,
    title: true,
    x: true,
    research: {
      roleSummary: z
        .object({
          summary: z.string(),
          evidence: z.array(z.string()),
        })
        .describe("Summarize Dana's public professional role and supporting evidence."),
    },
  },
  company: {
    domain: true,
    name: true,
    logo: true,
    description: true,
    research: {
      marketPosition: z
        .object({
          category: z.string(),
          differentiators: z.array(z.string()),
        })
        .describe("Describe the company's public market position."),
    },
  },
} as const satisfies ResearchInput

const researchResponse = await createResearch(sonar, request)

const roleSummary = researchResponse.data.person.research.roleSummary
if (roleSummary.status === "resolved") {
  console.log(roleSummary.value.summary)
}
```

`createResearch` validates and posts the request to `/v1/research`, then returns the service's current `SonarResponse`. The response might still have `status: "pending"`; use `streamResearch` when you need every update through completion.

### Choose a research schema

A research question accepts one of these schema forms:

- A Zod 4 schema. Call `.describe()` on the root schema because its nonblank description is the research prompt. The inferred output becomes the resolved value type.
- A raw JSON Schema object with a nonblank root `description`. This package types its resolved value as `JSONValue`.
- A validator that explicitly implements `StandardJSONSchemaV1`. Its `~standard.jsonSchema.output()` converter must return JSON Schema, and the validator's declared output becomes the resolved value type.

For example, you can define a raw JSON Schema question without importing Zod:

```ts
import type { ResearchJSONSchema } from "@usesonar/api"

const companyResearch = {
  customerProfile: {
    description: "Describe the company's publicly documented customer profile.",
    type: "object",
    properties: {
      segments: { type: "array", items: { type: "string" } },
    },
    required: ["segments"],
    additionalProperties: false,
  } satisfies ResearchJSONSchema,
}
```

`createResearch` and `streamResearch` compile authored validators to draft 2020-12 JSON Schema before transport. If you need the serializable wire request, call `compileResearchRequest(request)` yourself.

Keep the request as a literal, or use `as const satisfies ResearchInput`, to preserve exact selected fields and validator outputs. A custom question key must start with a lowercase ASCII letter and contain only ASCII letters and digits, such as `roleSummary`. The names `ttl`, `person`, `company`, `research`, and `deepResearch` are reserved.

## Request deep research

Deep research uses nonblank prompt strings instead of output schemas. Its custom resolved values are strings.

```ts
import { createDeepResearch } from "@usesonar/api"

const deepResearchResponse = await createDeepResearch(sonar, {
  seed: {
    fullName: "Dana A.",
    email: "dana@example.com",
    domain: "example.com",
  },
  ttl: "30d",
  person: {
    phone: true,
    deepResearch: {
      careerHistory: "Trace Dana's public professional history and explain uncertain dates.",
    },
  },
  company: {
    legalName: true,
    deepResearch: {
      ownership: "Explain the company's ownership using public evidence.",
    },
  },
} as const)

const ownership = deepResearchResponse.data.company.deepResearch.ownership
if (ownership.status === "resolved") {
  console.log(ownership.value)
}
```

Research and deep research have separate built-in fields. Research supports `person.linkedin`, `person.title`, `person.x`, `person.github`, and the company fields `domain`, `name`, `logo`, `colors`, `location`, `description`, and `funding`. Deep research supports `person.phone` and `company.legalName`. Select a built-in field with the literal value `true`.

Both request types require `person` and `company` objects, even if one is empty. A seed must contain `linkedinURL`, `fullName` with `xURL`, or `fullName` with `email`; `domain` and `context` can add evidence but can't identify a record by themselves. The `ttl` value accepts an integer followed by `ms`, `s`, `m`, `h`, `d`, or `w`, from 12 hours through 365 days.

## Read field results

Every requested value is a `Field<T>` and starts as `pending`. It settles once as `resolved`, `notFound`, or `skipped`:

```ts
import type { Field } from "@usesonar/api"

const readField = (field: Field<string>) => {
  switch (field.status) {
    case "pending":
      return "Research is still running"
    case "resolved":
      return field.value
    case "notFound":
      return field.reason ?? "No result"
    case "skipped":
      return field.reason
  }
}
```

Built-in fields sit directly under `person` or `company`. Custom answers retain both namespaces, such as `person.research.roleSummary` and `company.deepResearch.ownership`. A JSON response adds `hash` to `{ status, data }`; use that hash to retrieve the same tenant-scoped run later.

## Stream progressive results

`streamResearch` and `streamDeepResearch` return a `Promise<ReadableStream<SonarEvent>>`. The first event contains the full pending snapshot, each field event settles one path, and the final event contains the hash.

```ts
import { streamResearch } from "@usesonar/api"

const controller = new AbortController()
const stream = await streamResearch(sonar, request, {
  signal: controller.signal,
  maxReconnects: 3,
})

for await (const event of stream) {
  switch (event.type) {
    case "snapshot":
      console.log(event.snapshot)
      break
    case "field":
      console.log(event.path, event.field)
      break
    case "complete":
      console.log(event.hash)
      break
  }
}
```

If transport ends before completion, the stream reconnects up to three times by default and resumes with `Last-Event-ID`. Set `maxReconnects` to a nonnegative integer to change that limit. Abort the supplied signal or cancel the returned stream to stop transport work and prevent reconnection.

The raw stream emits protocol events and doesn't reduce them into successive snapshots. Apply each field event to the initial snapshot yourself, or use `@usesonar/effect` or `@usesonar/react` when you want reduced progressive snapshots.

## Retrieve a run

`retrieveSonar` gets the latest JSON snapshot for a hash:

```ts
import { retrieveSonar } from "@usesonar/api"

const latest = await retrieveSonar(sonar, researchResponse.hash)
```

Retrieval has no request object from which to infer custom answer keys, so the default result type includes the optional built-in catalog without invented custom keys. If your application already knows the answer shape, pass an entity-and-tier map as compile-time metadata:

```ts
type KnownAnswers = {
  person: {
    research: {
      roleSummary: { summary: string; evidence: string[] }
    }
  }
  company: {
    research: {
      marketPosition: { category: string; differentiators: string[] }
    }
  }
}

const latest = await retrieveSonar<KnownAnswers>(sonar, researchResponse.hash)
```

This type argument doesn't add runtime validation for your custom value shape. Runtime decoding still validates the Sonar envelope, field states, built-in value families, research answers as JSON values, and deep-research answers as strings.

## Handle errors and cancellation

Configuration and authored-schema compilation can throw `TypeError`, while Zod request and response parsing can throw `ZodError`. HTTP and network failures retain Ky's error behavior. SSE framing, ordering, replay, size, and completion failures throw `SonarStreamError`.

If you abort a stream, the active read rejects with the abort reason. If you stop consuming a stream before completion, cancel its reader or abort its signal so the client closes the response body and doesn't reconnect.

## API surface

| Export | Purpose |
| --- | --- |
| `createSonar` | Creates the authenticated Ky client. |
| `createResearch`, `createDeepResearch` | Creates a run and returns its current validated JSON response. |
| `streamResearch`, `streamDeepResearch` | Creates a run and returns its validated SSE event stream. |
| `retrieveSonar` | Retrieves the latest validated response by hash. |
| `compileResearchRequest` | Converts authored research validators to the wire-level `ResearchRequest`. |
| `SonarStreamError` | Identifies SSE framing and protocol failures. |
| `JSONValue`, `SonarSeed`, `TTL`, `ResearchRequest`, `DeepResearchRequest` | Provide same-name Zod schemas and TypeScript types for request data. |
| `Field`, `SonarSnapshot`, `SonarResponse` | Provide same-name Zod schemas and TypeScript types for result data. |
| `SnapshotEvent`, `FieldEvent`, `CompleteEvent`, `SonarEvent` | Provide same-name Zod schemas and TypeScript types for stream events. |
| Authored-input and inference types | Include `ResearchInput`, `DeepResearchInput`, `ResearchQuestion`, `ResearchValidator`, `ResearchJSONSchema`, `StandardJSONSchemaV1`, `ResearchOutput`, and the entity input types. |

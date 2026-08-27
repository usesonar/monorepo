# `@usesonar/api`

`@usesonar/api` provides the Zod wire schemas and raw Ky client for Sonar JSON and SSE requests.

## Install after the first public release

```sh
bun add @usesonar/api
```

## Create a request

`createSonar` requires one capability key and returns the actual Ky instance, so you can keep using Ky hooks, retries, timeouts, custom `fetch`, and `.extend()`.

```ts
import { createResearch, createSonar, question } from "@usesonar/api"

type AccountSignals = {
  intent: "low" | "medium" | "high"
  evidence: string[]
}

const sonar = createSonar({
  baseURL: "https://sonar.example",
  publishableKey: "pk_example",
})

const request = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "7d",
  person: ["title"],
  company: ["domain"],
  research: {
    accountSignals: question<AccountSignals>("Which buying signals are publicly visible?"),
  },
} as const

const result = await createResearch(sonar, request)

result.hash
result.data.person.title
result.data.company.domain
result.data.accountSignals
```

`question<Answer>(prompt)` returns the prompt string unchanged and carries its answer type into the corresponding result field. Here, `result.data.accountSignals` is `Field<AccountSignals>`, while a plain prompt string produces `Field<JSONValue>`. Selected built-ins also keep their exact catalog types, so `title` and `domain` are `Field<string>` values and unselected built-ins are absent. The answer brand is compile-time metadata; runtime responses are JSON-validated, not structurally checked against the caller's TypeScript type.

Keep the request literal or use `as const satisfies ResearchRequest` when you need precise inference. Finite question maps declared as interfaces or type aliases keep exact required fields. A broad annotation such as `ResearchRequest` or `Record<string, string>` erases question brands and exposes arbitrary custom reads as `Field<JSONValue> | undefined`; broad selection arrays also make catalog reads optional while preserving catalog value types. Union, optional-keyed, callable, constructable, and numeric or symbol key hybrid maps are rejected.

Use `publishableKey` in browser code. When that capability has configured allowed origins, the request must include a matching `Origin`. Use `secretKey` only on a server, and provide exactly one of the two options.

`createDeepResearch` derives its custom answer types from its `deepResearch` question map in the same way. `retrieveSonar(client, hash)` is different because retrieval has no config from which to infer custom keys, so its default type does not claim any. `retrieveSonar<Answers>(client, hash)` is the one safe explicit answer-map form when the caller already knows those keys; it requires a finite, non-union interface or type alias with required lower-camel keys. Like `question`, that map is compile-time metadata rather than runtime structural validation. These JSON helpers return `SonarResponse`, which adds the tenant-scoped `hash` to `{ status, data }`.

## Stream results

```ts
import { streamResearch } from "@usesonar/api"

const controller = new AbortController()
const stream = await streamResearch(sonar, request, {
  signal: controller.signal,
})

for await (const event of stream) {
  // snapshot, terminal field events, then complete
}
```

`streamResearch` and `streamDeepResearch` are async and return `Promise<ReadableStream<SonarEvent>>`. The first event is the full pending snapshot, field events settle one requested path at a time, and the terminal event contains the raw hash. The client reconnects three times by default with `Last-Event-ID`, suppresses replayed IDs, and stops immediately when its stream or signal is cancelled.

Requests keep their `research` or `deepResearch` question map. Results keep built-ins under `person` and `company`, then flatten custom answers into top-level `data` fields. The exported schemas reject invalid seeds, cross-tier fields, duplicate fields, reserved custom keys, and TTLs outside 12 hours through 365 days.

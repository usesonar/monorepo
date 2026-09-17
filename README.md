# Sonar

Sonar turns a thin identity seed into progressive person and company data. The workspace implements one contract across a raw Ky client, an Effect client, React hooks, Eve tools, and a private in-memory backend.

[`SPEC.md`](./SPEC.md) defines the shared request, field, stream, identity, and cache semantics. The hosted application in `apps/next` remains outside this implementation.

## Workspace

- [`packages/api`](./packages/api) is the public `@usesonar/api` package, with Zod wire schemas and Ky transport.
- [`packages/effect`](./packages/effect) is the public `@usesonar/effect` package, with the Effect 4 client, Layers, Streams, errors, and test scenarios.
- [`packages/backend`](./packages/backend) contains the private Effect backend and deterministic in-memory test harness.
- [`packages/react`](./packages/react) is the public `@usesonar/react` package, with the React adapter and provider-local streamed-query caching.
- [`packages/eve`](./packages/eve) is the public `@usesonar/eve` package, with static and dynamic Eve tool factories.
- [`apps/next`](./apps/next) is reserved for the hosted product and is not part of the implemented backend path.

## Setup

The package manager is Bun 1.4.0, and mise installs the Bun 1.4 toolchain. Install the toolchain and dependencies before running a workspace command:

```sh
mise trust
mise install
bun install
```

Use `just` as the command surface:

```sh
just fmt             # Format files and apply safe lint fixes
just check           # Run lint, type checks, and deterministic tests
just build           # Build the four public packages
just check-packages  # Build and validate their npm package surfaces
```

The required test suite is local, deterministic, and keyless. It uses the private in-memory backend and injected Effect Layers, so `just check` does not need Sonar, provider, Vercel, or model credentials. The optional Eve model smoke test uses the OpenAI Responses API only when `OPENAI_API_KEY` is available:

```sh
bun packages/eve/verify/live-responses.ts
```

That smoke test uses `gpt-5.6-luna` with low reasoning effort and never gates CI.

## Contract at a glance

Research and deep research use separate requests. Each request keeps built-in fields and custom questions under the person or company they describe:

```ts
import { z } from "zod"

const AccountSignals = z.object({
  intent: z.enum(["low", "medium", "high"]),
  evidence: z.array(z.string()),
})
type AccountSignals = z.infer<typeof AccountSignals>

const request = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "7d",
  person: {
    linkedin: true,
    title: true,
  },
  company: {
    domain: true,
    research: {
      accountSignals: AccountSignals.describe("Which buying signals are publicly visible?"),
    },
  },
} as const
```

Research questions accept Zod 4 schemas, raw JSON Schema with a root `description`, or another `StandardJSONSchemaV1` validator. Sonar compiles the validator to wire JSON Schema, and its output determines the field type. In this example, the answer is `data.company.research.accountSignals`, a `Field<AccountSignals>`.

Deep-research questions use plain prompt strings under `person.deepResearch` or `company.deepResearch`, and their answers remain under the same path as `Field<string>`. Finite interfaces and type aliases preserve exact required fields, while broad entity and question maps make reads optional without losing their known value types. Every requested leaf progresses from `pending` to `resolved`, `notFound`, or `skipped`; the snapshot becomes `complete` only after every leaf is terminal.

The private backend sends research questions to Parallel `core-fast` and deep-research questions to SixtyFour `medium`. Firecrawl handles only the company-site fields `name`, `logo`, `colors`, and `description`. Provider details never appear in public responses.

## Releases

`@usesonar/api`, `@usesonar/effect`, `@usesonar/react`, and `@usesonar/eve` are independently versioned. Add a changeset for every public package change:

```sh
bun changeset
```

Feature work lands on `staging`. A merge to `main` runs the release workflow, which checks and builds the workspace, consumes pending changesets into release bookkeeping while versioning each affected package and any dependency-required bumps, publishes missing non-bootstrap versions through npm trusted publishing, verifies each registry version, and pushes package tags.

Before the first automated release, manually publish each still-unpublished `0.0.0` package to reserve its npm name, then configure its trusted publisher for the GitHub organization `usesonar`, repository `monorepo`, and workflow `release.yml`. The release workflow rejects an unpublished `0.0.0` package instead of treating the bootstrap as complete.

Use an empty changeset when the changeset gate applies but no public package contract changed:

```sh
bun changeset --empty
```

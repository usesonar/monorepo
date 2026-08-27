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

Research requests are flat and keep custom questions in the request:

```ts
import { question } from "@usesonar/api"

type AccountSignals = {
  intent: "low" | "medium" | "high"
  evidence: string[]
}

const request = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "7d",
  person: ["title"],
  company: ["domain"],
  research: {
    accountSignals: question<AccountSignals>("Which buying signals are publicly visible?"),
  },
} as const
```

The branded prompt makes `data.accountSignals` a `Field<AccountSignals>`. A plain prompt string produces `Field<JSONValue>`, while selected built-ins retain their catalog types. Finite interfaces and finite type aliases produce exact required fields. Question maps annotated as `Readonly<Record<string, string>>` remain accepted, but arbitrary custom reads are `Field<JSONValue> | undefined`; broad catalog arrays also make catalog reads optional. Callable or constructable maps and numeric or symbol key hybrids are rejected. Built-in results stay under `person` and `company`, while custom answers become top-level fields in `data`. Every requested field progresses from `pending` to `resolved`, `notFound`, or `skipped`; the snapshot becomes `complete` only after every field is terminal.

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

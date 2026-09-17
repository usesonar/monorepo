# Working in Sonar

This repository is a Bun workspace managed with mise. Use `just` as the command surface, inspect `git status` before editing, and preserve concurrent work you did not author.

Read `SPEC.md` before making product or API decisions. It is the source of truth for the shared enrichment model across the raw API, Effect, React, Eve, and private backend surfaces.

## Workspace boundaries

- `packages/api` owns the public Zod wire schemas and Ky transport named `@usesonar/api`.
- `packages/effect` owns the public Effect 4 service, Layers, Streams, errors, and testing utilities named `@usesonar/effect`.
- `packages/backend` owns the private Effect backend and deterministic in-memory harness. Never add it to a publish or release enumeration.
- `packages/react` owns the public React adapter named `@usesonar/react`.
- `packages/eve` owns the public Eve integration named `@usesonar/eve`.
- `apps/next` is reserved for the hosted product. Keep it out of the package-backed implementation until that scope is explicitly started.
- A package can depend on another package only through its public `@usesonar/*` export. Do not import another workspace's source files directly.
- When adding a workspace, add it to the root TypeScript project references and every applicable build, check, CI, and release enumeration.

Runtime dependencies flow in one direction: API owns transport, Effect wraps API, and React and Eve wrap Effect. Public packages must not import the private backend, Next.js, provider SDKs, Node-only modules, or sibling source paths.

## TypeScript

- Keep TypeScript strict, including `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
- Use `@/` for app-local source imports and `@usesonar/*` for exported package surfaces.
- Prefer type aliases. A Zod schema value and its inferred type can share one PascalCase name: `const User = z.object(...)` and `type User = z.infer<typeof User>`.
- Infer result shapes owned by libraries. Normalize external values once at the boundary instead of spreading uncertain types through the codebase.
- Avoid forwarding wrappers and module-level singletons. Use implicit-return arrow functions for single expressions.
- Keep acronyms uppercase in identifiers (`API`, `URL`, `JSON`), except for the conventional `Id` suffix (`userId`, `UserId`).

## Product contracts

- A seed requires `linkedinURL`, `fullName` plus `xURL`, or `fullName` plus `email`; supported fields can coexist, and `domain` or `context` alone is invalid.
- A TTL is a compact integer duration using `ms`, `s`, `m`, `h`, `d`, or `w`, inclusive from 12 hours through 365 days.
- Research and deep research use separate routes. Both request shapes contain `seed`, `ttl`, `person`, and `company`; each entity contains its built-in selectors and the matching `research` or `deepResearch` question map.
- Research questions accept Zod 4 schemas, raw JSON Schema objects, or validators that explicitly implement `StandardJSONSchemaV1`. Compile every authored validator to wire JSON Schema, and require a nonblank root `description` as the prompt. Deep-research questions remain plain, nonblank prompt strings.
- API create operations, Effect, React, and static Eve derive custom answer types from the entity-owned question maps. Finite interfaces and type aliases produce exact required fields, while broad entity or question maps produce optional reads with preserved value types. Reject unions, optional-keyed maps, callable or constructable maps, and numeric or symbol key hybrids. Do not add operation-level answer maps; raw API retrieval and dynamic Eve are the only surfaces that can accept explicit type-only maps because neither owns a fixed question config at the call site.
- Results list `person` before `company`. Custom answers stay under the entity and tier that requested them, such as `person.research.summary` or `company.deepResearch.ownership`.
- The private backend sends entity-owned `research` batches to Parallel `core-fast`, sends entity-owned `deepResearch` batches to SixtyFour `medium`, and uses Firecrawl only for the narrow company-site fields `name`, `logo`, `colors`, and `description`. Keep provider selection and provider-native metadata out of public packages and responses.
- Every requested field starts as `pending` and settles once to `resolved`, `notFound`, or `skipped`. Only an explicit complete event can move a snapshot to `complete`.
- `SonarSnapshot` contains only `status` and `data`. The raw API `SonarResponse` can add `hash`, but Effect, React, and Eve snapshots must not expose it.
- Hash identity uses a server-secret HMAC over the authenticated tenant, route, canonical seed, and canonical config including TTL. A known cross-tenant hash must look absent.
- If allowed origins are configured for a publishable capability, requests using that capability must include a matching `Origin`. Secret-capability requests can omit `Origin`.
- Preserve person-before-company ordering and the same seed, field, status, tier, and custom-answer semantics across every public surface.
- Parse untrusted values at system boundaries. Do not expose providers, job IDs, cache keys, transport details, secrets, or private causes through a public API.
- This product is pre-launch. Replace obsolete contracts directly instead of adding compatibility layers.

## Quality

Treat Ultracite anti-slop diagnostics as design feedback. Do not disable a rule unless a concrete invariant makes the flagged construct necessary. Type assertions require a nearby `SAFETY:` comment explaining that invariant.

Name Bun tests `*.test.ts`; focused package fixtures can live beside source or under a package `test` directory, and the cross-stack verifier lives under root `tests`. Required tests must be deterministic and keyless; use injected Effect Layers, fake time, and the in-memory backend instead of hosted services, ambient `fetch`, or sleeps.

Before handing off a change, run:

```sh
just fmt
just check
```

If a public package changes, also run `just check-packages` and inspect its packed files. Do not commit generated `dist` output.

## Changes and releases

Add a changeset for every user-visible change to `@usesonar/api`, `@usesonar/effect`, `@usesonar/react`, or `@usesonar/eve`. Use an empty changeset when the gate applies but no published package changes. The private backend and `apps/next` are excluded from package releases.

Feature work lands on `staging`; `main` is the release branch. The release workflow versions and publishes the four public packages directly, so do not hand-edit package versions or changelogs. Keep them independently versioned unless a real dependency requires coordinated releases.

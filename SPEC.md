# Sonar — Handoff Spec (v2)

Code name: **Sonar** (rename later). Schema-in, Sonar-out enrichment API with three surfaces: React hooks, eve agent tools, REST.

## What it is

A customer's user signs up (Google, X, LinkedIn, email). The customer sends the thin identity seed they got plus a list of what they want to know about that person and their company. Sonar fans out to upstream providers, resolves each field independently, caches each field independently, and streams results back as they land. The customer never sees providers, latency tiers, job IDs, or hashes.

Two tiers, with a meaning a customer can hold in their head:

- **research** — _lookup_. Identity, public profile, brand, funding, quick web questions. Seconds.
- **deepResearch** — _investigation_. Things an agent has to go do: phone numbers, legal entity names, hard questions. Minutes.

Every surface exposes both tiers with the same three-slot config: `person`, `company`, and either `research` or `deepResearch`.

## User story

A tax SaaS adds "Sign in with Google." On sign-in they call `resolve({ email, name })` from `useSonar`. Within seconds `company.domain`, `company.logo`, `company.colors` fill in and their onboarding screen is branded. They also called `useDeepSonar`, so `person.phone` and `company.legalName` show as skeletons and land over the next few minutes. They push the result to HubSpot. Fifteen lines of code, never learned what Sixtyfour or Firecrawl are.

Their internal eve agent has the same two things as tools, `researchSonar` and `deepResearchSonar`, from two two-line files.

## Field catalog

Person always listed before company, everywhere.

**research tier**

| Slot       | Fields                                      | Provider                            |
| ---------- | ------------------------------------------- | ----------------------------------- |
| `person`   | `linkedin`                                  | Identify stage                      |
| `person`   | `title, x, github`                          | Exa                                 |
| `company`  | `domain`                                    | Identify stage                      |
| `company`  | `name, logo, colors, location, description` | Firecrawl (one scrape, five fields) |
| `company`  | `funding`                                   | Parallel                            |
| `research` | custom keys, value = question               | Parallel task API                   |

**deepResearch tier**

| Slot           | Fields                        | Provider                                                                                     |
| -------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `person`       | `phone`                       | Sixtyfour. Corporate email only.                                                             |
| `company`      | `legalName`                   | Custom browser-use agent (Cyrus has a method; treat as black box `resolveLegalName(domain)`) |
| `deepResearch` | custom keys, value = question | Sixtyfour                                                                                    |

Validation: a field from the wrong tier is a 400 with a message naming the right route/tool. Custom keys are camelCase identifiers; `ttl`, `person`, `company`, `research`, `deepResearch` are reserved.

## Field shape

Every leaf on every surface:

```ts
type Field<T> =
  | { status: "pending" }
  | { status: "resolved"; value: T; confidence: number; sources: string[]; resolvedAt: string }
  | { status: "notFound"; reason?: "timeout" | "identityFailed" | "providerEmpty" }
  | { status: "skipped"; reason: "consumerEmail" | "noPersonSeed" | "noCompanySeed" };
```

Every requested field exists in the response from the first byte with `status: "pending"`. Top-level `status` is `"pending" | "complete"`; `complete` means every field has a terminal status.

Seed, any subset, same on every surface:

```ts
{ email?, name?, domain?, xHandle?, linkedinUrl? }
```

## React SDK

```tsx
import { useSonar, useDeepSonar } from "Sonar/react";

const fast = useSonar({
  ttl: "7d",
  person: ["title", "linkedin", "x"],
  company: ["name", "domain", "logo", "colors", "funding"],
  research: { sellsToSmb: "Who does this company sell to?" },
});

const deep = useDeepSonar({
  ttl: "7d",
  person: ["phone"],
  company: ["legalName"],
  deepResearch: { usesQuickbooks: "Does this company use QuickBooks or Xero?" },
});

function onSignIn(user) {
  fast.resolve({ email: user.email, name: user.name });
  deep.resolve({ email: user.email, name: user.name });
}

fast.status; // undefined | "pending" | "complete"
fast.data; // null until resolve()
fast.data?.company.logo.value;
fast.data?.research.sellsToSmb.value;
deep.data?.person.phone; // { status: "pending" } for a few minutes
deep.data?.deepResearch.usesQuickbooks;
```

- Both hooks return `{ resolve, data, status }` with identical field shapes.
- Each hook opens its own SSE stream to its own route. No shared client state.
- Config lives client-side and is visible to the end user. Accepted.
- Publishable key is configured once via a provider or env; the hook reads it.

## Eve SDK

Two exports, two files, each a complete tool. Filename is the tool name the model sees; customers can rename.

```ts
// agent/tools/researchSonar.ts
import { researchSonar } from "Sonar/eve";

export default researchSonar({
  ttl: "7d",
  person: ["title", "linkedin", "x", "github"],
  company: ["name", "domain", "logo", "colors", "location", "funding"],
  research: { sellsToSmb: "Who does this company sell to?" },
});
```

```ts
// agent/tools/deepResearchSonar.ts
import { deepResearchSonar } from "Sonar/eve";

export default deepResearchSonar({
  ttl: "7d",
  person: ["phone"],
  company: ["legalName"],
  deepResearch: { usesQuickbooks: "Does this company use QuickBooks or Xero?" },
});
```

Both tools:

- `inputSchema` is the seed. The model never sees hashes; the deep tool hashes the seed internally and lands on the right Sonar.
- `description` is generated from config: lists the exact fields returned and the expected latency. The deep tool's description says it runs in the background, results arrive in a later turn, and to call it only after `researchSonar` succeeded.
- `outputSchema` derived from config, typed end to end.
- `toModelOutput` returns only resolved fields as `{ path: value, confidence }`. No pending, no sources, no skipped noise. Channels and hooks still get the full output.
- Secret key from `process.env.Sonar_SECRET_KEY`.
- Optional `dynamic: true`: moves `person`/`company`/`research` into `inputSchema` so the model picks fields per call; catalog goes in the description. Off by default.

`researchSonar` is a normal tool using an async-generator `execute`: yields the full `data` snapshot on every field event, final yield is the settled data.

`deepResearchSonar` uses `execution: "background"` (requires `experimental.tasks` on the root agent). Returns `task.delegated(...)` immediately; the executor polls `GET /v1/{hash}` and calls `task.send({ kind: "complete", data })` when every field is terminal. Because `task.send` is not restart-safe, keep a reconciliation path: on process start, any task still `working` is re-polled by hash and completed from the durable server state. The Sonar itself never depends on the callback surviving.

Eve replays completed steps and re-runs interrupted ones. Content-addressed POST is the idempotency key; a re-run lands on the same Sonar.

Scaffold: `npx Sonar init eve` writes the two files and optionally `agent/skills/Sonar/SKILL.md` (when to enrich, how to read confidence, what `skipped: consumerEmail` means).

## REST API

```
POST /v1/research        { seed, ttl, person, company, research }
POST /v1/deepResearch    { seed, ttl, person, company, deepResearch }
GET  /v1/{hash}
```

`Authorization: Bearer <key>` on all three.

`POST` with `Accept: text/event-stream` — the primary path. SSE stream of field events ending with `complete`. Both SDKs use this.

```
event: field
data: { "path": "person.title", "status": "resolved", "value": "...", "confidence": 0.9, "sources": [...], "resolvedAt": "..." }

event: complete
data: { "hash": "..." }
```

Every event carries an `id:` line equal to its index in the run's stream. Clients reconnecting send `Last-Event-ID` (browser `EventSource` does this automatically); the server passes it as `startIndex` when reattaching to the stream, so a reconnect resumes rather than replays. No query-param equivalent.

`POST` with `Accept: application/json` — returns the current snapshot immediately:

```json
{ "hash": "...", "status": "pending" | "complete", "data": { "person": {...}, "company": {...}, "research": {...} } }
```

Posting the same body again returns the same Sonar. There is no job to start, resume, or track.

`GET /v1/{hash}` — snapshot only, same shape. Reads live cache, so a later GET can be more complete than the original POST.

No webhooks.

## Hashing

`hash = sha256(tenantId + route + canonicalJson(seed) + canonicalJson(schema))`

- Canonical: sorted keys; email and domain lowercased and trimmed; `@` stripped from `xHandle`.
- `ttl` is excluded; it governs freshness, not identity.
- `tenantId` is in the hash only so `GET /v1/{hash}` is tenant-scoped. It plays no role in caching.

## Caching

The Sonar is a view, not a cache entry. Every field is cached independently and cross-tenant. A request names a set of fields; each is looked up, misses are resolved, the response composes them. Adding one field to a schema costs one field.

Cache keys:

| What                                                  | Key                                                |
| ----------------------------------------------------- | -------------------------------------------------- |
| Identify result (`person.linkedin`, `company.domain`) | normalized seed                                    |
| Company fields                                        | resolved domain                                    |
| Person fields                                         | resolved person identity (LinkedIn URL)            |
| Research and deep research keys                       | subject (domain or person) + sha256(question text) |

TTL is applied per field at read time against `resolvedAt`. A field older than the request's `ttl` is re-resolved; otherwise it's returned as `resolved` immediately in Stage 0.

Provider raw results (e.g. a Firecrawl scrape) are cached separately below the field layer so one scrape can serve five fields across many requests.

Not v1: per-field default TTLs (linkedin 90d, colors 30d, title 14d). The shape allows it as one table later.

## Auth and keys

- `pk_test_…` — publishable, browser-safe, `localhost` only.
- `pk_live_…` — publishable, browser-safe, only from origins on the tenant's allowlist. Reject at the edge on `Origin` mismatch.
- `sk_…` — secret, server-side, no origin check.

Self-serve for every tenant.

## Resolution pipeline

**Stage 0 — synchronous.** Normalize seed, compute hash, load every requested field from cache within `ttl`, classify email:

- corporate: not on the freemail list (gmail, yahoo, outlook/hotmail/live, icloud, proton, aol, long tail) and not on a disposable-domain list
- consumer: on the freemail list
- none: no email in seed

Consumer or none → `person.phone` is `skipped`, `reason: "consumerEmail"`, immediately.

**Stage 1 — Identify.** Produces `person.linkedin` and `company.domain`. Cached on the seed, shared across tenants and across both routes. Emitted as the first field events. Branch on seed:

- `linkedinUrl` → scrape profile → name, title, employer → employer domain.
- `email` (corporate) → Exa on name + email domain → LinkedIn candidate → employer → company domain. The email domain is a hint, not truth: subsidiaries, agencies, legacy domains. Match with LinkedIn employer → high confidence. Mismatch → LinkedIn wins, email domain recorded in `sources`.
- `email` (consumer) or `name` only → Exa on name. Low confidence, often `notFound`.
- `xHandle` → X profile (bio, link, display name) → domain from link if present; LinkedIn via Exa on display name + bio.
- `domain` only → company-only. All `person.*` `skipped`, `reason: "noPersonSeed"`.

**Fail fast.** If identify yields neither `person.linkedin` nor `company.domain`, every dependent field is `notFound` with `reason: "identityFailed"` and `complete` fires. No retries with weaker signals. If one resolves, only fields gated on the other fail.

**Stage 2 — Fan-out.** Everything in the catalog runs in parallel once its gate is satisfied. Company fields gate on `company.domain`; person fields gate on `person.linkedin`; `person.phone` gates on both plus corporate email; research and deep keys gate on `company.domain` (and person identity when available, passed as context).

**Stage 3 — Settle.** Provider result → normalizer → field cache write → field event. Field confidence is capped at the confidence of the identity it depends on. Per-field timeout → `notFound`, `reason: "timeout"`. `complete` when all requested fields are terminal.

Timeouts:

| Provider                        | Budget                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| Identify                        | 10s                                                                                          |
| Firecrawl, Exa                  | 30s                                                                                          |
| Parallel (funding, research)    | 60s                                                                                          |
| Browser agent (legalName)       | 5 min                                                                                        |
| Sixtyfour (phone, deepResearch) | 10 min (their docs: P95 ~5 min, up to 10; use the async endpoint, don't hold a sync request) |

## Build

**Stack:** Next.js on Vercel, Vercel Workflow (Workflow DevKit) for orchestration and streaming, Redis (Upstash via Vercel Marketplace) for every persistent store. No Postgres, no Convex.

Next.js rather than a bare API framework because the dashboard (keys, origin allowlist), docs, and playground live in the same deploy. Route handlers serve `/v1/*`; pages serve the rest. Workflow is enabled with `withWorkflow` in `next.config`.

**Workflows.** One `"use workflow"` function per tier: `researchWorkflow` and `deepResearchWorkflow`. Inside each:

- Stage 0 cache check is a step.
- Identify is a step (cached on the seed; the step body first checks Redis and returns early on a hit).
- Every provider call is its own step, so it is cached and retried independently. Use `RetryableError` for provider 5xx/timeouts and `FatalError` for validation failures.
- Every field settling does two writes together: the field store in Redis, and `getWritable().write(fieldEvent)` to the run's stream. The stream serves live consumers; the store serves snapshots, `GET`, and the cross-tenant cache. Neither is read to produce the other.
- Never call a workflow function directly; always `start()` from `workflow/api`.

**Deep tier.** Sixtyfour has an async endpoint. The deep workflow calls it with a callback URL from `createWebhook()`, then awaits the webhook, which suspends the run at zero cost for up to the timeout, and resumes when Sixtyfour calls back. No polling. The browser agent for `legalName` follows the same pattern if it can call back; otherwise it is a step with a long timeout.

**Routes.**

`POST /v1/research` and `POST /v1/deepResearch`:

1. Auth (key tier + origin check), validate body, compute `hash`.
2. `SET hash runId NX` in Redis. If the key already existed, use the stored `runId`. If not, `start(workflow, input)` and store its `runId`. This makes the POST idempotent; two simultaneous first calls produce one run.
3. `Accept: text/event-stream` → `getRun(runId).getReadable({ startIndex })` where `startIndex` comes from `Last-Event-ID` if present. Pipe to an SSE response, setting `id:` on each event to its stream index. If the run is already complete and its stream is no longer retained, replay from the field store instead and end with `complete`.
4. `Accept: application/json` → read the snapshot from the field store, return `{ hash, status, data }`.

`GET /v1/{hash}`: look up `runId`, read the snapshot from the field store. Tenant-scoped by the hash. No workflow involvement.

**Redis layout.** Everything is regenerable from upstream providers, so Redis with persistence is sufficient; losing it means re-resolving, not data loss.

| Key                                     | Value                                           | Notes                                                          |
| --------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `run:{hash}`                            | `runId`                                         | `SET NX`; the idempotency lock                                 |
| `Sonar:{hash}`                          | set of requested field paths + route            | lets `GET` know which fields to compose                        |
| `identify:{normalizedSeed}`             | `{ personLinkedin, companyDomain, confidence }` | cross-tenant                                                   |
| `company:{domain}:{fieldPath}`          | `Field<T>` JSON incl. `resolvedAt`              | cross-tenant                                                   |
| `person:{linkedinUrl}:{fieldPath}`      | `Field<T>` JSON                                 | cross-tenant                                                   |
| `research:{subject}:{sha256(question)}` | `Field<T>` JSON                                 | cross-tenant; `subject` is domain or linkedinUrl               |
| `provider:{name}:{sha256(input)}`       | raw provider response                           | below the field layer; one Firecrawl scrape serves five fields |
| `tenant:{id}`                           | key hashes, origin allowlist                    | dashboard-managed                                              |

TTL is applied at read time against `resolvedAt`, not as a Redis expiry, because different requests carry different `ttl` values. Apply a generous Redis expiry (e.g. 180d) purely to bound memory.

**Snapshot composition.** `Sonar:{hash}` says which fields were requested; the handler reads each field's cache key, treats a missing key as `pending`, and assembles `data`. `status` is `complete` when no field is `pending`.

**Verify early.** How long a completed run's stream stays readable. If retention is shorter than a plausible reconnect window, the store-replay fallback in step 3 must be solid rather than an edge case.

## Billing

Autumn (layer over Stripe) handles all billing. Credits are the unit; different fields cost different credits because upstream providers cost different amounts.

- Autumn `check` before resolving any uncached field on a request; if the tenant has no balance, the request returns 402 with the fields it would have needed.
- Autumn `track` once per field that actually hit a provider, with the field's credit cost. Cache hits are not tracked in v1 (open question below).
- Per-field credit costs live in one table next to the catalog, keyed by field path (custom research/deepResearch keys have one cost per tier). Roughly pass-through provider cost with a margin; exact numbers TBD.
- Autumn's `@useautumn/convex` component exists if Convex is the internal store; it removes webhook handling.

Open: whether to charge for cache hits at all, and whether the eventual public pricing is credits-per-field or a flat per-call rate that abstracts the credits. Build the per-field metering either way; the pricing page can map onto it later.

## Non-goals for v1

- Webhooks
- Server-registered schemas
- Consumer phone lookup under any condition
- Provider selection exposed to customers
- Per-field default TTLs
- Speculative Firecrawl on the email domain during identify
- MCP server (planned: same config → `npx Sonar mcp` for non-eve agents)

## Open items

- Billing: cache-hit pricing and credits-per-field vs per-call (see Billing)
- Freemail and disposable-domain list sources
- Sixtyfour and Parallel prompt templates: how much resolved context to inject alongside the question
- Dashboard: key issuance, origin allowlist
- Rate limits

## Reference links

Read the actual docs before writing against any of these. Several publish `llms.txt` / `llms-full.txt` for agent consumption.

**eve (agent tools)**

- Docs index for agents: https://eve.dev/llms.txt and https://eve.dev/agents.md
- Tools (defineTool, async-generator streaming, background execution, toModelOutput): https://eve.dev/docs/tools
- Human-in-the-loop / approvals: https://eve.dev/docs/human-in-the-loop
- Execution model and durability (step replay, idempotency): https://eve.dev/docs/concepts/execution-model-and-durability
- Sessions, runs, streaming events (`action.partial`, `action.result`): https://eve.dev/docs/concepts/sessions-runs-and-streaming
- Getting started / filesystem layout: https://eve.dev/docs/getting-started
- Source: https://github.com/vercel/eve (full docs also ship in `node_modules/eve/docs`)

**Sixtyfour (phone, deepResearch)**

- Docs: https://docs.sixtyfour.ai
- People intelligence / enrich-lead (sync and async): https://docs.sixtyfour.ai/api-reference/endpoint/enrich-lead
- Tutorial notebooks: https://github.com/sixtyfour-ai/notebooks

**Parallel (funding, research)**

- Overview: https://docs.parallel.ai/getting-started/overview
- Task API quickstart: https://docs.parallel.ai/task-api/task-quickstart
- Task run lifecycle (async create/poll): https://docs.parallel.ai/task-api/guides/execute-task-run
- Research basis (citations, confidence per field, maps onto our `sources`/`confidence`): https://docs.parallel.ai/task-api/guides/access-research-basis
- Full docs for agents: https://docs.parallel.ai/llms-full.txt
- TypeScript SDK: https://www.npmjs.com/package/parallel-web

**Firecrawl (company brand fields)**

- Scrape with `branding` format: https://docs.firecrawl.dev/features/scrape
- Branding format v2 announcement (what the object contains): https://www.firecrawl.dev/blog/branding-format-v2
- Cookbook using branding: https://docs.firecrawl.dev/developer-guides/cookbooks/brand-style-guide-generator-cookbook

**Exa (identify, person fields)**

- Search reference: https://docs.exa.ai/reference/search
- Coding-agent guide: https://exa.ai/docs/reference/search-api-guide-for-coding-agents
- Get contents / livecrawl: https://docs.exa.ai/reference/get-contents
- Docs index for agents: https://exa.ai/llms.txt

**Vercel Workflow (orchestration, streams)**

- Docs: https://useworkflow.dev and https://vercel.com/docs/workflows
- Streaming (getWritable, getReadable with startIndex, reconnection): https://useworkflow.dev/docs/foundations/streaming
- Hooks and webhooks (createWebhook, resumeHook): see foundations/hooks in the docs
- Client API (start, getRun): api-reference/workflow-api in the docs
- Examples: https://github.com/vercel/workflow-examples
- Announcement: https://vercel.com/blog/introducing-workflow

**Autumn (billing)**

- Welcome / model: https://docs.useautumn.com/docs/welcome
- Credits guide: https://docs.useautumn.com/guides/credits
- Source: https://github.com/useautumn/autumn
- Convex component: https://www.convex.dev/components/autumn

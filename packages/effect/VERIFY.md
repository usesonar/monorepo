# Verify `@usesonar/effect`

Run every condition from the repository root after installing the locked workspace dependencies. This verifier checks the published Effect boundary and its deterministic test surface. It does not claim that a hosted Sonar backend, provider data, billing, cache durability, or browser CORS behavior exists.

Use Effect `4.0.0-rc.112`. The package must use the v4 `Context.Service`, `Layer`, `Schema`, `Stream`, and `Data.TaggedError` APIs. A v3 service tag, a beta-only compatibility API, or a module-level client fails the relevant condition.

## Required conditions

| ID | Pass condition | Evidence command |
| --- | --- | --- |
| EFF-01 schemas | The public schemas accept only `linkedinURL`, `fullName` plus `xURL`, or `fullName` plus `email`; return API-normalized URL, email, and domain values; preserve optional `domain` and JSON `context`; require compact TTLs from `12h` through `365d`; and separate research from deepResearch fields. | `bun test packages/effect/src/contract.test.ts --test-name-pattern='request schemas'` |
| EFF-02 result model | `initialSnapshot` starts every requested leaf as pending. It models `person` before `company`, then places custom answers at the top level after both. `question<Answer>(prompt)` gives each custom answer its top-level `Field<Answer>`; plain prompts use `Field<JSONValue>`, while selected catalog fields retain their exact catalog types and unselected or phantom fields are absent. Terminal field events keep the snapshot pending; the required complete event changes it to complete only when every requested leaf is terminal. | `bun test packages/effect/src/contract.test.ts --test-name-pattern='snapshots and protocol' && bunx tsc --pretty false -p packages/effect/tsconfig.json --composite false --noEmit` |
| EFF-03 protocol | The reducer rejects a wrong-tier or unrequested field, an exact duplicate, a terminal-to-pending regression, premature completion, duplicate completion, and every event after completion. Terminal field events keep the snapshot pending; only the required complete event may set it complete after every leaf is terminal. | `bun test packages/effect/src/contract.test.ts --test-name-pattern='snapshots and protocol'` |
| EFF-04 identity | Canonical identity normalizes equivalent seed values, handles, configuration ordering, and JSON-object key ordering. It includes the tier and normalized TTL, so either change changes the identity. | `bun test packages/effect/src/contract.test.ts --test-name-pattern='canonical identity'` |
| EFF-05 errors | `SonarClientError` is the public tagged union of request, transport, HTTP, and protocol `Data.TaggedError` values. Every `research`, `deepResearch`, and `retrieve` path maps real raw API failures to those stable tags and `Effect.catchTag` observes only the safe public structure. A raw Ky HTTP error with Authorization, request, response, and body internals cannot reach a public error. | `bun test packages/effect/src/contract.test.ts --test-name-pattern='tagged errors' && bun test packages/effect/src/client.test.ts --test-name-pattern='maps .*failures | redacts raw Ky'` |
| EFF-06 service and API Layer | `SonarClientService` is the public `Context.Service` shape with distinct `research`, `deepResearch`, and `retrieve` operations. Each derives configured custom answer types from `question<Answer>(prompt)`, preserves literal selected catalog fields through nested and whole-config spreads, and gives equivalent finite interfaces and finite type aliases the same exact required fields. It accepts a genuine empty map and a broad `Readonly<Record<string, string>>` annotation; that broad annotation exposes arbitrary custom reads as optional `Field<JSONValue>` values, and broad catalog arrays expose optional fields with their catalog value types. It rejects callable or constructable maps; reserved, malformed, numeric, or symbol finite keys; hybrid open maps with numeric or symbol own keys; a whole request or config union when any branch is reserved, malformed, or otherwise unsafe; and readonly selections containing `any` before generic inference can widen them. The layer factory accepts exactly one publishable or secret capability, plus a base URL and raw Ky options; it uses the exact research/deepResearch routes and flat request bodies, strips raw hashes from stream and retrieval snapshots, and adapts an existing `KyInstance`. | `bun test packages/effect/src/client.test.ts --test-name-pattern='API Layers' && bunx tsc --pretty false -p packages/effect/tsconfig.json --composite false --noEmit` |
| EFF-07 interruption | Taking one snapshot cancels the underlying API body. Scenario stream interruption runs a finalizer and records one interruption without a lingering producer. | `bun test packages/effect/src/client.test.ts packages/effect/src/testing.test.ts --test-name-pattern='interrupt'` |
| EFF-08 deterministic testing | `@usesonar/effect/testing` has exactly the deterministic, keyless runtime exports `Scenario`, `scenarioLayer`, and `SonarTestProbe`. Separate Layers keep fixtures and probe history isolated, and interruption runs the scenario finalizer. | `bun test packages/effect/src/testing.test.ts packages/effect/src/boundaries.test.ts --test-name-pattern='testing | runtime exports | interrupt'` |
| EFF-09 browser boundary | Production source reaches transport through public `@usesonar/api` exports and contains no backend source import, direct Ky import, direct `fetch`, dynamic transport bypass, Next.js, Node builtin, `process`, native `EventSource`, module client/runtime singleton, or timing-based verifier synchronization. The root and testing runtime export sets are exact. | `bun test packages/effect/src/boundaries.test.ts` |
| EFF-10 package proof | The packed ESM package exposes root and `./testing` declarations, externalizes Effect and API dependencies, has no generated `dist` tracked in Git, and a strict external TypeScript consumer compiles with `skipLibCheck: false`. The API and Effect tarballs contain no `workspace:` specifier and install together from local paths. | `bun run --filter @usesonar/api build && bun run --filter @usesonar/effect build && bunx publint packages/effect && bunx attw --pack packages/effect --profile esm-only && test -z "$(git ls-files packages/effect/dist)" && PACK_DIR="$(mktemp -d)" && npm pack --ignore-scripts --pack-destination "$PACK_DIR" "$PWD/packages/api" && npm pack --ignore-scripts --pack-destination "$PACK_DIR" "$PWD/packages/effect" && for TARBALL in "$PACK_DIR"/*.tgz; do tar -xOf "$TARBALL" package/package.json > "$PACK_DIR/manifest.json"; if rg -q '"workspace:' "$PACK_DIR/manifest.json"; then exit 1; fi; done && CONSUMER_DIR="$(mktemp -d)" && printf '{"compilerOptions":{"lib":["ESNext","DOM"],"module":"NodeNext","moduleResolution":"NodeNext","noEmit":true,"skipLibCheck":false,"strict":true,"target":"ESNext"},"include":["index.ts"]}\n' > "$CONSUMER_DIR/tsconfig.json" && printf 'import { SonarClient } from "@usesonar/effect"\nimport { scenarioLayer } from "@usesonar/effect/testing"\nvoid SonarClient\nvoid scenarioLayer\n' > "$CONSUMER_DIR/index.ts" && (cd "$CONSUMER_DIR" && npm init --yes && npm install "$PACK_DIR"/usesonar-api-*.tgz "$PACK_DIR"/usesonar-effect-*.tgz && npm install --save-dev typescript@7.0.2 && npx --no-install tsc -p tsconfig.json)` |

## Evidence format

Print one line for every condition. Do not mark a condition as skipped because another condition failed.

```text
PASS EFF-01 schemas
FAIL EFF-02 result model: custom answers remain nested under research
PASS EFF-03 protocol
PASS EFF-04 identity
PASS EFF-05 errors
PASS EFF-06 service and API Layer
PASS EFF-07 interruption
PASS EFF-08 deterministic testing
PASS EFF-09 browser boundary
PASS EFF-10 package proof
OVERALL FAIL @usesonar/effect: EFF-02
```

Print `OVERALL PASS @usesonar/effect` only when every condition is `PASS`. An assertion, command, package inspection, or static-boundary failure makes that condition `FAIL`; include the shortest useful reason after the condition ID.

## Full command sequence

```sh
git diff --check
bun test packages/effect/src
bun run typecheck
bun run --filter @usesonar/api build
bun run --filter @usesonar/effect build
bunx publint packages/effect
bunx attw --pack packages/effect --profile esm-only
git ls-files packages/effect/dist
just check
just check-packages
```

Inspect the `npm pack --ignore-scripts` contents after the build. The tarball must include only the declared package files and its built root and testing entrypoints; it must not include source tests, backend code, secrets, or generated artifacts tracked in the repository.

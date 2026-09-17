# `@usesonar/eve` release verifier

This file is the immutable release contract for `@usesonar/eve`. Run every required condition against source and the packed package. Existing test names, README claims, and implementation comments are evidence only; they cannot substitute for observed behavior.

This verifier specializes the shared contract in `SPEC.md` for the Eve adapter. Eve is pinned to `0.45.1`, Effect is pinned to `4.0.0-rc.112`, both factories are foreground tools unless deep research explicitly selects background execution, and background execution returns its final result normally without a delegated executor.

## Required conditions

### EVE-01 — Published boundary and exports

`@usesonar/eve` exports exactly the public factories `researchSonar` and `deepResearchSonar` from its package root. Its runtime dependency on Sonar crosses only the public `@usesonar/effect` boundary and consumes the public `SonarClient` Layer. Source and packed JavaScript do not import Ky, `@usesonar/api`, `@usesonar/backend`, provider SDKs, Next.js, application source, workspace source paths, or direct HTTP/SSE implementations.

PASS only if direct export tests, packed-package inspection, `publint`, and ATTW all pass, and forbidden-import searches return no matches.

The source manifest's runtime dependency object contains exactly `@usesonar/effect`, `effect`, and `eve`. The external dependencies stay pinned to `effect: 4.0.0-rc.112` and `eve: 0.45.1`; the internal `@usesonar/effect` range must be an exact publishable semantic version, with no `workspace:`, caret, tilde, tag, or other range syntax. The packed manifest must preserve the live source manifest's package name, version, and complete runtime dependency object, so a valid Changesets version bump does not make the verifier stale.

### EVE-02 — Factory and tool ownership

Both factories use `factory(config, options?)`. Research options are limited to `layer` and `description`; deep options add only `execution: "background"`. Config owns `ttl`, `person`, `company`, and the matching entity-owned question maps. A dynamic config owns only `dynamic: true` and `ttl`. Callers cannot spread arbitrary `defineTool` fields or replace approval, schemas, execute, output projection, or background task behavior.

Omitting `execution` produces an ordinary foreground tool. Selecting background changes only Eve execution semantics: execution returns a final Sonar value normally and never returns `task.delegated(...)`. Creating or importing a tool performs no Effect run, environment read, network call, or key validation.

PASS only if runtime shape tests, type-negative fixtures, lazy-environment tests, and the forbidden-option cases all pass.

### EVE-03 — Static input and seed validation

Static config puts each built-in selection and question map under its `person` or `company` entity. The model input contains only a seed with optional `linkedinURL`, `fullName`, `xURL`, `email`, `domain`, and JSON `context`, and it accepts the seed only when at least one prerequisite is present: `linkedinURL`, `fullName` plus `xURL`, or `fullName` plus `email`.

Static input uses the shared `SonarSeed` boundary, including its decoded trimming behavior. It rejects missing prerequisites, partial pairs, unknown keys, malformed URLs or email, whitespace-only domains, and non-JSON context. The malformed email cases include `.a@example.com`, `a..b@example.com`, and `a@-example.com`. `ttl` accepts compact durations from `12h` through `365d` inclusive and rejects values outside that range, the unsupported `y` unit, or non-compact spellings.

PASS only if the Standard Schema exposed to Eve accepts every valid branch, rejects every invalid branch, and no rejected input reaches the injected `SonarClient`.

### EVE-04 — Dynamic input ownership

With `dynamic: true`, the model input owns the `person` and `company` entity maps in addition to the seed. Each entity can contain its tier's built-in selections and matching `research` or `deepResearch` question map. `ttl`, `execution`, and the appended description remain developer-owned and never appear in model input. Dynamic input uses the correct tier catalog, lists `person` before `company`, rejects wrong-tier fields, and requires at least one requested built-in or entity-owned question.

Custom keys are camelCase identifiers and reject the reserved keys `ttl`, `person`, `company`, `research`, and `deepResearch`. Research values are authored validators: Zod, raw JSON Schema, or `StandardJSONSchemaV1`. They compile to wire JSON Schema with a non-empty root description. Deep-research values are non-empty prompt strings and always resolve to string fields. Static and dynamic validation apply the same route rules.

The Effect request preserves insertion order as `seed`, `ttl`, `person`, then `company`, with question maps nested under their entity. PASS only if Standard Schema validation and request-routing assertions cover both tiers and results preserve the matching entity namespace.

### EVE-05 — Generated descriptions and schemas

Descriptions are deterministic and list the exact selected entity fields in configuration order, including namespaced answer keys. They state the tier's expected latency. Dynamic descriptions list the selectable catalog and model-supplied question behavior. A caller description is appended after the generated description without replacing it.

Input and output remain actual Effect Schema values for which `Schema.isSchema` returns `true`. Eve `0.45.1` can consume the same values through Standard Schema and compile them to JSON Schema. The output schema is the full `{ status, data }` snapshot, whose custom fields remain under `data.person.research`, `data.company.research`, `data.person.deepResearch`, or `data.company.deepResearch`. A typed research validator infers its output type; raw JSON Schema infers `JSONValue`; deep-research prompts infer `string`. Finite maps produce exact required fields, while broad maps expose optional reads. Dynamic built-ins remain partial, and explicit dynamic `<Answers>` fields remain optional because the model owns and can omit question keys. The explicit map records `person` or `company` ownership and requires finite lower-camel answer maps. The locked TypeScript 5 semantic probe proves that default dynamic callback data is not `never`, preserves nested optional dynamic fields, and retains static validator inference.

PASS only if exact description tests, Standard Schema validation, JSON Schema conversion, and compile-time inference fixtures all pass for research, deep, static, and dynamic forms.

### EVE-06 — Research streaming and full snapshots

Foreground `researchSonar` executes as an async generator. It yields every complete progressive `{ status, data }` snapshot received from `SonarClient`, including the final complete snapshot; each yield replaces the preceding snapshot. A snapshot's `data` contains every requested leaf and retains full field state for channels, hooks, and clients, including `pending`, `resolved`, `notFound`, and `skipped` details.

The Eve-native research and deep foreground fixtures observe `action.partial` events before the final `action.result`. The final result equals the final full snapshot, and there is no direct network access when a Layer is injected.

PASS only if direct generator tests and the deterministic Eve eval both observe the complete ordered snapshots and final result.

### EVE-07 — Deep foreground and selected background forms

Foreground `deepResearchSonar` returns or streams using the tool semantics supported by Eve `0.45.1` and the supplied `SonarClient`. The selected background form has `execution: "background"`, returns the final full snapshot as a normal value, and does not manufacture a delegated receipt, custom executor, polling loop, `task.send`, or reconciliation mechanism.

Both forms route only to deep research, preserve full result snapshots for Eve runtime consumers, and never require `experimental.tasks` unless background execution is actually selected by the caller.

PASS only if direct foreground/background tests and separate Eve-native foreground/background evals cover all result forms and reject research/deep route crossover.

### EVE-08 — Model output projection

`toModelOutput` projects from the full snapshot's `data` into Eve JSON model output whose `value` preserves each entity and its matching answer namespace. Every included leaf has own-key order `value`, then `confidence`. Unresolved leaves and empty containers are omitted.

Static factories treat their validated configured answer keys as authoritative, so unconfigured nested leaves are omitted. Dynamic factories project every schema-valid nested answer they receive; they do not infer the model's selected question keys again inside `toModelOutput`, because the Effect request and protocol boundaries already prevent unrequested leaves from reaching a valid snapshot. Projection omits the snapshot envelope and any envelope hash, plus per-field `status`, `sources`, and timestamps such as `resolvedAt`. It never mutates the full snapshot, so the Eve `action.result`, channels, hooks, and clients retain the full value.

PASS only if adversarial mixed-state fixtures compare the exact projected JSON value and independently compare the unchanged full snapshot.

### EVE-09 — Cancellation and errors

The Eve `AbortSignal` interrupts the Effect runtime for research, deep foreground, and deep background execution. Cancellation settles promptly, reaches the injected service, emits no successful final value after abort, and leaves no timer, fiber, retry, or network request running.

Validation, config, default-Layer, and service failures use one package-owned tagged Eve error family. Its public message is actionable, but its complete own-property graph never contains a cause, stack trace, headers, body, authorization value, credential, provider name, job ID, hash, cache key, or other private transport detail.

PASS only if blocking-service cancellation probes and hostile-error fixtures pass for all three execution forms.

### EVE-10 — Lazy default client and secret safety

Without an injected Layer, execution lazily builds the default Effect client from `SONAR_BASE_URL` and `SONAR_SECRET_KEY`. Neither variable is read during module import or factory creation. Missing configuration fails only when execution begins, with a sanitized prerequisite error before any network request.

Direct and Eve-native tests run with global network disabled and no secret. The deterministic suite never requires `OPENAI_API_KEY`, `SONAR_SECRET_KEY`, Vercel credentials, or a hosted Sonar endpoint, and it never logs their values.

PASS only if import/factory tests succeed with poisoned environment access, injected-Layer tests succeed with global fetch throwing, and missing-default-client tests fail without network access or secret disclosure.

### EVE-11 — Deterministic Eve-native routing eval

An Eve app fixture uses `mockModel` from `eve/evals` to make deterministic tool calls without a model provider. The fixture mounts the two factories as `research-sonar` and `deep-research-sonar`, proving that Eve derives model-visible identity from the consuming filename. It routes research-shaped requests only to the research factory, routes deep-shaped requests only to the deep factory, supplies every seed prerequisite, and receives only the sanitized model projection after execution.

The eval uses no judge, no remote target, no API key, and one deterministic attempt. It fails on unexpected tool names, wrong input, failed actions, missing partial events, raw snapshot leakage, or extra calls.

PASS only if the Eve `eval --strict` command completes locally with every gate assertion passing.

### EVE-12 — Optional live Responses smoke eval

The optional live verifier uses the OpenAI Responses API with model `gpt-5.6-luna`, reasoning effort `low`, `store: false`, and one attempt. It exercises routing and seed prerequisites against an injected deterministic Sonar Layer, never a hosted Sonar service. It skips with a distinct `UNAVAILABLE` result when `OPENAI_API_KEY` is absent. When present, the key is used only as the Authorization credential sent to `api.openai.com`; it is never logged, serialized into a prompt or result, forwarded to Sonar, or sent to any other host.

This condition is informational and never gates CI or the required overall verdict. If run, report `PASS`, `FAIL`, or `UNAVAILABLE` separately.

### EVE-13 — Package and source hygiene

The package uses an exact publishable semantic version for `@usesonar/effect` and pins `eve` to `0.45.1` and `effect` to `4.0.0-rc.112`. Its packed name, version, and dependencies match the live source manifest, including after Changesets versioning. It builds neutral ESM plus declarations, publishes no generated source, and contains no `.only`, `.skip`, or `.todo` in verifier tests. The native fixture ignores `.eve/`, so a deterministic eval leaves no visible runtime or workflow artifact. Every user-visible package change has a changeset, and generated `dist` files remain untracked.

PASS only if scoped tests, package build, `publint`, ATTW, dry-pack inspection, changeset status, forbidden-marker search, and `git diff --check` all pass.

## Commands

Run from the repository root unless a command changes directory explicitly.

```sh
bun test packages/eve/src packages/eve/test
bunx --package typescript@5.9.3 tsc -p packages/eve/test/typescript5/tsconfig.json
bun run typecheck
bun run --filter @usesonar/eve build
bunx publint packages/eve
bunx attw --pack packages/eve --profile esm-only
(cd packages/eve/test/eve-native && bunx eve@0.45.1 eval --strict)
git status --short -- packages/eve/test/eve-native/.eve
rg -n '\.(only|skip|todo)\(' packages/eve/src packages/eve/test packages/eve/verify
rg -n 'ky|@usesonar/(api|backend)|apps/next|task\.(delegated|send)' packages/eve/src
rg -n 'SONAR_(BASE_URL|SECRET_KEY)' packages/eve/src/runtime.ts
git diff --check -- packages/eve
git status --short packages/eve/dist
```

Build first, then inspect a script-disabled dry pack rather than trusting the workspace import:

```sh
npm pack --ignore-scripts --dry-run --json ./packages/eve
```

The optional live check is separate:

```sh
bun packages/eve/verify/live-responses.ts
```

## Verdict

Print exactly one `PASS EVE-NN` or `FAIL EVE-NN — reason` line for EVE-01 through EVE-11 and EVE-13. Print `PASS`, `FAIL`, or `UNAVAILABLE EVE-12` separately if the optional live check is attempted.

Print `OVERALL PASS @usesonar/eve` only when every required condition passes. Otherwise print `OVERALL FAIL @usesonar/eve` followed by the blocking condition IDs. Passing repository-authored tests alone is insufficient evidence for an overall pass.

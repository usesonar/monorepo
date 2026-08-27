# `@usesonar/eve`

`@usesonar/eve` creates Eve 0.45.1 tools for Sonar research and deep research. Each factory derives its input schema, output schema, generated description, execution, and model projection from one validated config.

## Install after the first public release

```sh
bun add @usesonar/eve @usesonar/effect
```

## Create a static tool

Static tools keep the TTL, field selection, and questions under developer control. The model supplies only the identity seed.

```ts
// agent/tools/research-sonar.ts
import { question } from "@usesonar/effect"
import { researchSonar } from "@usesonar/eve"

type AccountSignals = {
  intent: "low" | "medium" | "high"
  evidence: string[]
}

export default researchSonar({
  ttl: "7d",
  person: ["title", "linkedin"],
  company: ["domain", "name"],
  research: {
    accountSignals: question<AccountSignals>("Which buying signals are publicly visible?"),
  },
})
```

Static tools infer output from that config. The branded prompt makes `data.accountSignals` a required `Field<AccountSignals>`, plain prompt strings produce required `Field<JSONValue>` values, and selected built-ins retain their exact catalog types. Keep the config literal or use `satisfies` for precise inference. Finite interfaces and finite type aliases keep exact required fields. A question map annotated as `Readonly<Record<string, string>>` exposes arbitrary custom reads as `Field<JSONValue> | undefined`, while broad catalog arrays make reads optional without changing catalog value types. Union, optional-keyed, callable, constructable, and numeric or symbol key hybrid maps are rejected.

Without an injected Layer, execution reads `SONAR_BASE_URL` and `SONAR_SECRET_KEY`. Imports and factory creation do not read those variables or make a network request.

Research and deep research execute in the foreground by default and stream every full `{ status, data }` snapshot. Select Eve background execution for deep research only when the consuming agent needs it:

```ts
// agent/tools/deep-research-sonar.ts
import { question } from "@usesonar/effect"
import { deepResearchSonar } from "@usesonar/eve"

export default deepResearchSonar(
  {
    ttl: "7d",
    person: ["phone"],
    company: ["legalName"],
    deepResearch: {
      taxExposure: question<boolean>("Does this company have multi-state tax exposure?"),
    },
  },
  { execution: "background" }
)
```

The background form returns the final full snapshot normally. It does not return a delegated receipt or create a polling executor.

## Let the model select fields

Dynamic tools keep TTL under developer control and move the tier's person fields, company fields, and custom question map into model input:

```ts
import { researchSonar } from "@usesonar/eve"

type DynamicAnswers = {
  accountSignals: {
    intent: "low" | "medium" | "high"
    evidence: string[]
  }
}

export default researchSonar<DynamicAnswers>({
  dynamic: true,
  ttl: "7d",
})
```

Dynamic Eve is the other intentional explicit-map surface: the model owns the question keys at execution time, so declared `DynamicAnswers` fields are optional in the output rather than promises that a key will be requested. The map is type-only and does not request keys or runtime-validate their answer shapes. It requires a finite, non-union interface or type alias with required lower-camel keys and rejects callable or constructable maps and numeric or symbol key hybrids. Raw API retrieval is the only other explicit-map surface. Without an explicit map, the type exposes the optional built-in catalogs but does not invent names for model-selected custom keys. Dynamic input must select at least one valid built-in or custom field. It cannot supply TTL, execution mode, or a replacement description.

Eve actions and channels receive the full progressive snapshot. `toModelOutput` exposes only resolved fields as `{ value, confidence }`, keeps built-ins under `person` and `company`, and keeps custom answers at the top level. Static tools project only their configured custom keys. Dynamic tools project every schema-valid, non-reserved top-level answer they receive because the upstream Effect protocol has already limited those keys to the request. The projection ignores envelope and transport extras, including a raw envelope hash, and strips each field's `status`, `sources`, and `resolvedAt`. A validated custom answer named `provider`, `cache`, `jobId`, or `hash` remains answer data.

Pass `{ layer }` in the factory options to inject a deterministic `@usesonar/effect` Layer for tests. Research options also accept an appended `description`; deep-research options add only `execution: "background"`.

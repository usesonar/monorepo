/* eslint-disable sort-keys, typescript/consistent-type-definitions, typescript/no-explicit-any, unicorn/consistent-function-scoping -- The external compiler fixture preserves source-order contract examples and genuine interface probes while proving explicit any cannot bypass factory constraints. */
import type { Field, JSONValue, ResearchConfig, StandardJSONSchemaV1 } from "@usesonar/effect"
import { deepResearchSonar, researchSonar } from "@usesonar/eve"

type IsNever<Value> = [Value] extends [never] ? true : false
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type AssertTrue<Value extends true> = Value

const typedValidator = <Output extends JSONValue>(
  description: string,
  schema: Readonly<Record<string, JSONValue>>
): StandardJSONSchemaV1<unknown, Output> => ({
  "~standard": {
    jsonSchema: {
      input: () => ({ description, ...schema }),
      output: () => ({ description, ...schema }),
    },
    vendor: "eve-typescript5-test",
    version: 1,
  },
})

const staticResearch = researchSonar({
  person: {
    title: true,
    research: {
      jobFit: typedValidator<boolean>("Assess role fit.", { type: "boolean" }),
    },
  },
  company: {
    name: true,
    research: {
      signals: {
        description: "Return public buying signals.",
        type: "array",
      },
    },
  },
  ttl: "12h",
})

const staticDeep = deepResearchSonar({
  person: { phone: true, deepResearch: { biography: "Write a biography." } },
  company: { deepResearch: { ownership: "Describe ownership." } },
  ttl: "12h",
})

const dynamicResearch = researchSonar<{
  readonly person: { readonly jobFit: boolean }
  readonly company: { readonly signals: string[] }
}>({ dynamic: true, ttl: "12h" })

const dynamicDeep = deepResearchSonar<{
  readonly company: { readonly ownership: string }
}>({ dynamic: true, ttl: "12h" })

const backgroundDeep = deepResearchSonar<{
  readonly person: { readonly biography: string }
}>({ dynamic: true, ttl: "12h" }, { execution: "background" })

type StaticResearchNext = Awaited<ReturnType<ReturnType<typeof staticResearch.execute>["next"]>>
type StaticResearchSnapshot = Exclude<StaticResearchNext["value"], undefined>
type StaticDeepNext = Awaited<ReturnType<ReturnType<typeof staticDeep.execute>["next"]>>
type StaticDeepSnapshot = Exclude<StaticDeepNext["value"], undefined>
type DynamicResearchProjection = Parameters<NonNullable<typeof dynamicResearch.toModelOutput>>[0]
type DynamicDeepProjection = Parameters<NonNullable<typeof dynamicDeep.toModelOutput>>[0]
type BackgroundDeepOutput = Awaited<ReturnType<typeof backgroundDeep.execute>>

type StaticTitleIsExact = AssertTrue<
  Equal<StaticResearchSnapshot["data"]["person"]["title"], Field<string>>
>
type StaticResearchAnswerIsExact = AssertTrue<
  Equal<StaticResearchSnapshot["data"]["person"]["research"]["jobFit"], Field<boolean>>
>
type StaticRawSchemaAnswerIsJSON = AssertTrue<
  Equal<StaticResearchSnapshot["data"]["company"]["research"]["signals"], Field<JSONValue>>
>
type StaticDeepAnswerIsString = AssertTrue<
  Equal<StaticDeepSnapshot["data"]["person"]["deepResearch"]["biography"], Field<string>>
>
type DynamicPersonAnswerIsOptional = AssertTrue<
  Equal<
    NonNullable<DynamicResearchProjection["data"]["person"]["research"]>["jobFit"],
    Field<boolean> | undefined
  >
>
type DynamicCompanyAnswerIsOptional = AssertTrue<
  Equal<
    NonNullable<DynamicDeepProjection["data"]["company"]["deepResearch"]>["ownership"],
    Field<string> | undefined
  >
>
type BackgroundOutputIsSnapshot = AssertTrue<
  Equal<
    NonNullable<BackgroundDeepOutput["data"]["person"]["deepResearch"]>["biography"],
    Field<string> | undefined
  >
>

const broadConfig = (config: ResearchConfig) => {
  const tool = researchSonar(config)
  type Next = Awaited<ReturnType<ReturnType<typeof tool.execute>["next"]>>
  type Snapshot = Exclude<Next["value"], undefined>
  const title = (snapshot: Snapshot): Field<string> | undefined => snapshot.data.person.title
  return title
}

type BroadConfigIsUsable = AssertTrue<Equal<IsNever<Parameters<typeof broadConfig>[0]>, false>>
type DynamicInputIsUsable = AssertTrue<
  Equal<IsNever<Parameters<typeof dynamicResearch.execute>[0]>, false>
>

declare const selectionAny: any
declare const answerSymbol: unique symbol

const assertInvalidContracts = () => {
  // @ts-expect-error Research selections are boolean entity properties, not arrays.
  researchSonar({ person: ["title"], company: {}, ttl: "12h" })
  // @ts-expect-error Research answer maps remain entity-owned.
  researchSonar({ person: { title: true }, company: {}, research: {}, ttl: "12h" })
  // @ts-expect-error Research does not accept deep-research prompts.
  researchSonar({ person: { deepResearch: {} }, company: {}, ttl: "12h" })
  // @ts-expect-error Deep research does not accept research validators.
  deepResearchSonar({ person: {}, company: { research: {} }, ttl: "12h" })
  // @ts-expect-error Built-in selections must be literal true.
  researchSonar({ person: { title: false }, company: {}, ttl: "12h" })
  // @ts-expect-error Explicit any cannot bypass built-in selection validation.
  researchSonar({ person: { title: selectionAny }, company: {}, ttl: "12h" })
  // @ts-expect-error Research question keys must be lower camel case.
  researchSonar({
    person: { research: { BadKey: { description: "No.", type: "string" } } },
    company: {},
    ttl: "12h",
  })
  // @ts-expect-error Research question maps cannot contain symbol keys.
  researchSonar({
    person: {
      research: { [answerSymbol]: { description: "No.", type: "string" } },
    },
    company: {},
    ttl: "12h",
  })
  // @ts-expect-error Dynamic answer maps must identify person or company ownership.
  researchSonar<{ jobFit: boolean }>({ dynamic: true, ttl: "12h" })
  // @ts-expect-error Dynamic research answer maps must be finite.
  researchSonar<{ person: Readonly<Record<string, JSONValue>> }>({
    dynamic: true,
    ttl: "12h",
  })
  // @ts-expect-error Dynamic deep-research values are strings.
  deepResearchSonar<{ company: { ownership: number } }>({ dynamic: true, ttl: "12h" })
}

void assertInvalidContracts
const typeAssertions = [
  true satisfies StaticTitleIsExact,
  true satisfies StaticResearchAnswerIsExact,
  true satisfies StaticRawSchemaAnswerIsJSON,
  true satisfies StaticDeepAnswerIsString,
  true satisfies DynamicPersonAnswerIsOptional,
  true satisfies DynamicCompanyAnswerIsOptional,
  true satisfies BackgroundOutputIsSnapshot,
  true satisfies BroadConfigIsUsable,
  true satisfies DynamicInputIsUsable,
]
void typeAssertions

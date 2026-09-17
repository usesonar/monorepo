import { describe, expect, it } from "bun:test"

import type {
  DeepResearchConfig,
  Field,
  JSONValue,
  ResearchConfig,
  ResearchValidator,
  SonarClientError,
  StandardJSONSchemaV1,
} from "@usesonar/effect"
import { createElement } from "react"

import { SonarProvider, useDeepSonar, useSonar } from "./index"

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Condition extends true> = Condition
type ResolvedValue<Value> =
  Extract<Value, { status: "resolved" }> extends { value: infer Resolved } ? Resolved : never

declare const booleanValidator: StandardJSONSchemaV1<unknown, boolean>
declare const numericQuestions: { readonly 0: ResearchValidator<number> }
declare const questionKey: unique symbol
declare const optionalResearchQuestions: { readonly maybe?: ResearchValidator<string> }
declare const optionalDeepQuestions: { readonly maybe?: string }
declare const symbolResearchQuestions: { readonly [questionKey]: ResearchValidator<string> }
declare const symbolDeepQuestions: { readonly [questionKey]: string }
declare const callableResearchQuestions: (() => void) & {
  readonly validKey: ResearchValidator<string>
}
declare const constructableDeepQuestions: (new () => object) & { readonly validKey: string }

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier preserves interface-declared question maps.
interface InterfaceResearchQuestions {
  readonly accountFit: StandardJSONSchemaV1<unknown, boolean>
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier preserves interface-declared configs.
interface InterfaceResearchConfig {
  readonly company: { readonly name: true }
  readonly person: {
    readonly research: InterfaceResearchQuestions
    readonly title: true
  }
  readonly ttl: "12h"
}

type AliasResearchConfig = {
  readonly company: { readonly name: true }
  readonly person: {
    readonly research: { readonly accountFit: StandardJSONSchemaV1<unknown, boolean> }
    readonly title: true
  }
  readonly ttl: "12h"
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier preserves interface-declared deep maps.
interface InterfaceDeepQuestions {
  readonly integrationNotes: string
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier preserves interface-declared deep configs.
interface InterfaceDeepConfig {
  readonly company: {
    readonly deepResearch: InterfaceDeepQuestions
    readonly legalName: true
  }
  readonly person: { readonly phone: true }
  readonly ttl: "365d"
}

declare const aliasResearchConfig: AliasResearchConfig
declare const interfaceDeepConfig: InterfaceDeepConfig
declare const interfaceResearchConfig: InterfaceResearchConfig

type ValidResearchUnionBranch = {
  readonly company: { readonly name: true }
  readonly person: {
    readonly research: { readonly goodKey: ResearchValidator<string> }
    readonly title: true
  }
  readonly ttl: "12h"
}
type InvalidResearchUnionBranch = {
  readonly company: { readonly name: true }
  readonly person: {
    readonly research: { readonly bad_key: ResearchValidator<string> }
    readonly title: true
  }
  readonly ttl: "12h"
}
type ValidDeepUnionBranch = {
  readonly company: {
    readonly deepResearch: { readonly goodKey: string }
    readonly legalName: true
  }
  readonly person: { readonly phone: true }
  readonly ttl: "12h"
}
type InvalidDeepUnionBranch = {
  readonly company: {
    readonly deepResearch: { readonly bad_key: string }
    readonly legalName: true
  }
  readonly person: { readonly phone: true }
  readonly ttl: "12h"
}

declare const researchUnion: InvalidResearchUnionBranch | ValidResearchUnionBranch
declare const deepUnion: InvalidDeepUnionBranch | ValidDeepUnionBranch

const useTypecheckPublicContract = () => {
  const researchConfig = {
    company: {
      name: true,
      research: { narrative: { description: "Summarize the company.", type: "string" } },
    },
    person: {
      linkedin: true,
      research: { isTechnical: booleanValidator },
      title: true,
    },
    ttl: "12h",
  } as const
  const research = useSonar({ ...researchConfig })
  const interfaceResearch = useSonar(interfaceResearchConfig)
  const aliasResearch = useSonar(aliasResearchConfig)

  type ResearchData = NonNullable<typeof research.data>
  type InterfaceResearchData = NonNullable<typeof interfaceResearch.data>
  type AliasResearchData = NonNullable<typeof aliasResearch.data>
  type _ExactResearchKeys = Assert<Equal<keyof ResearchData, "company" | "person">>
  type _ExactResearchPersonKeys = Assert<
    Equal<keyof ResearchData["person"], "linkedin" | "research" | "title">
  >
  type _ExactResearchCompanyKeys = Assert<Equal<keyof ResearchData["company"], "name" | "research">>
  type _TypedValidator = Assert<
    Equal<ResolvedValue<ResearchData["person"]["research"]["isTechnical"]>, boolean>
  >
  type _RawJSONSchema = Assert<
    Equal<ResolvedValue<ResearchData["company"]["research"]["narrative"]>, JSONValue>
  >
  type _InterfaceQuestion = Assert<
    Equal<ResolvedValue<InterfaceResearchData["person"]["research"]["accountFit"]>, boolean>
  >
  type _AliasQuestion = Assert<
    Equal<AliasResearchData["person"]["research"], InterfaceResearchData["person"]["research"]>
  >
  type _KnownField = Assert<ResearchData["person"]["title"] extends Field<string> ? true : false>
  type _ResultKeys = Assert<
    Equal<keyof typeof research, "data" | "error" | "loading" | "resolve" | "status">
  >
  type _TypedError = Assert<Equal<typeof research.error, SonarClientError | null>>
  type _IdleStatus = Assert<Equal<typeof research.status, "pending" | "complete" | undefined>>
  const researchBoolean: Field<boolean> | undefined = research.data?.person.research.isTechnical
  const researchJSON: Field<JSONValue> | undefined = research.data?.company.research.narrative
  expect(researchBoolean).toBeUndefined()
  expect(researchJSON).toBeUndefined()

  const broadResearchConfig: ResearchConfig = researchConfig
  const broadResearch = useSonar(broadResearchConfig)
  type BroadResearchData = NonNullable<typeof broadResearch.data>
  type _BroadResearchPersonIsOptional = Assert<
    BroadResearchData["person"]["title"] extends Field<string> | undefined ? true : false
  >
  type _BroadResearchCompanyIsOptional = Assert<
    BroadResearchData["company"]["name"] extends Field<string> | undefined ? true : false
  >
  type _BroadResearchAnswerIsOptional = Assert<
    NonNullable<BroadResearchData["person"]["research"]>["arbitraryAnswer"] extends
      | Field<JSONValue>
      | undefined
      ? true
      : false
  >

  // @ts-expect-error -- an unselected built-in cannot appear in the exact result.
  expect(research.data?.person.github).toBeUndefined()
  // @ts-expect-error -- entity-owned questions never become top-level fields.
  expect(research.data?.isTechnical).toBeUndefined()
  // @ts-expect-error -- only configured research keys appear in the exact namespace.
  expect(research.data?.person.research.phantomAnswer).toBeUndefined()

  const deepConfig = {
    company: {
      deepResearch: { vendorNotes: "Summarize its accounting stack." },
      legalName: true,
    },
    person: {
      deepResearch: { careerHistory: "Summarize this person's career." },
      phone: true,
    },
    ttl: "365d",
  } as const
  const deep = useDeepSonar({ ...deepConfig })
  const interfaceDeep = useDeepSonar(interfaceDeepConfig)
  type DeepData = NonNullable<typeof deep.data>
  type InterfaceDeepData = NonNullable<typeof interfaceDeep.data>
  type _ExactDeepKeys = Assert<Equal<keyof DeepData, "company" | "person">>
  type _ExactDeepPersonKeys = Assert<Equal<keyof DeepData["person"], "deepResearch" | "phone">>
  type _ExactDeepCompanyKeys = Assert<
    Equal<keyof DeepData["company"], "deepResearch" | "legalName">
  >
  type _DeepAnswerIsString = Assert<
    Equal<ResolvedValue<DeepData["company"]["deepResearch"]["vendorNotes"]>, string>
  >
  type _InterfaceDeepAnswer = Assert<
    ResolvedValue<InterfaceDeepData["company"]["deepResearch"]["integrationNotes"]> extends string
      ? true
      : false
  >
  const deepString: Field<string> | undefined = deep.data?.person.deepResearch.careerHistory
  expect(deepString).toBeUndefined()

  const broadDeepConfig: DeepResearchConfig = deepConfig
  const broadDeep = useDeepSonar(broadDeepConfig)
  type BroadDeepData = NonNullable<typeof broadDeep.data>
  type _BroadDeepPersonIsOptional = Assert<
    BroadDeepData["person"]["phone"] extends Field<string> | undefined ? true : false
  >
  type _BroadDeepAnswerIsOptional = Assert<
    NonNullable<BroadDeepData["company"]["deepResearch"]>["arbitraryAnswer"] extends
      | Field<string>
      | undefined
      ? true
      : false
  >

  // @ts-expect-error -- a research hook cannot select a deep-research built-in.
  useSonar({ company: {}, person: { phone: true }, ttl: "12h" })
  // @ts-expect-error -- a deep hook cannot select a research built-in.
  useDeepSonar({ company: {}, person: { title: true }, ttl: "12h" })
  // @ts-expect-error -- research cannot accept a deep-research namespace.
  useSonar({ company: {}, person: { deepResearch: { score: "Score it." } }, ttl: "12h" })
  // @ts-expect-error -- deep research cannot accept a research namespace.
  useDeepSonar({ company: { research: { score: booleanValidator } }, person: {}, ttl: "12h" })
  // @ts-expect-error -- research questions require a JSON-Schema-capable validator.
  useSonar({ company: { research: { score: "Score it." } }, person: {}, ttl: "12h" })
  // @ts-expect-error -- deep-research questions are plain prompts, not validators.
  useDeepSonar({ company: { deepResearch: { score: booleanValidator } }, person: {}, ttl: "12h" })
  // @ts-expect-error -- a custom key must be a lower-camel identifier.
  useSonar({ company: { research: { BadKey: booleanValidator } }, person: {}, ttl: "12h" })
  // @ts-expect-error -- reserved config keys cannot become research answer keys.
  useSonar({ company: { research: { person: booleanValidator } }, person: {}, ttl: "12h" })
  // @ts-expect-error -- research maps cannot contain numeric keys.
  useSonar({ company: { research: numericQuestions }, person: {}, ttl: "12h" })
  // @ts-expect-error -- research maps cannot contain symbol keys.
  useSonar({ company: {}, person: { research: symbolResearchQuestions }, ttl: "12h" })
  // @ts-expect-error -- deep-research maps cannot contain symbol keys.
  useDeepSonar({ company: { deepResearch: symbolDeepQuestions }, person: {}, ttl: "12h" })
  // @ts-expect-error -- finite research question keys cannot be optional.
  useSonar({ company: { research: optionalResearchQuestions }, person: {}, ttl: "12h" })
  // @ts-expect-error -- finite deep-research question keys cannot be optional.
  useDeepSonar({ company: {}, person: { deepResearch: optionalDeepQuestions }, ttl: "12h" })
  // @ts-expect-error -- callable objects are not research question maps.
  useSonar({ company: { research: callableResearchQuestions }, person: {}, ttl: "12h" })
  // @ts-expect-error -- constructable objects are not deep-research question maps.
  useDeepSonar({ company: { deepResearch: constructableDeepQuestions }, person: {}, ttl: "12h" })
  // @ts-expect-error -- a union cannot hide an invalid research branch.
  useSonar(researchUnion)
  // @ts-expect-error -- a union cannot hide an invalid deep-research branch.
  useDeepSonar(deepUnion)

  useSonar({ company: { research: {} }, person: {}, ttl: "12h" })
  useDeepSonar({ company: {}, person: { deepResearch: {} }, ttl: "12h" })

  // @ts-expect-error -- the minimum TTL is twelve hours.
  useSonar({ company: {}, person: { title: true }, ttl: "11h" })
  // @ts-expect-error -- the maximum TTL is one year.
  useSonar({ company: {}, person: { title: true }, ttl: "366d" })

  research.resolve({ linkedinURL: "https://linkedin.com/in/ada" })
  research.resolve({ fullName: "Ada", xURL: "https://x.com/ada" })
  research.resolve({ email: "ada@example.test", fullName: "Ada Lovelace" })
  // @ts-expect-error -- email alone is not an identity branch.
  research.resolve({ email: "ada@example.test" })
  // @ts-expect-error -- fullName alone is not an identity branch.
  research.resolve({ fullName: "Ada Lovelace" })
  // @ts-expect-error -- domain is supporting context, not a complete identity branch.
  research.resolve({ domain: "example.test" })
  // @ts-expect-error -- context must contain JSON values.
  research.resolve({ context: { callback: () => {} }, linkedinURL: "https://example.test" })

  // @ts-expect-error -- the provider requires a valid SonarClient Layer.
  createElement(SonarProvider, { layer: null }, null)
}

describe("public React types", () => {
  it("keeps compile-time contract checks in the TypeScript project", () => {
    expect(useTypecheckPublicContract).toBeFunction()
  })
})

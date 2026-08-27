import { describe, expect, it } from "bun:test"

import { question } from "@usesonar/effect"
import type {
  DeepResearchConfig,
  Field,
  JSONValue,
  ResearchConfig,
  SonarClientError,
} from "@usesonar/effect"
import { createElement } from "react"

import { SonarProvider, useDeepSonar, useSonar } from "./index"

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false

type Assert<Condition extends true> = Condition
type ResolvedValue<Value> =
  Extract<Value, { status: "resolved" }> extends {
    value: infer Resolved
  }
    ? Resolved
    : never

declare const numericQuestions: { readonly 0: string }
declare const questionKey: unique symbol
declare const optionalQuestions: { readonly maybe?: string }
declare const symbolQuestions: { readonly [questionKey]: string }

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier must preserve public behavior for interface-declared question maps.
interface InterfaceResearchQuestions {
  readonly accountFit: string
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier must preserve public behavior for interface-declared configs.
interface InterfaceResearchConfig {
  readonly company: readonly ["name"]
  readonly person: readonly ["title"]
  readonly research: InterfaceResearchQuestions
  readonly ttl: "12h"
}

declare const interfaceResearchConfig: InterfaceResearchConfig

type AliasResearchConfig = {
  readonly company: readonly ["name"]
  readonly person: readonly ["title"]
  readonly research: { readonly accountFit: string }
  readonly ttl: "12h"
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier must preserve public behavior for interface-declared question maps.
interface InterfaceDeepQuestions {
  readonly integrationCount: string
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier must preserve public behavior for interface-declared configs.
interface InterfaceDeepConfig {
  readonly company: readonly ["legalName"]
  readonly deepResearch: InterfaceDeepQuestions
  readonly person: readonly ["phone"]
  readonly ttl: "365d"
}

type AliasDeepConfig = {
  readonly company: readonly ["legalName"]
  readonly deepResearch: { readonly integrationCount: string }
  readonly person: readonly ["phone"]
  readonly ttl: "365d"
}

type CallableQuestions = () => void
type ConstructableQuestions = new () => object

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier must reject optional interface-declared question keys.
interface OptionalInterfaceQuestions {
  readonly maybe?: string
}

type HybridNumericQuestions = Readonly<Record<string, string>> & { readonly 0: string }
type HybridSymbolQuestions = Readonly<Record<string, string>> & {
  readonly [questionKey]: string
}

declare const aliasDeepConfig: AliasDeepConfig
declare const aliasResearchConfig: AliasResearchConfig
declare const callableQuestions: CallableQuestions
declare const constructableQuestions: ConstructableQuestions
declare const hybridNumericQuestions: HybridNumericQuestions
declare const hybridSymbolQuestions: HybridSymbolQuestions
declare const interfaceDeepConfig: InterfaceDeepConfig
declare const optionalInterfaceQuestions: OptionalInterfaceQuestions

type ValidResearchUnionBranch = {
  readonly company: readonly ["name"]
  readonly person: readonly ["title"]
  readonly research: { readonly goodKey: string }
  readonly ttl: "12h"
}
type ValidDeepUnionBranch = {
  readonly company: readonly ["legalName"]
  readonly deepResearch: { readonly goodKey: string }
  readonly person: readonly ["phone"]
  readonly ttl: "12h"
}
type ResearchReservedBranch = Omit<ValidResearchUnionBranch, "research"> & {
  readonly research: { readonly person: string }
}
type ResearchMalformedBranch = Omit<ValidResearchUnionBranch, "research"> & {
  readonly research: { readonly bad_key: string }
}
type ResearchOpenBranch = Omit<ValidResearchUnionBranch, "research"> & {
  readonly research: Readonly<Record<string, string>>
}
type ResearchWrongTierBranch = Omit<ValidResearchUnionBranch, "research"> & {
  readonly deepResearch: { readonly wrongTier: string }
}
type DeepReservedBranch = Omit<ValidDeepUnionBranch, "deepResearch"> & {
  readonly deepResearch: { readonly company: string }
}
type DeepMalformedBranch = Omit<ValidDeepUnionBranch, "deepResearch"> & {
  readonly deepResearch: { readonly bad_key: string }
}
type DeepOpenBranch = Omit<ValidDeepUnionBranch, "deepResearch"> & {
  readonly deepResearch: Readonly<Record<string, string>>
}
type DeepWrongTierBranch = Omit<ValidDeepUnionBranch, "deepResearch"> & {
  readonly research: { readonly wrongTier: string }
}
type ResearchNumericBranch = Omit<ValidResearchUnionBranch, "research"> & {
  readonly research: typeof numericQuestions
}
type ResearchSymbolBranch = Omit<ValidResearchUnionBranch, "research"> & {
  readonly research: typeof symbolQuestions
}
type DeepNumericBranch = Omit<ValidDeepUnionBranch, "deepResearch"> & {
  readonly deepResearch: typeof numericQuestions
}
type DeepSymbolBranch = Omit<ValidDeepUnionBranch, "deepResearch"> & {
  readonly deepResearch: typeof symbolQuestions
}
type UnionRejectionProps = {
  readonly deepMalformed: ValidDeepUnionBranch | DeepMalformedBranch
  readonly deepOpen: ValidDeepUnionBranch | DeepOpenBranch
  readonly deepReserved: ValidDeepUnionBranch | DeepReservedBranch
  readonly deepWrongTier: ValidDeepUnionBranch | DeepWrongTierBranch
  readonly researchMalformed: ValidResearchUnionBranch | ResearchMalformedBranch
  readonly researchOpen: ValidResearchUnionBranch | ResearchOpenBranch
  readonly researchReserved: ValidResearchUnionBranch | ResearchReservedBranch
  readonly researchWrongTier: ValidResearchUnionBranch | ResearchWrongTierBranch
}

const UnionRejectionProbe = ({
  deepMalformed,
  deepOpen,
  deepReserved,
  deepWrongTier,
  researchMalformed,
  researchOpen,
  researchReserved,
  researchWrongTier,
}: UnionRejectionProps) => {
  // @ts-expect-error -- a reserved research key cannot hide in a config union branch.
  useSonar(researchReserved)
  // @ts-expect-error -- a malformed research key cannot hide in a config union branch.
  useSonar(researchMalformed)
  // @ts-expect-error -- an open research map cannot hide in a config union branch.
  useSonar(researchOpen)
  // @ts-expect-error -- a wrong-tier namespace cannot hide in a research config union branch.
  useSonar(researchWrongTier)
  // @ts-expect-error -- a reserved deep key cannot hide in a config union branch.
  useDeepSonar(deepReserved)
  // @ts-expect-error -- a malformed deep key cannot hide in a config union branch.
  useDeepSonar(deepMalformed)
  // @ts-expect-error -- an open deep map cannot hide in a config union branch.
  useDeepSonar(deepOpen)
  // @ts-expect-error -- a wrong-tier namespace cannot hide in a deep config union branch.
  useDeepSonar(deepWrongTier)
  return null
}

type NonStringUnionRejectionProps = {
  readonly deepNumeric: ValidDeepUnionBranch | DeepNumericBranch
  readonly deepSymbol: ValidDeepUnionBranch | DeepSymbolBranch
  readonly researchNumeric: ValidResearchUnionBranch | ResearchNumericBranch
  readonly researchSymbol: ValidResearchUnionBranch | ResearchSymbolBranch
}

const NonStringUnionRejectionProbe = ({
  deepNumeric,
  deepSymbol,
  researchNumeric,
  researchSymbol,
}: NonStringUnionRejectionProps) => {
  // @ts-expect-error -- a numeric research key cannot hide in a config union branch.
  useSonar(researchNumeric)
  // @ts-expect-error -- a symbol research key cannot hide in a config union branch.
  useSonar(researchSymbol)
  // @ts-expect-error -- a numeric deep key cannot hide in a config union branch.
  useDeepSonar(deepNumeric)
  // @ts-expect-error -- a symbol deep key cannot hide in a config union branch.
  useDeepSonar(deepSymbol)
  return null
}

const useTypecheckPublicContract = () => {
  const researchQuestionFragments = {
    branded: {
      sellsToSMB: question<boolean>("Does this company sell to SMBs?"),
    },
    plain: {
      narrative: "Summarize the company.",
    },
  } as const
  const nestedResearchConfig = {
    company: ["name", "domain"],
    person: ["title", "linkedin"],
    research: {
      ...researchQuestionFragments.branded,
      ...researchQuestionFragments.plain,
    },
    ttl: "12h",
  } as const
  const researchConfig = { ...nestedResearchConfig }
  const research = useSonar(researchConfig)
  const interfaceResearch = useSonar(interfaceResearchConfig)
  const aliasResearch = useSonar(aliasResearchConfig)

  type ResearchData = NonNullable<typeof research.data>
  type InterfaceResearchData = NonNullable<typeof interfaceResearch.data>
  type AliasResearchData = NonNullable<typeof aliasResearch.data>
  type _InterfaceResearchQuestion = Assert<
    Equal<InterfaceResearchData["accountFit"], Field<JSONValue>>
  >
  type _AliasResearchQuestion = Assert<
    Equal<AliasResearchData["accountFit"], InterfaceResearchData["accountFit"]>
  >
  type _CustomBoolean = Assert<Equal<ResolvedValue<ResearchData["sellsToSMB"]>, boolean>>
  type _PlainQuestion = Assert<Equal<ResolvedValue<ResearchData["narrative"]>, JSONValue>>
  type _CustomIsTopLevel = Assert<
    Equal<"research" extends keyof ResearchData ? true : false, false>
  >
  type _ExactResearchKeys = Assert<
    Equal<keyof ResearchData, "company" | "narrative" | "person" | "sellsToSMB">
  >
  type _ExactResearchPersonKeys = Assert<Equal<keyof ResearchData["person"], "linkedin" | "title">>
  type _ExactResearchCompanyKeys = Assert<Equal<keyof ResearchData["company"], "domain" | "name">>
  type _KnownFieldUsesSharedField = Assert<
    ResearchData["person"]["title"] extends Field<string> ? true : false
  >
  type _FiniteResearchAnswerIsRequired = Assert<Equal<ResearchData["sellsToSMB"], Field<boolean>>>
  type _ResultKeys = Assert<
    Equal<keyof typeof research, "data" | "error" | "loading" | "resolve" | "status">
  >
  type _TypedError = Assert<Equal<typeof research.error, SonarClientError | null>>
  type _IdleStatus = Assert<Equal<typeof research.status, "pending" | "complete" | undefined>>
  const researchBoolean: Field<boolean> | undefined = research.data?.sellsToSMB
  const researchPlain: Field<JSONValue> | undefined = research.data?.narrative
  expect(researchBoolean).toBeUndefined()
  expect(researchPlain).toBeUndefined()

  const broadResearchConfig: ResearchConfig = researchConfig
  const broadResearch = useSonar(broadResearchConfig)
  type BroadResearchData = NonNullable<typeof broadResearch.data>
  type _BroadResearchPersonIsOptional = Assert<
    Equal<BroadResearchData["person"]["title"], Field<string> | undefined>
  >
  type _BroadResearchCompanyIsOptional = Assert<
    Equal<BroadResearchData["company"]["name"], Field<string> | undefined>
  >
  type _BroadResearchAnswerIsOptional = Assert<
    Equal<BroadResearchData["arbitraryAnswer"], Field<JSONValue> | undefined>
  >

  // @ts-expect-error -- an unselected research built-in cannot appear in the result.
  expect(research.data?.person.github).toBeUndefined()
  // @ts-expect-error -- a branded boolean question cannot become a string field.
  const _wrongResearchAnswer: Field<string> | undefined = research.data?.sellsToSMB
  // @ts-expect-error -- only configured custom question keys appear in the result.
  expect(research.data?.phantomAnswer).toBeUndefined()

  research.resolve({ linkedinURL: "https://linkedin.com/in/ada" })
  research.resolve({ fullName: "Ada", xURL: "https://x.com/ada" })
  research.resolve({
    context: { plan: "enterprise", seats: 20 },
    domain: "example.test",
    email: "ada@example.test",
    fullName: "Ada Lovelace",
  })

  const deepQuestionFragments = {
    branded: {
      usesQuickBooks: question<boolean>("Does it use QuickBooks?"),
    },
    plain: {
      accountingNotes: "Summarize its accounting stack.",
    },
  } as const
  const nestedDeepConfig = {
    company: ["legalName"],
    deepResearch: {
      ...deepQuestionFragments.branded,
      ...deepQuestionFragments.plain,
    },
    person: ["phone"],
    ttl: "365d",
  } as const
  const deepConfig = { ...nestedDeepConfig }
  const deep = useDeepSonar(deepConfig)
  const interfaceDeep = useDeepSonar(interfaceDeepConfig)
  const aliasDeep = useDeepSonar(aliasDeepConfig)
  type DeepData = NonNullable<typeof deep.data>
  type InterfaceDeepData = NonNullable<typeof interfaceDeep.data>
  type AliasDeepData = NonNullable<typeof aliasDeep.data>
  type _InterfaceDeepQuestion = Assert<
    Equal<InterfaceDeepData["integrationCount"], Field<JSONValue>>
  >
  type _AliasDeepQuestion = Assert<
    Equal<AliasDeepData["integrationCount"], InterfaceDeepData["integrationCount"]>
  >
  type _DeepCustom = Assert<Equal<ResolvedValue<DeepData["usesQuickBooks"]>, boolean>>
  type _DeepPlain = Assert<Equal<ResolvedValue<DeepData["accountingNotes"]>, JSONValue>>
  type _ExactDeepKeys = Assert<
    Equal<keyof DeepData, "accountingNotes" | "company" | "person" | "usesQuickBooks">
  >
  type _ExactDeepPersonKeys = Assert<Equal<keyof DeepData["person"], "phone">>
  type _ExactDeepCompanyKeys = Assert<Equal<keyof DeepData["company"], "legalName">>
  type _FiniteDeepAnswerIsRequired = Assert<Equal<DeepData["usesQuickBooks"], Field<boolean>>>
  const deepBoolean: Field<boolean> | undefined = deep.data?.usesQuickBooks
  const deepPlain: Field<JSONValue> | undefined = deep.data?.accountingNotes
  expect(deepBoolean).toBeUndefined()
  expect(deepPlain).toBeUndefined()

  const broadDeepConfig: DeepResearchConfig = deepConfig
  const broadDeep = useDeepSonar(broadDeepConfig)
  type BroadDeepData = NonNullable<typeof broadDeep.data>
  type _BroadDeepPersonIsOptional = Assert<
    Equal<BroadDeepData["person"]["phone"], Field<string> | undefined>
  >
  type _BroadDeepCompanyIsOptional = Assert<
    Equal<BroadDeepData["company"]["legalName"], Field<string> | undefined>
  >
  type _BroadDeepAnswerIsOptional = Assert<
    Equal<BroadDeepData["arbitraryAnswer"], Field<JSONValue> | undefined>
  >

  // @ts-expect-error -- research built-ins never appear in a deep-research result.
  expect(deep.data?.person.github).toBeUndefined()
  // @ts-expect-error -- a branded boolean question cannot become a number field.
  const _wrongDeepAnswer: Field<number> | undefined = deep.data?.usesQuickBooks
  // @ts-expect-error -- only configured deep-research questions appear in the result.
  expect(deep.data?.phantomAnswer).toBeUndefined()

  // @ts-expect-error -- research cannot request the deep person catalog.
  useSonar({ person: ["phone"], ttl: "12h" })
  // @ts-expect-error -- research cannot request the deep company catalog.
  useSonar({ company: ["legalName"], ttl: "12h" })
  // @ts-expect-error -- deep research cannot request the research person catalog.
  useDeepSonar({ person: ["title"], ttl: "12h" })
  // @ts-expect-error -- deep research cannot request the research company catalog.
  useDeepSonar({ company: ["funding"], ttl: "12h" })
  // @ts-expect-error -- each tier accepts only its matching question namespace.
  useSonar({ deepResearch: { score: question<number>("Score it.") }, ttl: "12h" })
  // @ts-expect-error -- each tier accepts only its matching question namespace.
  useDeepSonar({ research: { score: question<number>("Score it.") }, ttl: "12h" })
  // @ts-expect-error -- a custom key must be a camelCase identifier.
  useSonar({ research: { SellsToSMB: question<boolean>("Does it?") }, ttl: "12h" })
  // @ts-expect-error -- reserved config keys cannot become custom result keys.
  useSonar({ research: { person: question<string>("Who is the person?") }, ttl: "12h" })
  // @ts-expect-error -- reserved config keys cannot become deep custom result keys.
  useDeepSonar({ deepResearch: { company: question<string>("Which company?") }, ttl: "12h" })
  // @ts-expect-error -- research question maps cannot contain numeric keys.
  useSonar({ ...researchConfig, research: numericQuestions })
  // @ts-expect-error -- deep question maps cannot contain numeric keys.
  useDeepSonar({ ...deepConfig, deepResearch: numericQuestions })
  // @ts-expect-error -- research question maps cannot contain symbol-only keys.
  useSonar({ ...researchConfig, research: symbolQuestions })
  // @ts-expect-error -- deep question maps cannot contain symbol-only keys.
  useDeepSonar({ ...deepConfig, deepResearch: symbolQuestions })
  // @ts-expect-error -- finite research question keys cannot be optional.
  useSonar({ ...researchConfig, research: optionalQuestions })
  // @ts-expect-error -- finite deep question keys cannot be optional.
  useDeepSonar({ ...deepConfig, deepResearch: optionalQuestions })
  // @ts-expect-error -- interface-declared research question keys cannot be optional.
  useSonar({ ...researchConfig, research: optionalInterfaceQuestions })
  // @ts-expect-error -- interface-declared deep question keys cannot be optional.
  useDeepSonar({ ...deepConfig, deepResearch: optionalInterfaceQuestions })
  // @ts-expect-error -- callable objects are not research question maps.
  useSonar({ ...researchConfig, research: callableQuestions })
  // @ts-expect-error -- callable objects are not deep question maps.
  useDeepSonar({ ...deepConfig, deepResearch: callableQuestions })
  // @ts-expect-error -- constructable objects are not research question maps.
  useSonar({ ...researchConfig, research: constructableQuestions })
  // @ts-expect-error -- constructable objects are not deep question maps.
  useDeepSonar({ ...deepConfig, deepResearch: constructableQuestions })
  // @ts-expect-error -- a broad research map cannot add a numeric key.
  useSonar({ ...researchConfig, research: hybridNumericQuestions })
  // @ts-expect-error -- a broad deep map cannot add a numeric key.
  useDeepSonar({ ...deepConfig, deepResearch: hybridNumericQuestions })
  // @ts-expect-error -- a broad research map cannot add a symbol key.
  useSonar({ ...researchConfig, research: hybridSymbolQuestions })
  // @ts-expect-error -- a broad deep map cannot add a symbol key.
  useDeepSonar({ ...deepConfig, deepResearch: hybridSymbolQuestions })

  useSonar({ ...researchConfig, research: {} })
  useDeepSonar({ ...deepConfig, deepResearch: {} })

  expect(UnionRejectionProbe).toBeFunction()
  expect(NonStringUnionRejectionProbe).toBeFunction()

  // @ts-expect-error -- the minimum TTL is twelve hours.
  useSonar({ person: ["title"], ttl: "11h" })
  // @ts-expect-error -- the maximum TTL is one year.
  useSonar({ person: ["title"], ttl: "366d" })

  // @ts-expect-error -- email alone is not an identity branch.
  research.resolve({ email: "ada@example.test" })
  // @ts-expect-error -- fullName alone is not an identity branch.
  research.resolve({ fullName: "Ada Lovelace" })
  // @ts-expect-error -- domain is context, not a complete identity branch.
  research.resolve({ domain: "example.test" })
  // @ts-expect-error -- xURL requires fullName.
  research.resolve({ xURL: "https://x.com/ada" })
  // @ts-expect-error -- context must contain JSON values.
  research.resolve({
    context: { callback: () => {} },
    email: "ada@example.test",
    fullName: "Ada Lovelace",
  })

  // @ts-expect-error -- the provider requires a valid SonarClient Layer.
  createElement(SonarProvider, { layer: null }, null)
}

describe("public React types", () => {
  it("keeps compile-time contract checks in the TypeScript project", () => {
    expect(useTypecheckPublicContract).toBeFunction()
  })
})

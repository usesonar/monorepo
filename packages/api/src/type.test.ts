// oxlint-disable sort-keys -- Request literals preserve the public person-before-company order.

import { expect, test } from "bun:test"

import type { KyInstance } from "ky"

import {
  createDeepResearch,
  createResearch,
  createSonar,
  question,
  retrieveSonar,
} from "./index.ts"
import type {
  AnswerOf,
  DeepResearchRequest,
  Field,
  JSONValue,
  Question,
  ResearchRequest,
  SonarResponse,
} from "./index.ts"

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2
    ? true
    : false
type Expect<Type extends true> = Type

// oxlint-disable-next-line typescript/no-explicit-any -- This adversarial probe proves explicit `any` cannot bypass API selection validation.
type AnySelection = any

type BrandedSingletonUnion<Value extends string> =
  | (Value & { readonly selectionBrand: "first" })
  | (Value & { readonly selectionBrand: "second" })

type AccountSignals = {
  intent: "low" | "medium" | "high"
  evidence: string[]
}

type RiskAssessment = {
  score: number
  factors: string[]
}

type RegulatoryStatus = {
  registered: boolean
  jurisdictions: string[]
}

declare const customQuestionSymbol: unique symbol
declare const reservedQuestionUnion: { goodKey: string } | { person: string }
declare const malformedQuestionUnion: { goodKey: string } | { snake_case: string }
declare const validQuestionUnion: { firstAnswer: string } | { secondAnswer: string }
declare const optionalQuestions: { maybe?: string }
declare const numericQuestions: { 1: string }
declare const symbolOnlyQuestions: { readonly [customQuestionSymbol]: string }
declare const mutableAnySelection: [AnySelection]
declare const readonlyAnySelection: readonly [AnySelection]

const accountSignalsQuestion = question<AccountSignals>("What public buying signals exist?")
const nestedResearchQuestions = {
  accountSignals: accountSignalsQuestion,
  riskAssessment: question<RiskAssessment>("Which public risk factors exist?"),
}
const mixedResearchQuestions = {
  ...nestedResearchQuestions,
  defaultTyped: question("Return a JSON-compatible answer."),
  plainNarrative: "Summarize the public narrative.",
  extraRuntime: "Return any additional public evidence.",
}
const researchRequest = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "12h",
  person: ["title"],
  company: ["colors", "funding"],
  research: { ...mixedResearchQuestions },
} as const
const spreadResearchRequest = {
  ...researchRequest,
  research: { ...researchRequest.research },
} as const

const deepQuestions = {
  regulatoryStatus: question<RegulatoryStatus>("What is the current regulatory status?"),
  plainDeepAnswer: "What else is publicly known?",
}
const deepResearchRequest = {
  seed: { fullName: "Ada Lovelace", xURL: "https://x.com/ada" },
  ttl: "7d",
  person: ["phone"],
  company: ["legalName"],
  deepResearch: { ...deepQuestions },
} as const

const broadResearchRequest: ResearchRequest = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "12h",
  person: ["title"],
  company: ["colors"],
  research: { runtimeAnswer: "Return public runtime evidence." },
}
const broadDeepResearchRequest: DeepResearchRequest = {
  seed: { fullName: "Ada Lovelace", xURL: "https://x.com/ada" },
  ttl: "7d",
  person: ["phone"],
  company: ["legalName"],
  deepResearch: { runtimeDeepAnswer: "Return public deep-research evidence." },
}

const verifyTypeContract = (client: KyInstance) => {
  const research = createResearch(client, spreadResearchRequest)
  const deep = createDeepResearch(client, { ...deepResearchRequest })
  const broadResearch = createResearch(client, broadResearchRequest)
  const broadDeep = createDeepResearch(client, broadDeepResearchRequest)
  const retrieved = retrieveSonar(client, "sonar_hash_123")
  const typedRetrieved = retrieveSonar<{
    accountSignals: AccountSignals
    plainCustom: JSONValue
  }>(client, "sonar_hash_123")
  const createTupleUnionResearch = (
    person: readonly ["title"] | readonly ["github"],
    company: readonly ["name"] | readonly ["location"]
  ) => createResearch(client, { ...spreadResearchRequest, person, company })
  const createUnionElementResearch = (
    person: readonly ["title" | "github"],
    company: readonly ["name" | "location"]
  ) => createResearch(client, { ...spreadResearchRequest, person, company })
  const createUnionElementDeepResearch = (
    person: readonly [BrandedSingletonUnion<"phone">],
    company: readonly [BrandedSingletonUnion<"legalName">]
  ) => createDeepResearch(client, { ...deepResearchRequest, person, company })

  type ResearchResponse = Awaited<typeof research>
  type DeepResponse = Awaited<typeof deep>
  type BroadResearchResponse = Awaited<typeof broadResearch>
  type BroadDeepResponse = Awaited<typeof broadDeep>
  type TupleUnionResponse = Awaited<ReturnType<typeof createTupleUnionResearch>>
  type UnionElementResearchResponse = Awaited<ReturnType<typeof createUnionElementResearch>>
  type UnionElementDeepResearchResponse = Awaited<ReturnType<typeof createUnionElementDeepResearch>>
  type RetrievedResponse = Awaited<typeof retrieved>
  type TypedRetrievedResponse = Awaited<typeof typedRetrieved>
  type _ResearchIsResponse = Expect<ResearchResponse extends SonarResponse ? true : false>
  type _DeepIsResponse = Expect<DeepResponse extends SonarResponse ? true : false>
  type _QuestionIsString = Expect<Question<AccountSignals> extends string ? true : false>
  type _QuestionCarriesAnswer = Expect<
    Equal<AnswerOf<typeof accountSignalsQuestion>, AccountSignals>
  >
  type _SelectedPersonOnly = Expect<Equal<keyof ResearchResponse["data"]["person"], "title">>
  type _SelectedCompanyOnly = Expect<
    Equal<keyof ResearchResponse["data"]["company"], "colors" | "funding">
  >
  type _BuiltInString = Expect<Equal<ResearchResponse["data"]["person"]["title"], Field<string>>>
  type _RichColors = Expect<Equal<ResearchResponse["data"]["company"]["colors"], Field<JSONValue>>>
  type _RichFunding = Expect<
    Equal<ResearchResponse["data"]["company"]["funding"], Field<JSONValue>>
  >
  type _BrandedAccountSignals = Expect<
    Equal<ResearchResponse["data"]["accountSignals"], Field<AccountSignals>>
  >
  type _BrandedRiskAssessment = Expect<
    Equal<ResearchResponse["data"]["riskAssessment"], Field<RiskAssessment>>
  >
  type _DefaultQuestionAnswer = Expect<
    Equal<ResearchResponse["data"]["defaultTyped"], Field<JSONValue>>
  >
  type _PlainQuestionAnswer = Expect<
    Equal<ResearchResponse["data"]["plainNarrative"], Field<JSONValue>>
  >
  type _ExtraRuntimeAnswer = Expect<
    Equal<ResearchResponse["data"]["extraRuntime"], Field<JSONValue>>
  >
  type _AllMixedQuestionsRemain = Expect<
    Equal<
      Exclude<keyof ResearchResponse["data"], "person" | "company">,
      "accountSignals" | "riskAssessment" | "defaultTyped" | "plainNarrative" | "extraRuntime"
    >
  >
  type _DeepSelectedPersonOnly = Expect<Equal<keyof DeepResponse["data"]["person"], "phone">>
  type _DeepSelectedCompanyOnly = Expect<Equal<keyof DeepResponse["data"]["company"], "legalName">>
  type _DeepBuiltIn = Expect<Equal<DeepResponse["data"]["company"]["legalName"], Field<string>>>
  type _DeepBrandedAnswer = Expect<
    Equal<DeepResponse["data"]["regulatoryStatus"], Field<RegulatoryStatus>>
  >
  type _DeepPlainAnswer = Expect<Equal<DeepResponse["data"]["plainDeepAnswer"], Field<JSONValue>>>
  type _BroadResearchPersonKeys = Expect<
    Equal<keyof BroadResearchResponse["data"]["person"], "linkedin" | "title" | "x" | "github">
  >
  type _BroadResearchPersonFieldsAreOptional = Expect<
    Equal<BroadResearchResponse["data"]["person"]["github"], Field<string> | undefined>
  >
  type _BroadResearchCompanyKeys = Expect<
    Equal<
      keyof BroadResearchResponse["data"]["company"],
      "domain" | "name" | "logo" | "colors" | "location" | "description" | "funding"
    >
  >
  type _BroadResearchCompanyFieldsAreOptional = Expect<
    Equal<BroadResearchResponse["data"]["company"]["location"], Field<JSONValue> | undefined>
  >
  type _BroadResearchAnswerIsJSON = Expect<
    Equal<BroadResearchResponse["data"]["runtimeAnswer"], Field<JSONValue> | undefined>
  >
  type _BroadDeepPersonFieldIsOptional = Expect<
    Equal<BroadDeepResponse["data"]["person"]["phone"], Field<string> | undefined>
  >
  type _BroadDeepCompanyFieldIsOptional = Expect<
    Equal<BroadDeepResponse["data"]["company"]["legalName"], Field<string> | undefined>
  >
  type _BroadDeepAnswerIsJSON = Expect<
    Equal<BroadDeepResponse["data"]["runtimeDeepAnswer"], Field<JSONValue> | undefined>
  >
  type _TupleUnionPersonSelectionDistributes = Expect<
    Equal<
      TupleUnionResponse["data"]["person"],
      { title: Field<string> } | { github: Field<string> }
    >
  >
  type _TupleUnionCompanySelectionDistributes = Expect<
    Equal<
      TupleUnionResponse["data"]["company"],
      { name: Field<string> } | { location: Field<JSONValue> }
    >
  >
  type _UnionElementResearchPersonSelectionIsOptional = Expect<
    Equal<
      UnionElementResearchResponse["data"]["person"],
      { title?: Field<string>; github?: Field<string> }
    >
  >
  type _UnionElementResearchCompanySelectionIsOptional = Expect<
    Equal<
      UnionElementResearchResponse["data"]["company"],
      { name?: Field<string>; location?: Field<JSONValue> }
    >
  >
  type _UnionElementDeepPersonSelectionIsOptional = Expect<
    Equal<UnionElementDeepResearchResponse["data"]["person"], { phone?: Field<string> }>
  >
  type _UnionElementDeepCompanySelectionIsOptional = Expect<
    Equal<UnionElementDeepResearchResponse["data"]["company"], { legalName?: Field<string> }>
  >
  type _RetrieveDataIsClosed = Expect<Equal<keyof RetrievedResponse["data"], "person" | "company">>
  type _RetrieveStringBuiltIn = Expect<
    Equal<RetrievedResponse["data"]["person"]["title"], Field<string> | undefined>
  >
  type _RetrieveRichBuiltIn = Expect<
    Equal<RetrievedResponse["data"]["company"]["colors"], Field<JSONValue> | undefined>
  >
  type _RetrieveTypedDataKeys = Expect<
    Equal<
      keyof TypedRetrievedResponse["data"],
      "person" | "company" | "accountSignals" | "plainCustom"
    >
  >
  type _RetrieveTypedCustom = Expect<
    Equal<TypedRetrievedResponse["data"]["accountSignals"], Field<AccountSignals>>
  >
  type _RetrieveJSONCustom = Expect<
    Equal<TypedRetrievedResponse["data"]["plainCustom"], Field<JSONValue>>
  >

  // @ts-expect-error unselected research built-ins do not appear in configured results.
  research.then((response) => response.data.person.github)
  // @ts-expect-error unselected deep-research built-ins do not appear in configured results.
  deep.then((response) => response.data.company.name)
  // @ts-expect-error default retrieval has no config from which to infer custom answer keys.
  retrieved.then((response) => response.data.accountSignals)
  // @ts-expect-error nested built-in catalogs remain closed to provider or custom keys.
  retrieved.then((response) => response.data.person.providerInternal)

  // @ts-expect-error phone is a deepResearch person field.
  createResearch(client, { ...spreadResearchRequest, person: ["phone"] as const })
  // @ts-expect-error title is a research person field.
  createDeepResearch(client, { ...deepResearchRequest, person: ["title"] as const })
  // @ts-expect-error legalName is a deepResearch company field.
  createResearch(client, { ...spreadResearchRequest, company: ["legalName"] as const })
  // @ts-expect-error name is a research company field.
  createDeepResearch(client, { ...deepResearchRequest, company: ["name"] as const })
  // @ts-expect-error a mutable any-valued tuple cannot bypass research person selection validation.
  createResearch(client, { ...spreadResearchRequest, person: mutableAnySelection })
  // @ts-expect-error a readonly any-valued tuple cannot bypass research person selection validation.
  createResearch(client, { ...spreadResearchRequest, person: readonlyAnySelection })
  // @ts-expect-error a mutable any-valued tuple cannot bypass research company selection validation.
  createResearch(client, { ...spreadResearchRequest, company: mutableAnySelection })
  // @ts-expect-error a readonly any-valued tuple cannot bypass research company selection validation.
  createResearch(client, { ...spreadResearchRequest, company: readonlyAnySelection })
  // @ts-expect-error a mutable any-valued tuple cannot bypass deep person selection validation.
  createDeepResearch(client, { ...deepResearchRequest, person: mutableAnySelection })
  // @ts-expect-error a readonly any-valued tuple cannot bypass deep person selection validation.
  createDeepResearch(client, { ...deepResearchRequest, person: readonlyAnySelection })
  // @ts-expect-error a mutable any-valued tuple cannot bypass deep company selection validation.
  createDeepResearch(client, { ...deepResearchRequest, company: mutableAnySelection })
  // @ts-expect-error a readonly any-valued tuple cannot bypass deep company selection validation.
  createDeepResearch(client, { ...deepResearchRequest, company: readonlyAnySelection })
  // @ts-expect-error a research request cannot carry the deepResearch slot.
  createResearch(client, { ...spreadResearchRequest, deepResearch: { wrongTier: "No" } })
  // @ts-expect-error a deep request cannot carry the research slot.
  createDeepResearch(client, { ...deepResearchRequest, research: { wrongTier: "No" } })
  // @ts-expect-error a fullName is required alongside email.
  createResearch(client, { ...spreadResearchRequest, seed: { email: "ada@example.com" } })
  // @ts-expect-error reserved custom keys fail at compile time.
  createResearch(client, { ...spreadResearchRequest, research: { person: "No" } })
  // @ts-expect-error non-camelCase custom keys fail at compile time.
  createDeepResearch(client, { ...deepResearchRequest, deepResearch: { snake_case: "No" } })
  // @ts-expect-error research question maps cannot hide a reserved key in a union branch.
  createResearch(client, { ...spreadResearchRequest, research: reservedQuestionUnion })
  // @ts-expect-error deep question maps cannot hide a reserved key in a union branch.
  createDeepResearch(client, { ...deepResearchRequest, deepResearch: reservedQuestionUnion })
  // @ts-expect-error research question maps cannot hide a malformed key in a union branch.
  createResearch(client, { ...spreadResearchRequest, research: malformedQuestionUnion })
  // @ts-expect-error deep question maps cannot hide a malformed key in a union branch.
  createDeepResearch(client, { ...deepResearchRequest, deepResearch: malformedQuestionUnion })
  // @ts-expect-error research question maps cannot be unions, even when every branch is valid.
  createResearch(client, { ...spreadResearchRequest, research: validQuestionUnion })
  // @ts-expect-error deep question maps cannot be unions, even when every branch is valid.
  createDeepResearch(client, { ...deepResearchRequest, deepResearch: validQuestionUnion })
  // @ts-expect-error research question maps require every declared key.
  createResearch(client, { ...spreadResearchRequest, research: optionalQuestions })
  // @ts-expect-error deep question maps require every declared key.
  createDeepResearch(client, { ...deepResearchRequest, deepResearch: optionalQuestions })
  // @ts-expect-error research question maps cannot contain numeric keys.
  createResearch(client, { ...spreadResearchRequest, research: numericQuestions })
  // @ts-expect-error deep question maps cannot contain numeric keys.
  createDeepResearch(client, { ...deepResearchRequest, deepResearch: numericQuestions })
  // @ts-expect-error research question maps cannot contain symbol-only keys.
  createResearch(client, { ...spreadResearchRequest, research: symbolOnlyQuestions })
  // @ts-expect-error deep question maps cannot contain symbol-only keys.
  createDeepResearch(client, { ...deepResearchRequest, deepResearch: symbolOnlyQuestions })
  // @ts-expect-error retrieval custom-answer maps must enumerate finite keys.
  retrieveSonar<Record<string, JSONValue>>(client, "sonar_hash_123")
  // @ts-expect-error retrieval custom-answer maps cannot contain reserved result keys.
  retrieveSonar<{ person: string }>(client, "sonar_hash_123")
  // @ts-expect-error retrieval custom-answer maps require lower-camel keys.
  retrieveSonar<{ snake_case: string }>(client, "sonar_hash_123")
  // @ts-expect-error retrieval custom-answer maps require every declared key.
  retrieveSonar<{ maybe?: string }>(client, "sonar_hash_123")
  // @ts-expect-error retrieval custom-answer maps cannot contain numeric keys.
  retrieveSonar<{ 1: string }>(client, "sonar_hash_123")
  // @ts-expect-error retrieval custom-answer maps cannot contain symbol-only keys.
  retrieveSonar<{ readonly [customQuestionSymbol]: string }>(client, "sonar_hash_123")
  // @ts-expect-error retrieval custom-answer maps cannot be unions, even when each branch is valid.
  retrieveSonar<{ alphaAnswer: string } | { betaAnswer: number }>(client, "sonar_hash_123")
  // @ts-expect-error retrieval answer maps cannot hide a reserved key in a union branch.
  retrieveSonar<{ goodKey: string } | { person: string }>(client, "sonar_hash_123")
  // @ts-expect-error retrieval answer maps cannot hide a malformed key in a union branch.
  retrieveSonar<{ goodKey: string } | { BadKey: string }>(client, "sonar_hash_123")
  // @ts-expect-error retrieval answer maps cannot hide an open record in a union branch.
  retrieveSonar<{ goodKey: string } | Record<string, JSONValue>>(client, "sonar_hash_123")
  // @ts-expect-error a configured client requires one capability key.
  createSonar({ baseURL: "https://api.example.test" })
  // @ts-expect-error publishableKey and secretKey are mutually exclusive.
  createSonar({
    baseURL: "https://api.example.test",
    publishableKey: "pk_test_verify",
    secretKey: "sk_verify",
  })

  return {
    research,
    deep,
    broadResearch,
    broadDeep,
    retrieved,
    typedRetrieved,
  } as const
}

test("V-API-05 compile-time public contract is exercised by TypeScript", () => {
  expect(verifyTypeContract).toBeFunction()
  const prompt: string = question("What is the JSON answer?")
  expect(prompt).toBe("What is the JSON answer?")

  const client: KyInstance = createSonar({
    baseURL: "https://api.example.test",
    publishableKey: "pk_test_verify",
    fetch: () => Promise.resolve(new Response()),
  })
  expect(client.extend).toBeFunction()
})

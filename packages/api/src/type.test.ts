// oxlint-disable sort-keys -- Request literals preserve the public person-before-company order.

import { expect, test } from "bun:test"

import type { KyInstance } from "ky"
import { z } from "zod"

import {
  compileResearchRequest,
  createDeepResearch,
  createResearch,
  createSonar,
  retrieveSonar,
} from "./index.ts"
import type {
  DeepResearchInput,
  Field,
  JSONValue,
  ResearchInput,
  ResearchOutput,
  SonarResponse,
  StandardJSONSchemaV1,
} from "./index.ts"

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2
    ? true
    : false
type Expect<Type extends true> = Type

type AccountSignals = { intent: "low" | "medium" | "high"; evidence: string[] }
type RiskAssessment = { score: number; factors: string[] }

declare const customQuestionSymbol: unique symbol
declare const reservedQuestionUnion: { goodKey: string } | { person: string }
declare const malformedQuestionUnion: { goodKey: string } | { snake_case: string }
declare const validQuestionUnion: { firstAnswer: string } | { secondAnswer: string }
declare const optionalQuestions: { maybe?: string }
declare const numericQuestions: { 1: string }
declare const symbolOnlyQuestions: { readonly [customQuestionSymbol]: string }

const riskAssessment: StandardJSONSchemaV1<unknown, RiskAssessment> = {
  "~standard": {
    version: 1,
    vendor: "fixture",
    types: undefined,
    jsonSchema: {
      input: () => ({ description: "Which public risk factors exist?", type: "object" }),
      output: () => ({
        description: "Which public risk factors exist?",
        type: "object",
        properties: {
          score: { type: "number" },
          factors: { type: "array", items: { type: "string" } },
        },
        required: ["score", "factors"],
        additionalProperties: false,
      }),
    },
  },
}

const accountSignals = z
  .object({ intent: z.enum(["low", "medium", "high"]), evidence: z.array(z.string()) })
  .describe("What public buying signals exist?")

const researchRequest = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "12h",
  person: {
    title: true,
    research: {
      accountSignals,
      publicNarrative: { description: "Summarize the public narrative.", type: "string" },
    },
  },
  company: {
    colors: true,
    funding: true,
    research: { accountSignals: riskAssessment },
  },
} as const

const deepResearchRequest = {
  seed: { fullName: "Ada Lovelace", xURL: "https://x.com/ada" },
  ttl: "7d",
  person: {
    phone: true,
    deepResearch: { background: "Summarize the person's professional background." },
  },
  company: {
    legalName: true,
    deepResearch: { background: "Summarize the company's history." },
  },
} as const

const broadResearchRequest: ResearchInput = {
  seed: { fullName: "Ada Lovelace", email: "ada@example.com" },
  ttl: "12h",
  person: {
    title: true,
    research: {
      runtimeAnswer: { description: "Return public runtime evidence.", type: "object" },
    },
  },
  company: { colors: true },
}

const broadDeepResearchRequest: DeepResearchInput = {
  seed: { fullName: "Ada Lovelace", xURL: "https://x.com/ada" },
  ttl: "7d",
  person: { phone: true },
  company: {
    legalName: true,
    deepResearch: { runtimeDeepAnswer: "Return public deep-research evidence." },
  },
}

const verifyTypeContract = (client: KyInstance) => {
  const research = createResearch(client, researchRequest)
  const deep = createDeepResearch(client, deepResearchRequest)
  const broadResearch = createResearch(client, broadResearchRequest)
  const broadDeep = createDeepResearch(client, broadDeepResearchRequest)
  const retrieved = retrieveSonar(client, "sonar_hash_123")
  const typedRetrieved = retrieveSonar<{
    person: { research: { accountSignals: AccountSignals } }
    company: { deepResearch: { background: string } }
  }>(client, "sonar_hash_123")

  type ResearchResponse = Awaited<typeof research>
  type DeepResponse = Awaited<typeof deep>
  type BroadResearchResponse = Awaited<typeof broadResearch>
  type BroadDeepResponse = Awaited<typeof broadDeep>
  type RetrievedResponse = Awaited<typeof retrieved>
  type TypedRetrievedResponse = Awaited<typeof typedRetrieved>
  type _ResearchIsResponse = Expect<ResearchResponse extends SonarResponse ? true : false>
  type _DeepIsResponse = Expect<DeepResponse extends SonarResponse ? true : false>
  type _ZodOutput = Expect<Equal<ResearchOutput<typeof accountSignals>, AccountSignals>>
  type _StandardOutput = Expect<Equal<ResearchOutput<typeof riskAssessment>, RiskAssessment>>
  type _SelectedPersonOnly = Expect<
    Equal<Exclude<keyof ResearchResponse["data"]["person"], "research">, "title">
  >
  type _SelectedCompanyOnly = Expect<
    Equal<Exclude<keyof ResearchResponse["data"]["company"], "research">, "colors" | "funding">
  >
  type _BuiltInString = Expect<Equal<ResearchResponse["data"]["person"]["title"], Field<string>>>
  type _ZodAnswer = Expect<
    Equal<ResearchResponse["data"]["person"]["research"]["accountSignals"], Field<AccountSignals>>
  >
  type _RawSchemaAnswer = Expect<
    Equal<ResearchResponse["data"]["person"]["research"]["publicNarrative"], Field<JSONValue>>
  >
  type _SameKeyDifferentEntity = Expect<
    Equal<ResearchResponse["data"]["company"]["research"]["accountSignals"], Field<RiskAssessment>>
  >
  type _DeepPersonAnswer = Expect<
    Equal<DeepResponse["data"]["person"]["deepResearch"]["background"], Field<string>>
  >
  type _DeepCompanyAnswer = Expect<
    Equal<DeepResponse["data"]["company"]["deepResearch"]["background"], Field<string>>
  >
  type _BroadResearchBuiltInOptional = Expect<
    Equal<BroadResearchResponse["data"]["person"]["title"], Field<string> | undefined>
  >
  type _BroadResearchNamespaceOptional = Expect<
    Equal<
      BroadResearchResponse["data"]["person"]["research"],
      Readonly<Record<string, Field<JSONValue> | undefined>> | undefined
    >
  >
  type _BroadDeepNamespaceOptional = Expect<
    Equal<
      BroadDeepResponse["data"]["company"]["deepResearch"],
      Readonly<Record<string, Field<string> | undefined>> | undefined
    >
  >
  type _RetrieveDataIsClosed = Expect<Equal<keyof RetrievedResponse["data"], "person" | "company">>
  type _RetrieveDefaultHasNoResearch = Expect<
    Equal<Extract<"research", keyof RetrievedResponse["data"]["person"]>, never>
  >
  type _RetrieveTypedPerson = Expect<
    Equal<
      TypedRetrievedResponse["data"]["person"]["research"]["accountSignals"],
      Field<AccountSignals>
    >
  >
  type _RetrieveTypedDeep = Expect<
    Equal<TypedRetrievedResponse["data"]["company"]["deepResearch"]["background"], Field<string>>
  >

  // @ts-expect-error unselected research built-ins do not appear in configured results.
  research.then((response) => response.data.person.github)
  // @ts-expect-error unselected deep-research built-ins do not appear in configured results.
  deep.then((response) => response.data.company.name)
  // @ts-expect-error default retrieval has no config from which to infer custom answer keys.
  retrieved.then((response) => response.data.person.research)
  // @ts-expect-error phone is a deepResearch person field.
  createResearch(client, { ...researchRequest, person: { phone: true } })
  // @ts-expect-error title is a research person field.
  createDeepResearch(client, { ...deepResearchRequest, person: { title: true } })
  createResearch(client, {
    ...researchRequest,
    // @ts-expect-error raw JSON Schema requires a root description.
    person: { research: { missingPrompt: { type: "string" } } },
  })
  createResearch(client, {
    ...researchRequest,
    person: {
      research: {
        schemaOnly: {
          // @ts-expect-error ordinary Standard Schema validators without JSON Schema conversion are rejected.
          "~standard": {
            version: 1,
            vendor: "fixture",
            validate: <Value>(value: Value) => ({ value }),
          },
        },
      },
    },
  })
  createDeepResearch(client, {
    ...deepResearchRequest,
    // @ts-expect-error deepResearch accepts plain prompts, not research validators.
    person: { deepResearch: { wrong: accountSignals } },
  })
  // @ts-expect-error research question maps cannot hide a reserved key in a union branch.
  createResearch(client, { ...researchRequest, person: { research: reservedQuestionUnion } })
  // @ts-expect-error deep question maps cannot hide a malformed key in a union branch.
  createDeepResearch(client, {
    ...deepResearchRequest,
    person: { deepResearch: malformedQuestionUnion },
  })
  // @ts-expect-error question maps cannot be unions, even when every branch is valid.
  createDeepResearch(client, {
    ...deepResearchRequest,
    person: { deepResearch: validQuestionUnion },
  })
  // @ts-expect-error question maps require every declared key.
  createDeepResearch(client, {
    ...deepResearchRequest,
    person: { deepResearch: optionalQuestions },
  })
  // @ts-expect-error question maps cannot contain numeric keys.
  createDeepResearch(client, { ...deepResearchRequest, person: { deepResearch: numericQuestions } })
  // @ts-expect-error question maps cannot contain symbol-only keys.
  createDeepResearch(client, {
    ...deepResearchRequest,
    person: { deepResearch: symbolOnlyQuestions },
  })
  // @ts-expect-error retrieval maps must be nested under entity and tier namespaces.
  retrieveSonar<{ accountSignals: AccountSignals }>(client, "sonar_hash_123")

  return { research, deep, broadResearch, broadDeep, retrieved, typedRetrieved } as const
}

test("V-API-05 compile-time public contract is exercised by TypeScript", () => {
  expect(verifyTypeContract).toBeFunction()
  const compiled = compileResearchRequest(researchRequest)
  expect(compiled.person.research?.accountSignals?.description).toBe(
    "What public buying signals exist?"
  )

  const client: KyInstance = createSonar({
    baseURL: "https://api.example.test",
    publishableKey: "pk_test_verify",
    fetch: () => Promise.resolve(new Response()),
  })
  expect(client.extend).toBeFunction()
})

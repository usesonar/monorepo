import { describe, expect, test } from "bun:test"

import { createSonar } from "@usesonar/api"
import { Effect, Stream } from "effect"

import type { ValidDeepResearchRequest, ValidResearchRequest } from "./client.js"
import { HTTPError, SonarClient, layer, layerFromAPI, question } from "./index.js"
import type {
  DeepResearchConfig,
  DeepResearchRequest,
  Field,
  JSONValue,
  ResearchConfig,
  ResearchRequest,
  SonarClientError,
  SonarClientService,
  SonarSnapshot,
} from "./index.js"

/* eslint-disable react-hooks/rules-of-hooks -- Context.Service.use retrieves an Effect service; it is not a React Hook. */

const config = {
  company: [],
  person: ["title"],
  research: {},
  ttl: "12h",
} as const satisfies ResearchConfig

const request = {
  seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  ...config,
} as const satisfies ResearchRequest

const deepConfig = {
  company: ["legalName"],
  deepResearch: { usesQuickBooks: "Does this company use QuickBooks?" },
  person: ["phone"],
  ttl: "365d",
} as const satisfies DeepResearchConfig

const deepRequest = {
  seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  ...deepConfig,
} as const satisfies DeepResearchRequest

const selectedResearchFields = {
  company: ["funding", "name"],
  person: ["github", "title"],
  ttl: "12h",
} as const

const sharedResearchQuestions = {
  accountFit: question<{ rationale: string; score: number }>("How strong is the account fit?"),
  plainContext: "What context would help an account executive?",
} as const

const questionResearchConfig = {
  ...selectedResearchFields,
  research: {
    ...sharedResearchQuestions,
    salesStage: question<"early" | "late">("What is the buying stage?"),
  },
} as const satisfies ResearchConfig

const questionResearchRequest = {
  seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  ...questionResearchConfig,
} as const satisfies ResearchRequest

const selectedDeepResearchFields = {
  company: ["legalName"],
  person: ["phone"],
  ttl: "365d",
} as const

const sharedDeepResearchQuestions = {
  integrationCount: question<number>("How many integrations are public?"),
  plainDeepContext: "What public technical context is available?",
} as const

const questionDeepResearchConfig = {
  ...selectedDeepResearchFields,
  deepResearch: {
    ...sharedDeepResearchQuestions,
    technicalMaturity: question<"emerging" | "established">(
      "How mature is the technical organization?"
    ),
  },
} as const satisfies DeepResearchConfig

const questionDeepResearchRequest = {
  seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  ...questionDeepResearchConfig,
} as const satisfies DeepResearchRequest

const uniqueQuestionKey = Symbol("unique question key")

const chooseRequestBranch = <Valid, Invalid>(
  valid: Valid,
  invalid: Invalid,
  useInvalid: boolean
) => (useInvalid ? invalid : valid)

type TupleUnionResearchConfig = {
  readonly company: readonly []
  readonly person: readonly ["title"] | readonly ["github"]
  readonly research: { readonly accountFit: string }
  readonly ttl: "12h"
}

type NoQuestions = Readonly<Record<never, string>>

type BrandedSingletonUnion<Value extends string> =
  | (Value & { readonly tagged: "first" })
  | (Value & { readonly tagged: "second" })

// oxlint-disable-next-line typescript/no-explicit-any -- This adversarial probe locks `any` tuple elements to Partial selections.
type AnySelection = any

type UnionElementResearchConfig = {
  readonly company: readonly ["name" | "funding"]
  readonly person: readonly ["title" | "github"]
  readonly research: NoQuestions
  readonly ttl: "12h"
}

type UnionElementDeepResearchConfig = {
  readonly company: readonly [BrandedSingletonUnion<"legalName">]
  readonly deepResearch: NoQuestions
  readonly person: readonly [BrandedSingletonUnion<"phone">]
  readonly ttl: "365d"
}

type AnySelectionResearchConfig = {
  readonly company: readonly [AnySelection]
  readonly person: readonly [AnySelection]
  readonly research: NoQuestions
  readonly ttl: "12h"
}

type AnySelectionDeepResearchConfig = {
  readonly company: readonly [AnySelection]
  readonly deepResearch: NoQuestions
  readonly person: readonly [AnySelection]
  readonly ttl: "365d"
}

type AnyPersonResearchConfig = Omit<ResearchConfig, "person"> & {
  readonly person: readonly [AnySelection]
}

type AnyCompanyResearchConfig = Omit<ResearchConfig, "company"> & {
  readonly company: readonly [AnySelection]
}

type AnyPersonDeepResearchConfig = Omit<DeepResearchConfig, "person"> & {
  readonly person: readonly [AnySelection]
}

type AnyCompanyDeepResearchConfig = Omit<DeepResearchConfig, "company"> & {
  readonly company: readonly [AnySelection]
}

type HybridNumericQuestions = Readonly<Record<string, string>> & { readonly 1: string }
type HybridSymbolQuestions = Readonly<Record<string, string>> & {
  readonly [uniqueQuestionKey]: string
}

type HybridNumericResearchConfig = ResearchConfig<HybridNumericQuestions>
type HybridSymbolResearchConfig = ResearchConfig<HybridSymbolQuestions>
type HybridNumericDeepResearchConfig = DeepResearchConfig<HybridNumericQuestions>
type HybridSymbolDeepResearchConfig = DeepResearchConfig<HybridSymbolQuestions>

type CallableQuestions =
  | ((...arguments_: never[]) => void)
  | ({ readonly accountFit: string } & ((...arguments_: never[]) => void))
type ConstructableQuestions =
  | (abstract new (...arguments_: never[]) => object)
  | ({ readonly accountFit: string } & (abstract new (...arguments_: never[]) => object))

type CallableResearchConfig = ResearchConfig<CallableQuestions>
type ConstructableResearchConfig = ResearchConfig<ConstructableQuestions>
type CallableDeepResearchConfig = DeepResearchConfig<CallableQuestions>
type ConstructableDeepResearchConfig = DeepResearchConfig<ConstructableQuestions>

type EmptyQuestions = Readonly<Record<never, string>>
type EmptyResearchConfig = ResearchConfig<EmptyQuestions>
type EmptyDeepResearchConfig = DeepResearchConfig<EmptyQuestions>

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

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier must preserve public behavior for interface-declared question maps.
interface InterfaceDeepResearchQuestions {
  readonly integrationCount: string
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- This verifier must preserve public behavior for interface-declared configs.
interface InterfaceDeepResearchConfig {
  readonly company: readonly ["legalName"]
  readonly deepResearch: InterfaceDeepResearchQuestions
  readonly person: readonly ["phone"]
  readonly ttl: "365d"
}

type AliasResearchConfig = {
  readonly company: readonly ["name"]
  readonly person: readonly ["title"]
  readonly research: { readonly accountFit: string }
  readonly ttl: "12h"
}

type AliasDeepResearchConfig = {
  readonly company: readonly ["legalName"]
  readonly deepResearch: { readonly integrationCount: string }
  readonly person: readonly ["phone"]
  readonly ttl: "365d"
}

const assertSelectedFieldCoverage = (
  literalResearch: SonarSnapshot<typeof questionResearchConfig>,
  literalDeepResearch: SonarSnapshot<typeof questionDeepResearchConfig>,
  broadResearch: SonarSnapshot<ResearchConfig>,
  broadDeepResearch: SonarSnapshot<DeepResearchConfig>,
  tupleUnionResearch: SonarSnapshot<TupleUnionResearchConfig>,
  unionElementResearch: SonarSnapshot<UnionElementResearchConfig>,
  unionElementDeepResearch: SonarSnapshot<UnionElementDeepResearchConfig>,
  anySelectionResearch: SonarSnapshot<AnySelectionResearchConfig>,
  anySelectionDeepResearch: SonarSnapshot<AnySelectionDeepResearchConfig>
) => {
  const literalFunding: Field<JSONValue> = literalResearch.data.company.funding
  const literalGithub: Field<string> = literalResearch.data.person.github
  const literalLegalName: Field<string> = literalDeepResearch.data.company.legalName
  const literalPhone: Field<string> = literalDeepResearch.data.person.phone
  const maybeFunding: Field<JSONValue> | undefined = broadResearch.data.company.funding
  const maybePhone: Field<string> | undefined = broadDeepResearch.data.person.phone
  const researchFallback: Field<JSONValue> | undefined = broadResearch.data.anyCustomQuestion
  const deepResearchFallback: Field<JSONValue> | undefined =
    broadDeepResearch.data.anyCustomQuestion
  const unionSelection: { readonly github?: Field<string>; readonly title?: Field<string> } =
    tupleUnionResearch.data.person
  const unionElementPerson: { readonly github?: Field<string>; readonly title?: Field<string> } =
    unionElementResearch.data.person
  const unionElementCompany: {
    readonly funding?: Field<JSONValue>
    readonly name?: Field<string>
  } = unionElementResearch.data.company
  const unionElementDeepPerson: { readonly phone?: Field<string> } =
    unionElementDeepResearch.data.person
  const unionElementDeepCompany: { readonly legalName?: Field<string> } =
    unionElementDeepResearch.data.company
  // @ts-expect-error A tuple-union result cannot make both alternatives required.
  const bothUnionFields: { readonly github: Field<string>; readonly title: Field<string> } =
    tupleUnionResearch.data.person
  // @ts-expect-error A union-valued tuple element makes research person selections partial.
  const requiredUnionElementPerson: {
    readonly github: Field<string>
    readonly title: Field<string>
  } = unionElementResearch.data.person
  // @ts-expect-error A union-valued tuple element makes research company selections partial.
  const requiredUnionElementCompany: {
    readonly funding: Field<JSONValue>
    readonly name: Field<string>
  } = unionElementResearch.data.company
  // @ts-expect-error A union-valued tuple element makes deep person selections partial.
  const requiredUnionElementDeepPerson: { readonly phone: Field<string> } =
    unionElementDeepResearch.data.person
  // @ts-expect-error A union-valued tuple element makes deep company selections partial.
  const requiredUnionElementDeepCompany: { readonly legalName: Field<string> } =
    unionElementDeepResearch.data.company
  // @ts-expect-error An any-valued person tuple cannot make the entire research catalog required.
  const requiredAnyResearchPerson: { readonly linkedin: Field<string>; readonly x: Field<string> } =
    anySelectionResearch.data.person
  // @ts-expect-error An any-valued company tuple cannot make the entire research catalog required.
  const requiredAnyResearchCompany: {
    readonly domain: Field<string>
    readonly logo: Field<string>
  } = anySelectionResearch.data.company
  // @ts-expect-error An any-valued person tuple cannot make deep person fields required.
  const requiredAnyDeepPerson: { readonly phone: Field<string> } =
    anySelectionDeepResearch.data.person
  // @ts-expect-error An any-valued company tuple cannot make deep company fields required.
  const requiredAnyDeepCompany: { readonly legalName: Field<string> } =
    anySelectionDeepResearch.data.company

  return {
    bothUnionFields,
    deepResearchFallback,
    literalFunding,
    literalGithub,
    literalLegalName,
    literalPhone,
    maybeFunding,
    maybePhone,
    requiredAnyDeepCompany,
    requiredAnyDeepPerson,
    requiredAnyResearchCompany,
    requiredAnyResearchPerson,
    requiredUnionElementCompany,
    requiredUnionElementDeepCompany,
    requiredUnionElementDeepPerson,
    requiredUnionElementPerson,
    researchFallback,
    unionElementCompany,
    unionElementDeepCompany,
    unionElementDeepPerson,
    unionElementPerson,
    unionSelection,
  }
}

void assertSelectedFieldCoverage

const sseResponse = (body: string) =>
  new Response(body, {
    headers: { "content-type": "text/event-stream" },
  })

const pendingSnapshotEvent =
  'id: 0\nevent: snapshot\ndata: {"status":"pending","data":{"person":{"title":{"status":"pending"}},"company":{}}}\n\n'

const pendingDeepSnapshotEvent =
  'id: 0\nevent: snapshot\ndata: {"status":"pending","data":{"person":{"phone":{"status":"pending"}},"company":{"legalName":{"status":"pending"}},"usesQuickBooks":{"status":"pending"}}}\n\n'

const collectResearch = () =>
  SonarClient.use((client) => Stream.runCollect(client.research(request)))

const asPublicService = (client: SonarClientService) => client
const publicTag = (error: SonarClientError) => error._tag

const assertQuestionDerivedAnswerTypes = (client: SonarClientService) => {
  const research = client.research(questionResearchRequest)
  const deepResearch = client.deepResearch(questionDeepResearchRequest)
  const retrieveResearch = client.retrieve("hash", questionResearchConfig)
  const retrieveDeepResearch = client.retrieve("hash", questionDeepResearchConfig)

  research.pipe(
    Stream.map((snapshot) => {
      const accountFit: Field<{ rationale: string; score: number }> = snapshot.data.accountFit
      const funding: Field<JSONValue> = snapshot.data.company.funding
      const github: Field<string> = snapshot.data.person.github
      const name: Field<string> = snapshot.data.company.name
      const plainContext: Field<JSONValue> = snapshot.data.plainContext
      const salesStage: Field<"early" | "late"> = snapshot.data.salesStage
      const title: Field<string> = snapshot.data.person.title
      // @ts-expect-error Unselected catalog fields cannot appear in a research result.
      void snapshot.data.company.domain
      // @ts-expect-error Unselected catalog fields cannot appear in a research result.
      void snapshot.data.person.linkedin
      // @ts-expect-error Phantom custom answers cannot appear in a research result.
      void snapshot.data.unrequestedAnswer
      return { accountFit, funding, github, name, plainContext, salesStage, title }
    })
  )
  deepResearch.pipe(
    Stream.map((snapshot) => {
      const integrationCount: Field<number> = snapshot.data.integrationCount
      const legalName: Field<string> = snapshot.data.company.legalName
      const phone: Field<string> = snapshot.data.person.phone
      const plainDeepContext: Field<JSONValue> = snapshot.data.plainDeepContext
      const technicalMaturity: Field<"emerging" | "established"> = snapshot.data.technicalMaturity
      // @ts-expect-error Research-only catalog fields cannot appear in a deep research result.
      void snapshot.data.company.name
      // @ts-expect-error Research-only catalog fields cannot appear in a deep research result.
      void snapshot.data.person.title
      // @ts-expect-error Phantom custom answers cannot appear in a deep research result.
      void snapshot.data.unrequestedAnswer
      return { integrationCount, legalName, phone, plainDeepContext, technicalMaturity }
    })
  )
  retrieveResearch.pipe(
    Effect.map((snapshot) => {
      const accountFit: Field<{ rationale: string; score: number }> = snapshot.data.accountFit
      const funding: Field<JSONValue> = snapshot.data.company.funding
      const github: Field<string> = snapshot.data.person.github
      const name: Field<string> = snapshot.data.company.name
      const plainContext: Field<JSONValue> = snapshot.data.plainContext
      const salesStage: Field<"early" | "late"> = snapshot.data.salesStage
      const title: Field<string> = snapshot.data.person.title
      // @ts-expect-error Retrieve preserves the literal selected catalog fields only.
      void snapshot.data.company.domain
      // @ts-expect-error Retrieve preserves the literal selected catalog fields only.
      void snapshot.data.person.linkedin
      // @ts-expect-error Retrieve cannot invent a custom answer field.
      void snapshot.data.unrequestedAnswer
      return { accountFit, funding, github, name, plainContext, salesStage, title }
    })
  )
  retrieveDeepResearch.pipe(
    Effect.map((snapshot) => {
      const integrationCount: Field<number> = snapshot.data.integrationCount
      const legalName: Field<string> = snapshot.data.company.legalName
      const phone: Field<string> = snapshot.data.person.phone
      const plainDeepContext: Field<JSONValue> = snapshot.data.plainDeepContext
      const technicalMaturity: Field<"emerging" | "established"> = snapshot.data.technicalMaturity
      // @ts-expect-error Deep retrieval cannot expose research-tier catalog fields.
      void snapshot.data.company.name
      // @ts-expect-error Deep retrieval cannot invent a custom answer field.
      void snapshot.data.unrequestedAnswer
      return { integrationCount, legalName, phone, plainDeepContext, technicalMaturity }
    })
  )

  const reservedResearchRequest = {
    ...questionResearchRequest,
    research: { person: question<boolean>("Is this a reserved key?") },
  } as const satisfies ResearchRequest
  const reservedDeepResearchRequest = {
    ...questionDeepResearchRequest,
    deepResearch: { deepResearch: question<boolean>("Is this a reserved key?") },
  } as const satisfies DeepResearchRequest
  const malformedResearchRequest = {
    ...questionResearchRequest,
    research: { "not-a-question": "Does this key violate the public contract?" },
  } as const
  const malformedDeepResearchRequest = {
    ...questionDeepResearchRequest,
    deepResearch: { "not-a-question": "Does this key violate the public contract?" },
  } as const
  const openResearchRequest: ResearchRequest = questionResearchRequest
  const openDeepResearchRequest: DeepResearchRequest = questionDeepResearchRequest
  const broadResearchConfig: ResearchConfig = questionResearchConfig
  const broadDeepResearchConfig: DeepResearchConfig = questionDeepResearchConfig
  const reservedResearchConfig = {
    ...questionResearchConfig,
    research: { person: question<boolean>("Is this a reserved key?") },
  } as const
  const reservedDeepResearchConfig = {
    ...questionDeepResearchConfig,
    deepResearch: { deepResearch: question<boolean>("Is this a reserved key?") },
  } as const
  const malformedResearchConfig = {
    ...questionResearchConfig,
    research: { "not-a-question": "Does this key violate the public contract?" },
  } as const
  const malformedDeepResearchConfig = {
    ...questionDeepResearchConfig,
    deepResearch: { "not-a-question": "Does this key violate the public contract?" },
  } as const
  type ValidOrReservedResearchConfig = typeof questionResearchConfig | typeof reservedResearchConfig
  type ValidOrMalformedResearchConfig =
    | typeof questionResearchConfig
    | typeof malformedResearchConfig
  type ValidOrReservedDeepResearchConfig =
    | typeof questionDeepResearchConfig
    | typeof reservedDeepResearchConfig
  type ValidOrMalformedDeepResearchConfig =
    | typeof questionDeepResearchConfig
    | typeof malformedDeepResearchConfig
  const validOrReservedResearchRequest: ResearchRequest<ValidOrReservedResearchConfig> =
    chooseRequestBranch(questionResearchRequest, reservedResearchRequest, false)
  const validOrMalformedResearchRequest: ResearchRequest<ValidOrMalformedResearchConfig> =
    chooseRequestBranch(questionResearchRequest, malformedResearchRequest, false)
  const validOrReservedDeepResearchRequest: DeepResearchRequest<ValidOrReservedDeepResearchConfig> =
    chooseRequestBranch(questionDeepResearchRequest, reservedDeepResearchRequest, false)
  const validOrMalformedDeepResearchRequest: DeepResearchRequest<ValidOrMalformedDeepResearchConfig> =
    chooseRequestBranch(questionDeepResearchRequest, malformedDeepResearchRequest, false)
  const validOrReservedResearchConfig: ValidOrReservedResearchConfig = chooseRequestBranch(
    questionResearchConfig,
    reservedResearchConfig,
    false
  )
  const validOrMalformedResearchConfig: ValidOrMalformedResearchConfig = chooseRequestBranch(
    questionResearchConfig,
    malformedResearchConfig,
    false
  )
  const validOrReservedDeepResearchConfig: ValidOrReservedDeepResearchConfig = chooseRequestBranch(
    questionDeepResearchConfig,
    reservedDeepResearchConfig,
    false
  )
  const validOrMalformedDeepResearchConfig: ValidOrMalformedDeepResearchConfig =
    chooseRequestBranch(questionDeepResearchConfig, malformedDeepResearchConfig, false)
  const numericResearchConfig = {
    ...questionResearchConfig,
    research: { 1: "Can numeric custom keys pass?" },
  } as const
  const numericDeepResearchConfig = {
    ...questionDeepResearchConfig,
    deepResearch: { 1: "Can numeric custom keys pass?" },
  } as const
  const symbolResearchConfig = {
    ...questionResearchConfig,
    research: { [uniqueQuestionKey]: "Can symbol custom keys pass?" },
  } as const
  const symbolDeepResearchConfig = {
    ...questionDeepResearchConfig,
    deepResearch: { [uniqueQuestionKey]: "Can symbol custom keys pass?" },
  } as const
  const optionalResearchConfig: Omit<ResearchConfig, "research"> & {
    readonly research: { readonly optionalAnswer?: string }
  } = {
    company: [],
    person: [],
    research: {},
    ttl: "12h",
  }
  const optionalDeepResearchConfig: Omit<DeepResearchConfig, "deepResearch"> & {
    readonly deepResearch: { readonly optionalAnswer?: string }
  } = {
    company: [],
    deepResearch: {},
    person: [],
    ttl: "365d",
  }
  const anyPersonResearchConfig: AnyPersonResearchConfig = {
    company: [],
    person: ["title"],
    research: {},
    ttl: "12h",
  }
  const anyCompanyResearchConfig: AnyCompanyResearchConfig = {
    company: ["name"],
    person: [],
    research: {},
    ttl: "12h",
  }
  const anyPersonDeepResearchConfig: AnyPersonDeepResearchConfig = {
    company: [],
    deepResearch: {},
    person: ["phone"],
    ttl: "365d",
  }
  const anyCompanyDeepResearchConfig: AnyCompanyDeepResearchConfig = {
    company: ["legalName"],
    deepResearch: {},
    person: [],
    ttl: "365d",
  }
  const anyPersonResearchRequest: ResearchRequest<AnyPersonResearchConfig> = {
    ...anyPersonResearchConfig,
    seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  }
  const anyCompanyResearchRequest: ResearchRequest<AnyCompanyResearchConfig> = {
    ...anyCompanyResearchConfig,
    seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  }
  const anyPersonDeepResearchRequest: DeepResearchRequest<AnyPersonDeepResearchConfig> = {
    ...anyPersonDeepResearchConfig,
    seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  }
  const anyCompanyDeepResearchRequest: DeepResearchRequest<AnyCompanyDeepResearchConfig> = {
    ...anyCompanyDeepResearchConfig,
    seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  }
  // SAFETY: This compile-only fixture represents an impossible runtime hybrid map so public
  // validation must reject its numeric own key before transport is constructed.
  const hybridNumericResearchQuestions = {
    1: "Can a numeric own key hide inside an open question map?",
    accountFit: "Is this account a fit?",
  } as HybridNumericQuestions
  // SAFETY: This compile-only fixture represents an impossible runtime hybrid map so public
  // validation must reject its unique-symbol own key before transport is constructed.
  const hybridSymbolResearchQuestions = {
    [uniqueQuestionKey]: "Can a symbol own key hide inside an open question map?",
    accountFit: "Is this account a fit?",
  } as HybridSymbolQuestions
  // SAFETY: The deep-tier fixture uses the same adversarial numeric map solely for type checking.
  const hybridNumericDeepResearchQuestions = {
    1: "Can a numeric own key hide inside an open question map?",
    integrationCount: "How many integrations are public?",
  } as HybridNumericQuestions
  // SAFETY: The deep-tier fixture uses the same adversarial symbol map solely for type checking.
  const hybridSymbolDeepResearchQuestions = {
    [uniqueQuestionKey]: "Can a symbol own key hide inside an open question map?",
    integrationCount: "How many integrations are public?",
  } as HybridSymbolQuestions
  const hybridNumericResearchConfig: HybridNumericResearchConfig = {
    company: [],
    person: [],
    research: hybridNumericResearchQuestions,
    ttl: "12h",
  }
  const hybridSymbolResearchConfig: HybridSymbolResearchConfig = {
    company: [],
    person: [],
    research: hybridSymbolResearchQuestions,
    ttl: "12h",
  }
  const hybridNumericDeepResearchConfig: HybridNumericDeepResearchConfig = {
    company: [],
    deepResearch: hybridNumericDeepResearchQuestions,
    person: [],
    ttl: "365d",
  }
  const hybridSymbolDeepResearchConfig: HybridSymbolDeepResearchConfig = {
    company: [],
    deepResearch: hybridSymbolDeepResearchQuestions,
    person: [],
    ttl: "365d",
  }
  const hybridNumericResearchRequest: ResearchRequest<HybridNumericResearchConfig> = {
    ...hybridNumericResearchConfig,
    seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  }
  const hybridSymbolResearchRequest: ResearchRequest<HybridSymbolResearchConfig> = {
    ...hybridSymbolResearchConfig,
    seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  }
  const hybridNumericDeepResearchRequest: DeepResearchRequest<HybridNumericDeepResearchConfig> = {
    ...hybridNumericDeepResearchConfig,
    seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  }
  const hybridSymbolDeepResearchRequest: DeepResearchRequest<HybridSymbolDeepResearchConfig> = {
    ...hybridSymbolDeepResearchConfig,
    seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  }
  const emptyResearchConfig: EmptyResearchConfig = {
    company: [],
    person: [],
    research: {},
    ttl: "12h",
  }
  const emptyDeepResearchConfig: EmptyDeepResearchConfig = {
    company: [],
    deepResearch: {},
    person: [],
    ttl: "365d",
  }
  const emptyResearchRequest: ResearchRequest<EmptyResearchConfig> = {
    ...emptyResearchConfig,
    seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  }
  const emptyDeepResearchRequest: DeepResearchRequest<EmptyDeepResearchConfig> = {
    ...emptyDeepResearchConfig,
    seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  }
  const callableQuestions: CallableQuestions = Object.assign(() => {}, {
    accountFit: "Can callable maps become questions?",
  })
  const constructableQuestions: ConstructableQuestions = class QuestionMap {
    readonly accountFit = "Can constructable maps become questions?"
  }
  const callableResearchConfig: CallableResearchConfig = {
    company: [],
    person: [],
    research: callableQuestions,
    ttl: "12h",
  }
  const constructableResearchConfig: ConstructableResearchConfig = {
    company: [],
    person: [],
    research: constructableQuestions,
    ttl: "12h",
  }
  const callableDeepResearchConfig: CallableDeepResearchConfig = {
    company: [],
    deepResearch: callableQuestions,
    person: [],
    ttl: "365d",
  }
  const constructableDeepResearchConfig: ConstructableDeepResearchConfig = {
    company: [],
    deepResearch: constructableQuestions,
    person: [],
    ttl: "365d",
  }
  const callableResearchRequest: ResearchRequest<CallableResearchConfig> = {
    ...callableResearchConfig,
    seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  }
  const constructableResearchRequest: ResearchRequest<ConstructableResearchConfig> = {
    ...constructableResearchConfig,
    seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  }
  const callableDeepResearchRequest: DeepResearchRequest<CallableDeepResearchConfig> = {
    ...callableDeepResearchConfig,
    seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  }
  const constructableDeepResearchRequest: DeepResearchRequest<ConstructableDeepResearchConfig> = {
    ...constructableDeepResearchConfig,
    seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  }
  const numericResearchRequest = {
    ...questionResearchRequest,
    research: { 1: "Can numeric custom keys pass?" },
  } as const
  const numericDeepResearchRequest = {
    ...questionDeepResearchRequest,
    deepResearch: { 1: "Can numeric custom keys pass?" },
  } as const
  const symbolResearchRequest = {
    ...questionResearchRequest,
    research: { [uniqueQuestionKey]: "Can symbol custom keys pass?" },
  } as const
  const symbolDeepResearchRequest = {
    ...questionDeepResearchRequest,
    deepResearch: { [uniqueQuestionKey]: "Can symbol custom keys pass?" },
  } as const
  const finiteResearchRequest: ValidResearchRequest<typeof questionResearchConfig> =
    questionResearchRequest
  const finiteDeepResearchRequest: ValidDeepResearchRequest<typeof questionDeepResearchConfig> =
    questionDeepResearchRequest
  const validEmptyResearch: ValidResearchRequest<EmptyResearchConfig> = emptyResearchRequest
  const validEmptyDeepResearch: ValidDeepResearchRequest<EmptyDeepResearchConfig> =
    emptyDeepResearchRequest
  const interfaceResearchConfig: InterfaceResearchConfig = {
    company: ["name"],
    person: ["title"],
    research: { accountFit: "Is this account a fit?" },
    ttl: "12h",
  }
  const aliasResearchConfig: AliasResearchConfig = {
    company: ["name"],
    person: ["title"],
    research: { accountFit: "Is this account a fit?" },
    ttl: "12h",
  }
  const interfaceDeepResearchConfig: InterfaceDeepResearchConfig = {
    company: ["legalName"],
    deepResearch: { integrationCount: "How many integrations are public?" },
    person: ["phone"],
    ttl: "365d",
  }
  const aliasDeepResearchConfig: AliasDeepResearchConfig = {
    company: ["legalName"],
    deepResearch: { integrationCount: "How many integrations are public?" },
    person: ["phone"],
    ttl: "365d",
  }
  const interfaceResearchRequest = {
    ...interfaceResearchConfig,
    seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  }
  const aliasResearchRequest = {
    ...aliasResearchConfig,
    seed: { email: "ada@example.com", fullName: "Ada Lovelace" },
  }
  const interfaceDeepResearchRequest = {
    ...interfaceDeepResearchConfig,
    seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  }
  const aliasDeepResearchRequest = {
    ...aliasDeepResearchConfig,
    seed: { linkedinURL: "https://www.linkedin.com/in/ada-lovelace" },
  }
  const validatedInterfaceResearch: ValidResearchRequest<InterfaceResearchConfig> =
    interfaceResearchRequest
  const validatedAliasResearch: ValidResearchRequest<AliasResearchConfig> = aliasResearchRequest
  const validatedInterfaceDeepResearch: ValidDeepResearchRequest<InterfaceDeepResearchConfig> =
    interfaceDeepResearchRequest
  const validatedAliasDeepResearch: ValidDeepResearchRequest<AliasDeepResearchConfig> =
    aliasDeepResearchRequest
  const broadResearchRequest: ValidResearchRequest<ResearchConfig> = openResearchRequest
  const broadDeepResearchRequest: ValidDeepResearchRequest<DeepResearchConfig> =
    openDeepResearchRequest
  const broadResearch = client.research(broadResearchRequest)
  const broadDeepResearch = client.deepResearch(broadDeepResearchRequest)
  const broadRetrievedResearch = client.retrieve("hash", broadResearchConfig)
  const broadRetrievedDeepResearch = client.retrieve("hash", broadDeepResearchConfig)
  const emptyResearch = client.research(validEmptyResearch)
  const emptyDeepResearch = client.deepResearch(validEmptyDeepResearch)
  const emptyRetrievedResearch = client.retrieve("hash", emptyResearchConfig)
  const emptyRetrievedDeepResearch = client.retrieve("hash", emptyDeepResearchConfig)
  const interfaceResearch = client.research(validatedInterfaceResearch)
  const aliasResearch = client.research(validatedAliasResearch)
  const interfaceDeepResearch = client.deepResearch(validatedInterfaceDeepResearch)
  const aliasDeepResearch = client.deepResearch(validatedAliasDeepResearch)
  const interfaceRetrievedResearch = client.retrieve("hash", interfaceResearchConfig)
  const aliasRetrievedResearch = client.retrieve("hash", aliasResearchConfig)
  const interfaceRetrievedDeepResearch = client.retrieve("hash", interfaceDeepResearchConfig)
  const aliasRetrievedDeepResearch = client.retrieve("hash", aliasDeepResearchConfig)

  broadResearch.pipe(
    Stream.map((snapshot) => {
      const custom: Field<JSONValue> | undefined = snapshot.data.anyCustomQuestion
      return custom
    })
  )
  broadDeepResearch.pipe(
    Stream.map((snapshot) => {
      const custom: Field<JSONValue> | undefined = snapshot.data.anyCustomQuestion
      return custom
    })
  )
  broadRetrievedResearch.pipe(
    Effect.map((snapshot) => {
      const custom: Field<JSONValue> | undefined = snapshot.data.anyCustomQuestion
      return custom
    })
  )
  broadRetrievedDeepResearch.pipe(
    Effect.map((snapshot) => {
      const custom: Field<JSONValue> | undefined = snapshot.data.anyCustomQuestion
      return custom
    })
  )
  interfaceResearch.pipe(
    Stream.map((snapshot) => {
      const accountFit: Field<JSONValue> = snapshot.data.accountFit
      const name: Field<string> = snapshot.data.company.name
      const title: Field<string> = snapshot.data.person.title
      return { accountFit, name, title }
    })
  )
  aliasResearch.pipe(
    Stream.map((snapshot) => {
      const accountFit: Field<JSONValue> = snapshot.data.accountFit
      const name: Field<string> = snapshot.data.company.name
      const title: Field<string> = snapshot.data.person.title
      return { accountFit, name, title }
    })
  )
  interfaceDeepResearch.pipe(
    Stream.map((snapshot) => {
      const integrationCount: Field<JSONValue> = snapshot.data.integrationCount
      const legalName: Field<string> = snapshot.data.company.legalName
      const phone: Field<string> = snapshot.data.person.phone
      return { integrationCount, legalName, phone }
    })
  )
  aliasDeepResearch.pipe(
    Stream.map((snapshot) => {
      const integrationCount: Field<JSONValue> = snapshot.data.integrationCount
      const legalName: Field<string> = snapshot.data.company.legalName
      const phone: Field<string> = snapshot.data.person.phone
      return { integrationCount, legalName, phone }
    })
  )
  interfaceRetrievedResearch.pipe(
    Effect.map((snapshot) => {
      const accountFit: Field<JSONValue> = snapshot.data.accountFit
      return accountFit
    })
  )
  aliasRetrievedResearch.pipe(
    Effect.map((snapshot) => {
      const accountFit: Field<JSONValue> = snapshot.data.accountFit
      return accountFit
    })
  )
  interfaceRetrievedDeepResearch.pipe(
    Effect.map((snapshot) => {
      const integrationCount: Field<JSONValue> = snapshot.data.integrationCount
      return integrationCount
    })
  )
  aliasRetrievedDeepResearch.pipe(
    Effect.map((snapshot) => {
      const integrationCount: Field<JSONValue> = snapshot.data.integrationCount
      return integrationCount
    })
  )
  emptyResearch.pipe(Stream.map((snapshot) => snapshot.data.person))
  emptyDeepResearch.pipe(Stream.map((snapshot) => snapshot.data.company))
  emptyRetrievedResearch.pipe(Effect.map((snapshot) => snapshot.data.person))
  emptyRetrievedDeepResearch.pipe(Effect.map((snapshot) => snapshot.data.company))

  // @ts-expect-error Custom questions cannot overwrite the public person result slot.
  client.research(reservedResearchRequest)
  // @ts-expect-error Custom questions cannot overwrite the public deepResearch request slot.
  client.deepResearch(reservedDeepResearchRequest)
  // @ts-expect-error Retrieve rejects the same reserved custom-answer keys as research.
  client.retrieve("hash", reservedResearchRequest)
  // @ts-expect-error Retrieve rejects reserved custom-answer keys for deep research too.
  client.retrieve("hash", reservedDeepResearchRequest)
  // @ts-expect-error Retrieve rejects finite reserved research question keys.
  client.retrieve("hash", reservedResearchConfig)
  // @ts-expect-error Retrieve rejects finite reserved deep question keys.
  client.retrieve("hash", reservedDeepResearchConfig)
  // @ts-expect-error Retrieve rejects finite malformed research question keys.
  client.retrieve("hash", malformedResearchConfig)
  // @ts-expect-error Retrieve rejects finite malformed deep question keys.
  client.retrieve("hash", malformedDeepResearchConfig)
  // @ts-expect-error Retrieve rejects finite numeric research question keys.
  client.retrieve("hash", numericResearchConfig)
  // @ts-expect-error Retrieve rejects finite numeric deep question keys.
  client.retrieve("hash", numericDeepResearchConfig)
  // @ts-expect-error Retrieve rejects finite symbol research question keys.
  client.retrieve("hash", symbolResearchConfig)
  // @ts-expect-error Retrieve rejects finite symbol deep question keys.
  client.retrieve("hash", symbolDeepResearchConfig)
  // @ts-expect-error Retrieve rejects finite optional research question values.
  client.retrieve("hash", optionalResearchConfig)
  // @ts-expect-error Retrieve rejects finite optional deep question values.
  client.retrieve("hash", optionalDeepResearchConfig)
  // @ts-expect-error Retrieve rejects a union that could carry an open config branch.
  client.retrieve("hash", chooseRequestBranch(questionResearchConfig, broadResearchConfig, false))
  // @ts-expect-error Retrieve rejects a whole research config union with a reserved branch.
  client.retrieve("hash", validOrReservedResearchConfig)
  // @ts-expect-error Retrieve rejects a whole research config union with a malformed branch.
  client.retrieve("hash", validOrMalformedResearchConfig)
  // @ts-expect-error Retrieve rejects a whole deep config union with a reserved branch.
  client.retrieve("hash", validOrReservedDeepResearchConfig)
  // @ts-expect-error Retrieve rejects a whole deep config union with a malformed branch.
  client.retrieve("hash", validOrMalformedDeepResearchConfig)
  // @ts-expect-error The exported alias rejects a whole research request union with a reserved branch.
  const invalidReservedResearchUnion: ValidResearchRequest<ValidOrReservedResearchConfig> =
    validOrReservedResearchRequest
  // @ts-expect-error The exported alias rejects a whole research request union with a malformed branch.
  const invalidMalformedResearchUnion: ValidResearchRequest<ValidOrMalformedResearchConfig> =
    validOrMalformedResearchRequest
  // @ts-expect-error The exported alias rejects a whole deep request union with a reserved branch.
  const invalidReservedDeepResearchUnion: ValidDeepResearchRequest<ValidOrReservedDeepResearchConfig> =
    validOrReservedDeepResearchRequest
  // @ts-expect-error The exported alias rejects a whole deep request union with a malformed branch.
  const invalidMalformedDeepResearchUnion: ValidDeepResearchRequest<ValidOrMalformedDeepResearchConfig> =
    validOrMalformedDeepResearchRequest
  // @ts-expect-error The exported alias rejects an any-valued research person selection.
  const invalidAnyPersonResearch: ValidResearchRequest<AnyPersonResearchConfig> =
    anyPersonResearchRequest
  // @ts-expect-error The exported alias rejects an any-valued research company selection.
  const invalidAnyCompanyResearch: ValidResearchRequest<AnyCompanyResearchConfig> =
    anyCompanyResearchRequest
  // @ts-expect-error The exported alias rejects an any-valued deep person selection.
  const invalidAnyPersonDeepResearch: ValidDeepResearchRequest<AnyPersonDeepResearchConfig> =
    anyPersonDeepResearchRequest
  // @ts-expect-error The exported alias rejects an any-valued deep company selection.
  const invalidAnyCompanyDeepResearch: ValidDeepResearchRequest<AnyCompanyDeepResearchConfig> =
    anyCompanyDeepResearchRequest
  // @ts-expect-error Research rejects an any-valued person selection before C can widen.
  client.research(anyPersonResearchRequest)
  // @ts-expect-error Research rejects an any-valued company selection before C can widen.
  client.research(anyCompanyResearchRequest)
  // @ts-expect-error Deep research rejects an any-valued person selection before C can widen.
  client.deepResearch(anyPersonDeepResearchRequest)
  // @ts-expect-error Deep research rejects an any-valued company selection before C can widen.
  client.deepResearch(anyCompanyDeepResearchRequest)
  // @ts-expect-error Retrieve rejects an any-valued research person selection before C can widen.
  client.retrieve("hash", anyPersonResearchConfig)
  // @ts-expect-error Retrieve rejects an any-valued research company selection before C can widen.
  client.retrieve("hash", anyCompanyResearchConfig)
  // @ts-expect-error Retrieve rejects an any-valued deep person selection before C can widen.
  client.retrieve("hash", anyPersonDeepResearchConfig)
  // @ts-expect-error Retrieve rejects an any-valued deep company selection before C can widen.
  client.retrieve("hash", anyCompanyDeepResearchConfig)
  // @ts-expect-error The exported alias rejects an open map with a numeric own key.
  const invalidHybridNumericResearch: ValidResearchRequest<HybridNumericResearchConfig> =
    hybridNumericResearchRequest
  // @ts-expect-error The exported alias rejects an open map with a symbol own key.
  const invalidHybridSymbolResearch: ValidResearchRequest<HybridSymbolResearchConfig> =
    hybridSymbolResearchRequest
  // @ts-expect-error The exported alias rejects a deep open map with a numeric own key.
  const invalidHybridNumericDeepResearch: ValidDeepResearchRequest<HybridNumericDeepResearchConfig> =
    hybridNumericDeepResearchRequest
  // @ts-expect-error The exported alias rejects a deep open map with a symbol own key.
  const invalidHybridSymbolDeepResearch: ValidDeepResearchRequest<HybridSymbolDeepResearchConfig> =
    hybridSymbolDeepResearchRequest
  // @ts-expect-error The exported alias rejects callable question maps.
  const invalidCallableResearch: ValidResearchRequest<CallableResearchConfig> =
    callableResearchRequest
  // @ts-expect-error The exported alias rejects constructable question maps.
  const invalidConstructableResearch: ValidResearchRequest<ConstructableResearchConfig> =
    constructableResearchRequest
  // @ts-expect-error The exported alias rejects callable deep question maps.
  const invalidCallableDeepResearch: ValidDeepResearchRequest<CallableDeepResearchConfig> =
    callableDeepResearchRequest
  // @ts-expect-error The exported alias rejects constructable deep question maps.
  const invalidConstructableDeepResearch: ValidDeepResearchRequest<ConstructableDeepResearchConfig> =
    constructableDeepResearchRequest
  // @ts-expect-error Research rejects an open map with a numeric own key.
  client.research(hybridNumericResearchRequest)
  // @ts-expect-error Research rejects an open map with a symbol own key.
  client.research(hybridSymbolResearchRequest)
  // @ts-expect-error Deep research rejects an open map with a numeric own key.
  client.deepResearch(hybridNumericDeepResearchRequest)
  // @ts-expect-error Deep research rejects an open map with a symbol own key.
  client.deepResearch(hybridSymbolDeepResearchRequest)
  // @ts-expect-error Retrieve rejects an open map with a numeric own key.
  client.retrieve("hash", hybridNumericResearchConfig)
  // @ts-expect-error Retrieve rejects an open map with a symbol own key.
  client.retrieve("hash", hybridSymbolResearchConfig)
  // @ts-expect-error Retrieve rejects a deep open map with a numeric own key.
  client.retrieve("hash", hybridNumericDeepResearchConfig)
  // @ts-expect-error Retrieve rejects a deep open map with a symbol own key.
  client.retrieve("hash", hybridSymbolDeepResearchConfig)
  // @ts-expect-error Research rejects callable question maps.
  client.research(callableResearchRequest)
  // @ts-expect-error Research rejects constructable question maps.
  client.research(constructableResearchRequest)
  // @ts-expect-error Deep research rejects callable question maps.
  client.deepResearch(callableDeepResearchRequest)
  // @ts-expect-error Deep research rejects constructable question maps.
  client.deepResearch(constructableDeepResearchRequest)
  // @ts-expect-error Retrieve rejects callable question maps.
  client.retrieve("hash", callableResearchConfig)
  // @ts-expect-error Retrieve rejects constructable question maps.
  client.retrieve("hash", constructableResearchConfig)
  // @ts-expect-error Retrieve rejects callable deep question maps.
  client.retrieve("hash", callableDeepResearchConfig)
  // @ts-expect-error Retrieve rejects constructable deep question maps.
  client.retrieve("hash", constructableDeepResearchConfig)
  // @ts-expect-error Numeric-only finite research questions are not valid public keys.
  const invalidNumericResearch: ValidResearchRequest<Omit<typeof numericResearchRequest, "seed">> =
    numericResearchRequest
  // @ts-expect-error Numeric-only finite deep questions are not valid public keys.
  const invalidNumericDeepResearch: ValidDeepResearchRequest<
    Omit<typeof numericDeepResearchRequest, "seed">
  > = numericDeepResearchRequest
  // @ts-expect-error Symbol-only finite research questions are not valid public keys.
  const invalidSymbolResearch: ValidResearchRequest<Omit<typeof symbolResearchRequest, "seed">> =
    symbolResearchRequest
  // @ts-expect-error Symbol-only finite deep questions are not valid public keys.
  const invalidSymbolDeepResearch: ValidDeepResearchRequest<
    Omit<typeof symbolDeepResearchRequest, "seed">
  > = symbolDeepResearchRequest
  // @ts-expect-error Public service validation also rejects numeric-only research keys.
  client.research(numericResearchRequest)
  // @ts-expect-error Public service validation also rejects numeric-only deep keys.
  client.deepResearch(numericDeepResearchRequest)
  // @ts-expect-error Public service validation also rejects symbol-only research keys.
  client.research(symbolResearchRequest)
  // @ts-expect-error Public service validation also rejects symbol-only deep keys.
  client.deepResearch(symbolDeepResearchRequest)
  // @ts-expect-error Research rejects a whole request union with a reserved question branch.
  client.research(validOrReservedResearchRequest)
  // @ts-expect-error Research rejects a whole request union with a malformed question branch.
  client.research(validOrMalformedResearchRequest)
  // @ts-expect-error A research union is unsafe when any branch has open custom-question keys.
  client.research(chooseRequestBranch(questionResearchRequest, openResearchRequest, false))
  // @ts-expect-error A research union is unsafe when any branch belongs to the deep tier.
  client.research(chooseRequestBranch(questionResearchRequest, questionDeepResearchRequest, false))
  // @ts-expect-error Deep research rejects a whole request union with a reserved question branch.
  client.deepResearch(validOrReservedDeepResearchRequest)
  // @ts-expect-error Deep research rejects a whole request union with a malformed question branch.
  client.deepResearch(validOrMalformedDeepResearchRequest)
  client.deepResearch(
    // @ts-expect-error A deep union is unsafe when any branch has open custom-question keys.
    chooseRequestBranch(questionDeepResearchRequest, openDeepResearchRequest, false)
  )
  client.deepResearch(
    // @ts-expect-error A deep union is unsafe when any branch belongs to the research tier.
    chooseRequestBranch(questionDeepResearchRequest, questionResearchRequest, false)
  )

  void finiteResearchRequest
  void finiteDeepResearchRequest
  void invalidAnyPersonResearch
  void invalidAnyCompanyResearch
  void invalidAnyPersonDeepResearch
  void invalidAnyCompanyDeepResearch
  void invalidHybridNumericResearch
  void invalidHybridSymbolResearch
  void invalidHybridNumericDeepResearch
  void invalidHybridSymbolDeepResearch
  void invalidCallableResearch
  void invalidConstructableResearch
  void invalidCallableDeepResearch
  void invalidConstructableDeepResearch
  void invalidReservedResearchUnion
  void invalidMalformedResearchUnion
  void invalidReservedDeepResearchUnion
  void invalidMalformedDeepResearchUnion
  void invalidNumericResearch
  void invalidNumericDeepResearch
  void invalidSymbolResearch
  void invalidSymbolDeepResearch

  return [research, deepResearch, retrieveResearch, retrieveDeepResearch]
}

type PublicErrorSurface = {
  readonly json: string
  readonly message: string
  readonly ownProperties: string[]
  readonly tag: SonarClientError["_tag"]
}

const publicErrorSurface = (error: SonarClientError): PublicErrorSurface => ({
  json: JSON.stringify(error),
  message: error.message,
  ownProperties: Object.getOwnPropertyNames(error),
  tag: error._tag,
})

const expectSecretSafeSurface = (surface: PublicErrorSurface, credential: string) => {
  expect(surface.message).toBeTruthy()
  expect(surface.json).not.toContain(credential)
  expect(surface.json).not.toMatch(/"(?:body|cause|headers|request|response)"\s*:/u)
  expect(surface.ownProperties).not.toEqual(
    expect.arrayContaining(["body", "cause", "headers", "request", "response"])
  )
}

describe("@usesonar/effect API Layers", () => {
  test("adapts injected raw API options through the service Layer and preserves the all-pending first snapshot", async () => {
    const requests: Request[] = []
    const snapshots = await Effect.runPromise(
      collectResearch().pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: (input) => {
              const rawRequest = input instanceof Request ? input : new Request(input)
              requests.push(rawRequest)
              return Promise.resolve(
                sseResponse(
                  [
                    pendingSnapshotEvent,
                    'id: 1\nevent: field\ndata: {"path":"person.title","status":"resolved","value":"Mathematician","confidence":0.98,"sources":[],"resolvedAt":"2026-08-26T12:00:00.000Z"}\n\n',
                    'id: 2\nevent: complete\ndata: {"hash":"sonar_effect_verifier"}\n\n',
                  ].join("")
                )
              )
            },
            publishableKey: "pk_test_effect_verifier",
          })
        )
      )
    )

    const values = [...snapshots]
    expect(values[0]?.data.person.title).toEqual({ status: "pending" })
    expect(values.at(-1)?.status).toBe("complete")
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe("POST")
    expect(requests[0]?.url).toBe("https://sonar.example.test/v1/research")
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer pk_test_effect_verifier")
    expect(requests[0]?.headers.get("accept")).toBe("text/event-stream")
    await expect(requests[0]?.json()).resolves.toEqual(request)
  })

  test("exposes separate research, deepResearch, and retrieve operations through the injected service", async () => {
    const operations = await Effect.runPromise(
      SonarClient.use((client) => Effect.succeed(client)).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.resolve(sseResponse("")),
            publishableKey: "pk_test_effect_verifier",
          })
        )
      )
    )

    const service = asPublicService(operations)

    expect(service.research).toBeFunction()
    expect(service.deepResearch).toBeFunction()
    expect(service.retrieve).toBeFunction()
    expect(assertQuestionDerivedAnswerTypes(service)).toHaveLength(4)
    expect(publicTag(new HTTPError({ message: "Sonar HTTP request failed", status: 401 }))).toBe(
      "HTTPError"
    )
  })

  test("sends deepResearch to its route with a flat body and emits a hash-free snapshot", async () => {
    const requests: Request[] = []
    const snapshots = await Effect.runPromise(
      SonarClient.use((client) => Stream.runCollect(client.deepResearch(deepRequest))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: (input) => {
              const rawRequest = input instanceof Request ? input : new Request(input)
              requests.push(rawRequest)
              return Promise.resolve(
                sseResponse(
                  [
                    pendingDeepSnapshotEvent,
                    'id: 1\nevent: field\ndata: {"path":"person.phone","status":"resolved","value":"555-0100","confidence":0.98,"sources":[],"resolvedAt":"2026-08-26T12:00:00.000Z"}\n\n',
                    'id: 2\nevent: field\ndata: {"path":"company.legalName","status":"notFound","reason":"providerEmpty"}\n\n',
                    'id: 3\nevent: field\ndata: {"path":"usesQuickBooks","status":"skipped","reason":"noCompanySeed"}\n\n',
                    'id: 4\nevent: complete\ndata: {"hash":"sonar_effect_verifier"}\n\n',
                  ].join("")
                )
              )
            },
            publishableKey: "pk_test_effect_verifier",
          })
        )
      )
    )

    const values = [...snapshots]
    expect(values[0]).toEqual({
      data: {
        company: { legalName: { status: "pending" } },
        person: { phone: { status: "pending" } },
        usesQuickBooks: { status: "pending" },
      },
      status: "pending",
    })
    expect(values.at(-1)?.status).toBe("complete")
    expect(requests[0]?.url).toBe("https://sonar.example.test/v1/deepResearch")
    await expect(requests[0]?.json()).resolves.toEqual(deepRequest)
    expect("hash" in (values.at(-1) ?? {})).toBeFalse()
  })

  test("retrieves an encoded raw API snapshot and strips its hash from the Effect result", async () => {
    const requests: Request[] = []
    const hash = "tenant/hash ?"
    const snapshot = await Effect.runPromise(
      SonarClient.use((client) => client.retrieve(hash, config)).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: (input) => {
              const rawRequest = input instanceof Request ? input : new Request(input)
              requests.push(rawRequest)
              return Promise.resolve(
                Response.json({
                  data: {
                    company: {},
                    person: { title: { reason: "providerEmpty", status: "notFound" } },
                  },
                  hash,
                  status: "complete",
                })
              )
            },
            publishableKey: "pk_test_effect_verifier",
          })
        )
      )
    )

    expect(requests[0]?.method).toBe("GET")
    expect(requests[0]?.url).toBe("https://sonar.example.test/v1/tenant%2Fhash%20%3F")
    expect(snapshot).toEqual({
      data: { company: {}, person: { title: { reason: "providerEmpty", status: "notFound" } } },
      status: "complete",
    })
    expect("hash" in snapshot).toBeFalse()
  })

  test("rejects a retrieve response whose inherited toString masks a missing custom answer", async () => {
    const prototypeKeyConfig = {
      company: [],
      person: [],
      research: { toString: "Is this an own custom answer?" },
      ttl: "12h",
    } as const satisfies ResearchConfig
    const responseData = {
      company: {},
      foo: { reason: "providerEmpty", status: "notFound" },
      person: {},
    }
    const result = await Effect.runPromise(
      SonarClient.use((client) => client.retrieve("hash", prototypeKeyConfig)).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () =>
              Promise.resolve(
                Response.json({
                  data: responseData,
                  hash: "hash",
                  status: "complete",
                })
              ),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.flatMap(() => Effect.die("Expected ProtocolError")),
        Effect.catchTag("ProtocolError", (error) =>
          Effect.succeed({ message: error.message, tag: error._tag })
        )
      )
    )

    expect(Object.keys(responseData)).toEqual(["company", "foo", "person"])
    expect("toString" in responseData).toBeTrue()
    expect(Object.hasOwn(responseData, "toString")).toBeFalse()
    expect(result).toEqual({
      message: "Retrieved snapshot does not match the requested config",
      tag: "ProtocolError",
    })
  })

  test("detaches a research retrieve config before delayed mutation", async () => {
    const mutableConfig = {
      company: [],
      person: ["title"],
      research: { originalAnswer: "What was requested first?" },
      ttl: "12h",
    } as const satisfies ResearchConfig
    let fetchCalls = 0
    const result = await Effect.runPromise(
      SonarClient.use((client) => client.retrieve("hash", mutableConfig)).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => {
              fetchCalls += 1
              // SAFETY: Reflect deliberately crosses the literal fixture's static boundary after
              // retrieve validates it, proving response matching must use its detached snapshot.
              Reflect.set(mutableConfig.person, 0, "github")
              Reflect.deleteProperty(mutableConfig.research, "originalAnswer")
              Reflect.set(
                mutableConfig.research,
                "changedAnswer",
                "What was changed after validation?"
              )
              return Promise.resolve(
                Response.json({
                  data: {
                    changedAnswer: { reason: "providerEmpty", status: "notFound" },
                    company: {},
                    person: { github: { reason: "providerEmpty", status: "notFound" } },
                  },
                  hash: "hash",
                  status: "complete",
                })
              )
            },
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.flatMap(() => Effect.die("Expected ProtocolError")),
        Effect.catchTag("ProtocolError", (error) =>
          Effect.succeed({ message: error.message, tag: error._tag })
        )
      )
    )

    expect(fetchCalls).toBe(1)
    expect(result).toEqual({
      message: "Retrieved snapshot does not match the requested config",
      tag: "ProtocolError",
    })
  })

  test("detaches a deep retrieve config before delayed getter changes", async () => {
    let changed = false
    const getterConfig = {
      get company() {
        return changed ? [] : ["legalName"]
      },
      get deepResearch() {
        return changed
          ? { changedAnswer: "What changed after validation?" }
          : { originalAnswer: "What was requested first?" }
      },
      get person() {
        return changed ? [] : ["phone"]
      },
      ttl: "365d",
    }
    let fetchCalls = 0
    const result = await Effect.runPromise(
      SonarClient.use((client) =>
        // SAFETY: Getter-backed input bypasses the static config shape only to prove the runtime
        // Layer detaches parsed deep configuration before delayed transport work begins.
        client.retrieve("hash", getterConfig as never)
      ).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => {
              fetchCalls += 1
              changed = true
              return Promise.resolve(
                Response.json({
                  data: {
                    changedAnswer: { reason: "providerEmpty", status: "notFound" },
                    company: {},
                    person: {},
                  },
                  hash: "hash",
                  status: "complete",
                })
              )
            },
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.flatMap(() => Effect.die("Expected ProtocolError")),
        Effect.catchTag("ProtocolError", (error) =>
          Effect.succeed({ message: error.message, tag: error._tag })
        )
      )
    )

    expect(fetchCalls).toBe(1)
    expect(result).toEqual({
      message: "Retrieved snapshot does not match the requested config",
      tag: "ProtocolError",
    })
  })

  test("maps research request, HTTP, transport, and protocol failures to safe public Effect errors", async () => {
    const invalidRequest = {
      ...request,
      ttl: "11h",
    }
    const requestFailure = await Effect.runPromise(
      SonarClient.use((client) =>
        // SAFETY: This fixture deliberately violates the runtime TTL contract to verify that the
        // Layer returns RequestError without weakening the public research request type.
        Stream.runDrain(client.research(invalidRequest as never))
      ).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.resolve(sseResponse("")),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("RequestError", () => Effect.succeed("RequestError"))
      )
    )
    const httpFailure = await Effect.runPromise(
      SonarClient.use((client) => Stream.runDrain(client.research(request))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () =>
              Promise.resolve(Response.json({ message: "Unauthorized" }, { status: 401 })),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("HTTPError", (error) =>
          Effect.succeed({ status: error.status, tag: error._tag })
        )
      )
    )
    const transportFailure = await Effect.runPromise(
      SonarClient.use((client) => Stream.runDrain(client.research(request))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.reject(new TypeError("offline")),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("TransportError", () => Effect.succeed("TransportError"))
      )
    )
    const protocolFailure = await Effect.runPromise(
      SonarClient.use((client) => Stream.runDrain(client.research(request))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.resolve(sseResponse("id: 0\nevent: unknown\ndata: {}\n\n")),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("ProtocolError", () => Effect.succeed("ProtocolError"))
      )
    )

    expect(requestFailure).toBe("RequestError")
    expect(httpFailure).toEqual({ status: 401, tag: "HTTPError" })
    expect([transportFailure, protocolFailure]).toEqual(["TransportError", "ProtocolError"])
  })

  test("redacts raw Ky internals and causes from every public tagged error", async () => {
    const credential = "pk_effect_verifier_credential"
    const invalidRequest = { ...request, ttl: "11h" }
    let rawRequest: Request | undefined
    const httpFailure = await Effect.runPromise(
      SonarClient.use((client) => Stream.runDrain(client.research(request))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: (input) => {
              rawRequest = input instanceof Request ? input : new Request(input)
              return Promise.resolve(
                Response.json(
                  { credential, internalBody: { credential } },
                  {
                    headers: { "x-internal-credential": credential },
                    status: 401,
                  }
                )
              )
            },
            publishableKey: credential,
          })
        ),
        Effect.flatMap(() => Effect.die("Expected HTTPError")),
        Effect.catchTag("HTTPError", (error) =>
          Effect.succeed({ ...publicErrorSurface(error), status: error.status })
        )
      )
    )
    const requestFailure = await Effect.runPromise(
      SonarClient.use((client) =>
        // SAFETY: This fixture intentionally crosses the parsed TTL boundary to obtain the
        // real RequestError surface without broadening the public request type.
        Stream.runDrain(client.research(invalidRequest as never))
      ).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.resolve(sseResponse("")),
            publishableKey: credential,
          })
        ),
        Effect.flatMap(() => Effect.die("Expected RequestError")),
        Effect.catchTag("RequestError", (error) => Effect.succeed(publicErrorSurface(error)))
      )
    )
    const transportFailure = await Effect.runPromise(
      SonarClient.use((client) => Stream.runDrain(client.research(request))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.reject(new TypeError(`offline ${credential}`)),
            publishableKey: credential,
          })
        ),
        Effect.flatMap(() => Effect.die("Expected TransportError")),
        Effect.catchTag("TransportError", (error) => Effect.succeed(publicErrorSurface(error)))
      )
    )
    const protocolFailure = await Effect.runPromise(
      SonarClient.use((client) => Stream.runDrain(client.research(request))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () =>
              Promise.resolve(
                sseResponse(`id: 0\nevent: unknown\ndata: {"credential":"${credential}"}\n\n`)
              ),
            publishableKey: credential,
          })
        ),
        Effect.flatMap(() => Effect.die("Expected ProtocolError")),
        Effect.catchTag("ProtocolError", (error) => Effect.succeed(publicErrorSurface(error)))
      )
    )

    expect(rawRequest?.headers.get("authorization")).toBe(`Bearer ${credential}`)
    expect(httpFailure.status).toBe(401)
    expect(httpFailure.tag).toBe("HTTPError")
    expect([requestFailure.tag, transportFailure.tag, protocolFailure.tag]).toEqual([
      "RequestError",
      "TransportError",
      "ProtocolError",
    ])
    for (const surface of [httpFailure, requestFailure, transportFailure, protocolFailure]) {
      expectSecretSafeSurface(surface, credential)
    }
  })

  test("maps deepResearch request, HTTP, transport, and protocol failures to public Effect tags", async () => {
    const invalidRequest = { ...deepRequest, ttl: "11h" }
    const requestFailure = await Effect.runPromise(
      SonarClient.use((client) =>
        // SAFETY: This fixture deliberately violates the runtime TTL contract to exercise the
        // declared RequestError channel without widening the public deepResearch request type.
        Stream.runDrain(client.deepResearch(invalidRequest as never))
      ).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.resolve(sseResponse("")),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("RequestError", () => Effect.succeed("RequestError"))
      )
    )
    const httpFailure = await Effect.runPromise(
      SonarClient.use((client) => Stream.runDrain(client.deepResearch(deepRequest))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () =>
              Promise.resolve(Response.json({ message: "Unauthorized" }, { status: 401 })),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("HTTPError", (error) => Effect.succeed(error.status))
      )
    )
    const transportFailure = await Effect.runPromise(
      SonarClient.use((client) => Stream.runDrain(client.deepResearch(deepRequest))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.reject(new TypeError("offline")),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("TransportError", () => Effect.succeed("TransportError"))
      )
    )
    const protocolFailure = await Effect.runPromise(
      SonarClient.use((client) => Stream.runDrain(client.deepResearch(deepRequest))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.resolve(sseResponse("id: 0\\nevent: unknown\\ndata: {}\\n\\n")),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("ProtocolError", () => Effect.succeed("ProtocolError"))
      )
    )

    expect([requestFailure, httpFailure, transportFailure, protocolFailure]).toEqual([
      "RequestError",
      401,
      "TransportError",
      "ProtocolError",
    ])
  })

  test("maps retrieve request, HTTP, transport, and protocol failures to public Effect tags", async () => {
    const requestFailure = await Effect.runPromise(
      SonarClient.use((client) => client.retrieve("   ", config)).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.resolve(Response.json({})),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("RequestError", () => Effect.succeed("RequestError"))
      )
    )
    const httpFailure = await Effect.runPromise(
      SonarClient.use((client) => client.retrieve("hash", config)).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () =>
              Promise.resolve(Response.json({ message: "Unauthorized" }, { status: 401 })),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("HTTPError", (error) => Effect.succeed(error.status))
      )
    )
    const transportFailure = await Effect.runPromise(
      SonarClient.use((client) => client.retrieve("hash", config)).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => Promise.reject(new TypeError("offline")),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("TransportError", () => Effect.succeed("TransportError"))
      )
    )
    const protocolFailure = await Effect.runPromise(
      SonarClient.use((client) => client.retrieve("hash", config)).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () =>
              Promise.resolve(
                Response.json({
                  data: { company: {}, person: {} },
                  hash: "hash",
                  status: "complete",
                })
              ),
            publishableKey: "pk_test_effect_verifier",
          })
        ),
        Effect.catchTag("ProtocolError", () => Effect.succeed("ProtocolError"))
      )
    )

    expect([requestFailure, httpFailure, transportFailure, protocolFailure]).toEqual([
      "RequestError",
      401,
      "TransportError",
      "ProtocolError",
    ])
  })

  test("rejects malformed research and deep retrieve configs before transport", async () => {
    const malformedConfigs = [
      {
        company: [],
        person: [],
        research: { person: "Can a custom question overwrite person?" },
        ttl: "12h",
      },
      {
        company: [],
        person: [],
        research: { accountFit: "Is this account a fit?" },
        ttl: "1h",
      },
      {
        company: [],
        person: ["title", "title"],
        research: { accountFit: "Is this account a fit?" },
        ttl: "12h",
      },
      {
        company: [],
        person: [],
        research: { accountFit: "Is this account a fit?" },
        ttl: "12h",
        unexpected: true,
      },
      {
        company: ["legalName"],
        deepResearch: { person: "Can a custom question overwrite person?" },
        person: ["phone"],
        ttl: "365d",
      },
      {
        company: ["legalName"],
        deepResearch: { integrationCount: "How many integrations are public?" },
        person: ["phone"],
        ttl: "366d",
      },
      {
        company: ["legalName"],
        deepResearch: { integrationCount: "How many integrations are public?" },
        person: ["phone"],
        research: {},
        ttl: "365d",
      },
    ] as const
    let fetchCalls = 0
    const failures = await Effect.runPromise(
      Effect.all(
        malformedConfigs.map((invalidConfig) =>
          SonarClient.use((client) =>
            // SAFETY: These verifier fixtures deliberately cross the static config boundary to
            // prove retrieve rejects malformed untrusted input before the raw API can run.
            client.retrieve("hash", invalidConfig as never)
          ).pipe(Effect.catchTag("RequestError", () => Effect.succeed("RequestError")))
        )
      ).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => {
              fetchCalls += 1
              return Promise.resolve(Response.json({}))
            },
            publishableKey: "pk_test_effect_verifier",
          })
        )
      )
    )

    expect(failures).toEqual([
      "RequestError",
      "RequestError",
      "RequestError",
      "RequestError",
      "RequestError",
      "RequestError",
      "RequestError",
    ])
    expect(fetchCalls).toBe(0)
  })

  test("rejects path-reserved retrieve hashes before transport", async () => {
    let fetchCalls = 0
    const failures = await Effect.runPromise(
      Effect.all(
        ([".", ".."] as const).map((hash) =>
          SonarClient.use((client) => client.retrieve(hash, config)).pipe(
            Effect.catchTag("RequestError", () => Effect.succeed("RequestError"))
          )
        )
      ).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () => {
              fetchCalls += 1
              return Promise.resolve(Response.json({}))
            },
            publishableKey: "pk_test_effect_verifier",
          })
        )
      )
    )

    expect(failures).toEqual(["RequestError", "RequestError"])
    expect(fetchCalls).toBe(0)
  })

  test("adapts a public raw API instance through layerFromAPI", async () => {
    const requests: Request[] = []
    const api = createSonar({
      baseURL: "https://sonar.example.test/",
      fetch: (input) => {
        const rawRequest = input instanceof Request ? input : new Request(input)
        requests.push(rawRequest)
        return Promise.resolve(
          sseResponse(
            [
              pendingSnapshotEvent,
              'id: 1\nevent: field\ndata: {"path":"person.title","status":"notFound","reason":"providerEmpty"}\n\n',
              'id: 2\nevent: complete\ndata: {"hash":"sonar_effect_verifier"}\n\n',
            ].join("")
          )
        )
      },
      publishableKey: "pk_test_effect_verifier",
    })
    const snapshots = await Effect.runPromise(
      collectResearch().pipe(Effect.provide(layerFromAPI(api)))
    )

    expect(requests[0]?.url).toBe("https://sonar.example.test/v1/research")
    expect([...snapshots].at(-1)).toEqual({
      data: { company: {}, person: { title: { reason: "providerEmpty", status: "notFound" } } },
      status: "complete",
    })
  })

  test("interrupts a live API stream without leaving its body active", async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode(pendingSnapshotEvent))
      },
    })
    const snapshots = await Effect.runPromise(
      SonarClient.use((client) => Stream.runCollect(Stream.take(client.research(request), 1))).pipe(
        Effect.provide(
          layer({
            baseURL: "https://sonar.example.test/",
            fetch: () =>
              Promise.resolve(
                new Response(body, { headers: { "content-type": "text/event-stream" } })
              ),
            publishableKey: "pk_test_effect_verifier",
          })
        )
      )
    )

    expect([...snapshots]).toHaveLength(1)
    expect(cancelled).toBeTrue()
  })
})

/* eslint-disable typescript/consistent-type-definitions, typescript/no-explicit-any -- This external compiler fixture preserves genuine interface probes and proves explicit any cannot bypass the factory constraints. */
import { question } from "@usesonar/effect"
import type { DeepResearchConfig, Field, JSONValue, ResearchConfig } from "@usesonar/effect"
import { deepResearchSonar, researchSonar } from "@usesonar/eve"

type IsNever<Value> = [Value] extends [never] ? true : false
type AssertFalse<Value extends false> = Value
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type AssertTrue<Value extends true> = Value
declare const dynamicAnswerSymbol: unique symbol
declare const staticQuestionSymbol: unique symbol
declare const staticQuestionUnion: { readonly firstKey: string } | { readonly secondKey: string }
declare const researchPersonTupleUnion: readonly ["title"] | readonly ["github"]
declare const deepCompanyTupleUnion: readonly [] | readonly ["legalName"]
declare const researchPersonElementUnion: readonly ["title" | "github"]
declare const researchCompanyElementUnion: readonly ["name" | "domain"]
type InvalidDynamicUnion = { readonly goodKey: string } | { readonly person: string }
type OpenDynamicUnion = { readonly goodKey: string } | Readonly<Record<string, JSONValue>>
type ValidDynamicUnion = { readonly goodKey: string } | { readonly otherKey: number }
type NumericDynamicAnswers = { readonly 0: string }
type OptionalDynamicAnswers = { readonly goodKey?: string }
type SymbolDynamicAnswers = { readonly [dynamicAnswerSymbol]: string }
type UndefinedDynamicAnswers = { readonly goodKey: undefined }
interface FiniteInterfaceAnswers {
  readonly interfaceAnswer: string
}
type CallableAnswers = {
  (): void
  readonly goodKey: string
}
type ConstructableAnswers = {
  new (): object
  readonly goodKey: string
}
interface FiniteInterfaceQuestions {
  readonly interfaceQuestion: string
}
interface BroadInterfaceQuestions {
  readonly [key: string]: string
}
type BroadQuestionsWithNumericKey = Readonly<Record<string, string>> & { readonly 0: string }
type BroadQuestionsWithSymbolKey = Readonly<Record<string, string>> & {
  readonly [staticQuestionSymbol]: string
}
type CallableQuestions = {
  (): void
  readonly goodKey: string
}

const dynamicConfig = { dynamic: true, ttl: "12h" } as const
const defaultTool = researchSonar({ dynamic: true, ttl: "12h" })
const customTool = researchSonar<{ jobFit: string }>({ dynamic: true, ttl: "12h" })
researchSonar<FiniteInterfaceAnswers>(dynamicConfig)
researchSonar<Readonly<Record<never, never>>>(dynamicConfig)
// @ts-expect-error Explicit any cannot bypass dynamic research answer-map validation.
researchSonar<any>(dynamicConfig)
// @ts-expect-error Dynamic research answer maps cannot be callable.
researchSonar<CallableAnswers>(dynamicConfig)
// @ts-expect-error Dynamic research answer maps cannot be constructable.
researchSonar<ConstructableAnswers>(dynamicConfig)
// @ts-expect-error Dynamic research answer maps cannot be broad object.
researchSonar<object>(dynamicConfig)
// @ts-expect-error Dynamic custom answer keys cannot use reserved Sonar field names.
researchSonar<{ person: string }>({ dynamic: true, ttl: "12h" })
// @ts-expect-error Dynamic custom answer keys must be lower-camel identifiers.
researchSonar<{ "bad-key": string }>({ dynamic: true, ttl: "12h" })
// @ts-expect-error Dynamic custom answers require a finite key map.
researchSonar<Readonly<Record<string, JSONValue>>>({ dynamic: true, ttl: "12h" })
// @ts-expect-error Every dynamic research union member must use valid custom keys.
researchSonar<InvalidDynamicUnion>({ dynamic: true, ttl: "12h" })
// @ts-expect-error An open-record union member makes dynamic research keys unbounded.
researchSonar<OpenDynamicUnion>({ dynamic: true, ttl: "12h" })
// @ts-expect-error Explicit dynamic research answer maps cannot be unions.
researchSonar<ValidDynamicUnion>(dynamicConfig)
// @ts-expect-error Dynamic research answer properties cannot be optional.
researchSonar<OptionalDynamicAnswers>(dynamicConfig)
// @ts-expect-error Dynamic research answer values cannot be undefined.
researchSonar<UndefinedDynamicAnswers>(dynamicConfig)
// @ts-expect-error Dynamic research answer maps cannot use numeric keys.
researchSonar<NumericDynamicAnswers>(dynamicConfig)
// @ts-expect-error Dynamic research answer maps cannot use symbol keys.
researchSonar<SymbolDynamicAnswers>(dynamicConfig)
const deepForegroundTool = deepResearchSonar<{ riskScore: number }>({
  dynamic: true,
  ttl: "12h",
})
const deepBackgroundTool = deepResearchSonar<{ riskScore: number }>(
  { dynamic: true, ttl: "12h" },
  { execution: "background" }
)
deepResearchSonar<FiniteInterfaceAnswers>(dynamicConfig)
deepResearchSonar<FiniteInterfaceAnswers>(dynamicConfig, {
  execution: "background",
})
deepResearchSonar<Readonly<Record<never, never>>>(dynamicConfig)
deepResearchSonar<Readonly<Record<never, never>>>(dynamicConfig, { execution: "background" })
// @ts-expect-error Explicit any cannot bypass foreground deep answer-map validation.
deepResearchSonar<any>(dynamicConfig)
// @ts-expect-error Explicit any cannot bypass background deep answer-map validation.
deepResearchSonar<any>(dynamicConfig, { execution: "background" })
// @ts-expect-error Foreground deep answer maps cannot be callable.
deepResearchSonar<CallableAnswers>(dynamicConfig)
// @ts-expect-error Foreground deep answer maps cannot be constructable.
deepResearchSonar<ConstructableAnswers>(dynamicConfig)
// @ts-expect-error Foreground deep answer maps cannot be broad object.
deepResearchSonar<object>(dynamicConfig)
// @ts-expect-error Background deep answer maps cannot be callable.
deepResearchSonar<CallableAnswers>(dynamicConfig, { execution: "background" })
// @ts-expect-error Background deep answer maps cannot be constructable.
deepResearchSonar<ConstructableAnswers>(dynamicConfig, { execution: "background" })
// @ts-expect-error Background deep answer maps cannot be broad object.
deepResearchSonar<object>(dynamicConfig, { execution: "background" })
// @ts-expect-error Foreground deep custom keys cannot use reserved Sonar field names.
deepResearchSonar<{ person: string }>({ dynamic: true, ttl: "12h" })
// @ts-expect-error Foreground deep custom keys must be lower-camel identifiers.
deepResearchSonar<{ "bad-key": string }>({ dynamic: true, ttl: "12h" })
// @ts-expect-error Foreground deep custom answers require a finite key map.
deepResearchSonar<Readonly<Record<string, JSONValue>>>({ dynamic: true, ttl: "12h" })
// @ts-expect-error Every foreground deep union member must use valid custom keys.
deepResearchSonar<InvalidDynamicUnion>({ dynamic: true, ttl: "12h" })
// @ts-expect-error An open-record union member makes foreground deep keys unbounded.
deepResearchSonar<OpenDynamicUnion>({ dynamic: true, ttl: "12h" })
// @ts-expect-error Explicit foreground deep answer maps cannot be unions.
deepResearchSonar<ValidDynamicUnion>(dynamicConfig)
// @ts-expect-error Foreground deep answer properties cannot be optional.
deepResearchSonar<OptionalDynamicAnswers>(dynamicConfig)
// @ts-expect-error Foreground deep answer values cannot be undefined.
deepResearchSonar<UndefinedDynamicAnswers>(dynamicConfig)
// @ts-expect-error Foreground deep answer maps cannot use numeric keys.
deepResearchSonar<NumericDynamicAnswers>(dynamicConfig)
// @ts-expect-error Foreground deep answer maps cannot use symbol keys.
deepResearchSonar<SymbolDynamicAnswers>(dynamicConfig)
deepResearchSonar<{ person: string }>(
  // @ts-expect-error Background deep custom keys cannot use reserved Sonar field names.
  { dynamic: true, ttl: "12h" },
  { execution: "background" }
)
deepResearchSonar<{ "bad-key": string }>(
  // @ts-expect-error Background deep custom keys must be lower-camel identifiers.
  { dynamic: true, ttl: "12h" },
  { execution: "background" }
)
deepResearchSonar<Readonly<Record<string, JSONValue>>>(
  // @ts-expect-error Background deep custom answers require a finite key map.
  { dynamic: true, ttl: "12h" },
  { execution: "background" }
)
deepResearchSonar<InvalidDynamicUnion>(
  // @ts-expect-error Every background deep union member must use valid custom keys.
  { dynamic: true, ttl: "12h" },
  { execution: "background" }
)
deepResearchSonar<OpenDynamicUnion>(
  // @ts-expect-error An open-record union member makes background deep keys unbounded.
  { dynamic: true, ttl: "12h" },
  { execution: "background" }
)
// @ts-expect-error Explicit background deep answer maps cannot be unions.
deepResearchSonar<ValidDynamicUnion>(dynamicConfig, { execution: "background" })
// @ts-expect-error Background deep answer properties cannot be optional.
deepResearchSonar<OptionalDynamicAnswers>(dynamicConfig, { execution: "background" })
// @ts-expect-error Background deep answer values cannot be undefined.
deepResearchSonar<UndefinedDynamicAnswers>(dynamicConfig, { execution: "background" })
// @ts-expect-error Background deep answer maps cannot use numeric keys.
deepResearchSonar<NumericDynamicAnswers>(dynamicConfig, { execution: "background" })
// @ts-expect-error Background deep answer maps cannot use symbol keys.
deepResearchSonar<SymbolDynamicAnswers>(dynamicConfig, { execution: "background" })
const staticResearchBase = {
  company: ["name"],
  person: ["title"],
  ttl: "12h",
} as const
const staticTool = researchSonar({
  ...staticResearchBase,
  research: {
    jobFit: question<boolean>("Is this person a fit for the role?"),
    plainAnswer: "Return any JSON-compatible evidence.",
  },
})
declare const selectionAny: any
// @ts-expect-error A fixed research person tuple cannot contain any.
researchSonar({ ...staticResearchBase, person: [selectionAny] as const, research: {} })
// @ts-expect-error A fixed research company tuple cannot contain any.
researchSonar({ ...staticResearchBase, company: [selectionAny] as const, research: {} })
// @ts-expect-error Static research questions cannot use reserved Sonar field names.
researchSonar({ ...staticResearchBase, research: { person: "Who is this person?" } })
// @ts-expect-error Static research question keys must begin with a lowercase letter.
researchSonar({ ...staticResearchBase, research: { BadKey: "What is the answer?" } })
// @ts-expect-error Static research question maps cannot use numeric keys.
researchSonar({ ...staticResearchBase, research: { 0: "What is the answer?" } })
// @ts-expect-error Static research question maps cannot use symbol keys.
researchSonar({ ...staticResearchBase, research: { [staticQuestionSymbol]: "Question?" } })
// @ts-expect-error Static research question maps must be one finite object, not a union.
researchSonar({ ...staticResearchBase, research: staticQuestionUnion })
const staticDeepBase = {
  company: ["legalName"],
  person: ["phone"],
  ttl: "12h",
} as const
const staticDeepTool = deepResearchSonar({
  ...staticDeepBase,
  deepResearch: {
    hasTaxExposure: question<number>("How many states create tax exposure?"),
    plainDeepAnswer: "Return any JSON-compatible evidence.",
  },
})
// @ts-expect-error A fixed deep person tuple cannot contain any.
deepResearchSonar({ ...staticDeepBase, deepResearch: {}, person: [selectionAny] as const })
// @ts-expect-error A fixed deep company tuple cannot contain any.
deepResearchSonar({ ...staticDeepBase, company: [selectionAny] as const, deepResearch: {} })
// @ts-expect-error Static deep questions cannot use reserved Sonar field names.
deepResearchSonar({ ...staticDeepBase, deepResearch: { company: "Which company?" } })
deepResearchSonar(
  // @ts-expect-error Static deep question keys must be lower-camel identifiers.
  { ...staticDeepBase, deepResearch: { bad_key: "What is the answer?" } },
  { execution: "background" }
)
// @ts-expect-error Static deep question maps cannot use numeric keys.
deepResearchSonar({ ...staticDeepBase, deepResearch: { 0: "What is the answer?" } })
// @ts-expect-error Static deep question maps cannot use symbol keys.
deepResearchSonar({ ...staticDeepBase, deepResearch: { [staticQuestionSymbol]: "Question?" } })
// @ts-expect-error Static deep question maps must be one finite object, not a union.
deepResearchSonar({ ...staticDeepBase, deepResearch: staticQuestionUnion })
const broadResearchConfig: ResearchConfig = {
  company: ["name"],
  person: ["title"],
  research: { jobFit: "Is this person a fit?" },
  ttl: "12h",
}
const broadDeepConfig: DeepResearchConfig = {
  company: ["legalName"],
  deepResearch: { hasTaxExposure: "Does this company have tax exposure?" },
  person: ["phone"],
  ttl: "12h",
}
const broadResearchTool = researchSonar(broadResearchConfig)
const broadDeepTool = deepResearchSonar(broadDeepConfig)
declare const broadQuestions: Readonly<Record<string, string>>
declare const maybeUndefinedQuestions: Readonly<Record<string, string | undefined>>
declare const interfaceQuestions: FiniteInterfaceQuestions
declare const broadInterfaceQuestions: BroadInterfaceQuestions
declare const broadQuestionsWithNumericKey: BroadQuestionsWithNumericKey
declare const broadQuestionsWithSymbolKey: BroadQuestionsWithSymbolKey
declare const callableQuestions: CallableQuestions
declare const broadQuestionObject: object
const broadRecordResearchTool = researchSonar({
  ...staticResearchBase,
  research: broadQuestions,
})
const broadRecordDeepTool = deepResearchSonar({
  ...staticDeepBase,
  deepResearch: broadQuestions,
})
researchSonar({
  ...staticResearchBase,
  research: interfaceQuestions,
})
deepResearchSonar({
  ...staticDeepBase,
  deepResearch: interfaceQuestions,
})
researchSonar({
  ...staticResearchBase,
  research: broadInterfaceQuestions,
})
deepResearchSonar({
  ...staticDeepBase,
  deepResearch: broadInterfaceQuestions,
})
researchSonar({ ...staticResearchBase, research: {} })
deepResearchSonar({ ...staticDeepBase, deepResearch: {} })
// @ts-expect-error Static research question maps cannot be callable.
researchSonar({ ...staticResearchBase, research: callableQuestions })
// @ts-expect-error Static deep question maps cannot be callable.
deepResearchSonar({ ...staticDeepBase, deepResearch: callableQuestions })
// @ts-expect-error Static research question maps cannot be broad object.
researchSonar({ ...staticResearchBase, research: broadQuestionObject })
// @ts-expect-error Static deep question maps cannot be broad object.
deepResearchSonar({ ...staticDeepBase, deepResearch: broadQuestionObject })
// @ts-expect-error Broad research questions cannot add a numeric key.
researchSonar({ ...staticResearchBase, research: broadQuestionsWithNumericKey })
// @ts-expect-error Broad research questions cannot add a symbol key.
researchSonar({ ...staticResearchBase, research: broadQuestionsWithSymbolKey })
// @ts-expect-error Broad deep questions cannot add a numeric key.
deepResearchSonar({ ...staticDeepBase, deepResearch: broadQuestionsWithNumericKey })
// @ts-expect-error Broad deep questions cannot add a symbol key.
deepResearchSonar({ ...staticDeepBase, deepResearch: broadQuestionsWithSymbolKey })
// @ts-expect-error Broad static research questions cannot permit undefined values.
researchSonar({ ...staticResearchBase, research: maybeUndefinedQuestions })
// @ts-expect-error Broad static deep questions cannot permit undefined values.
deepResearchSonar({ ...staticDeepBase, deepResearch: maybeUndefinedQuestions })
const tupleUnionResearchTool = researchSonar({
  ...staticResearchBase,
  person: researchPersonTupleUnion,
  research: { tupleAnswer: "Question?" },
})
const tupleUnionDeepTool = deepResearchSonar({
  ...staticDeepBase,
  company: deepCompanyTupleUnion,
  deepResearch: { tupleAnswer: "Question?" },
})
const elementUnionResearchTool = researchSonar({
  ...staticResearchBase,
  company: researchCompanyElementUnion,
  person: researchPersonElementUnion,
  research: { elementAnswer: "Question?" },
})
const exactMultiResearchTool = researchSonar({
  ...staticResearchBase,
  company: ["name", "domain"] as const,
  person: ["title", "github"] as const,
  research: { exactAnswer: "Question?" },
})

type DefaultExecuteInput = Parameters<typeof defaultTool.execute>[0]
type DefaultProjectionInput = Parameters<NonNullable<typeof defaultTool.toModelOutput>>[0]
type CustomProjectionInput = Parameters<NonNullable<typeof customTool.toModelOutput>>[0]
type DeepForegroundProjectionInput = Parameters<
  NonNullable<typeof deepForegroundTool.toModelOutput>
>[0]
type DeepBackgroundProjectionInput = Parameters<
  NonNullable<typeof deepBackgroundTool.toModelOutput>
>[0]
type StaticProjectionInput = Parameters<NonNullable<typeof staticTool.toModelOutput>>[0]
type StaticDeepProjectionInput = Parameters<NonNullable<typeof staticDeepTool.toModelOutput>>[0]
type BroadResearchProjectionInput = Parameters<
  NonNullable<typeof broadResearchTool.toModelOutput>
>[0]
type BroadDeepProjectionInput = Parameters<NonNullable<typeof broadDeepTool.toModelOutput>>[0]
type BroadRecordResearchProjectionInput = Parameters<
  NonNullable<typeof broadRecordResearchTool.toModelOutput>
>[0]
type BroadRecordDeepProjectionInput = Parameters<
  NonNullable<typeof broadRecordDeepTool.toModelOutput>
>[0]
type TupleUnionResearchProjectionInput = Parameters<
  NonNullable<typeof tupleUnionResearchTool.toModelOutput>
>[0]
type TupleUnionDeepProjectionInput = Parameters<
  NonNullable<typeof tupleUnionDeepTool.toModelOutput>
>[0]
type ElementUnionResearchProjectionInput = Parameters<
  NonNullable<typeof elementUnionResearchTool.toModelOutput>
>[0]
type ExactMultiResearchProjectionInput = Parameters<
  NonNullable<typeof exactMultiResearchTool.toModelOutput>
>[0]
type ResearchNext = Awaited<ReturnType<ReturnType<typeof customTool.execute>["next"]>>
type DeepForegroundNext = Awaited<ReturnType<ReturnType<typeof deepForegroundTool.execute>["next"]>>
type ResearchCompletion = Extract<ResearchNext, { readonly done: true }>
type DeepForegroundCompletion = Extract<DeepForegroundNext, { readonly done: true }>

type DefaultExecuteInputIsUsable = AssertFalse<IsNever<DefaultExecuteInput>>
type DefaultProjectionDataIsUsable = AssertFalse<IsNever<DefaultProjectionInput["data"]>>
type ResearchCompletionIsUndefined = AssertTrue<Equal<ResearchCompletion["value"], undefined>>
type DeepForegroundCompletionIsUndefined = AssertTrue<
  Equal<DeepForegroundCompletion["value"], undefined>
>
type JobFitIsExactlyOptional = AssertTrue<
  Equal<CustomProjectionInput["data"]["jobFit"], Field<string> | undefined>
>
type DeepForegroundRiskScoreIsExactlyOptional = AssertTrue<
  Equal<DeepForegroundProjectionInput["data"]["riskScore"], Field<number> | undefined>
>
type DeepBackgroundRiskScoreIsExactlyOptional = AssertTrue<
  Equal<DeepBackgroundProjectionInput["data"]["riskScore"], Field<number> | undefined>
>
type BroadResearchTitleIsOptional = AssertTrue<
  Equal<BroadResearchProjectionInput["data"]["person"]["title"], Field<string> | undefined>
>
type BroadResearchGithubIsOptional = AssertTrue<
  Equal<BroadResearchProjectionInput["data"]["person"]["github"], Field<string> | undefined>
>
type BroadResearchNameIsOptional = AssertTrue<
  Equal<BroadResearchProjectionInput["data"]["company"]["name"], Field<string> | undefined>
>
type BroadResearchFundingIsOptional = AssertTrue<
  Equal<BroadResearchProjectionInput["data"]["company"]["funding"], Field<JSONValue> | undefined>
>
type BroadDeepPhoneIsOptional = AssertTrue<
  Equal<BroadDeepProjectionInput["data"]["person"]["phone"], Field<string> | undefined>
>
type BroadDeepLegalNameIsOptional = AssertTrue<
  Equal<BroadDeepProjectionInput["data"]["company"]["legalName"], Field<string> | undefined>
>
type BroadRecordResearchAnswerIsOptional = AssertTrue<
  Equal<BroadRecordResearchProjectionInput["data"]["runtimeAnswer"], Field<JSONValue> | undefined>
>
type BroadRecordDeepAnswerIsOptional = AssertTrue<
  Equal<BroadRecordDeepProjectionInput["data"]["runtimeAnswer"], Field<JSONValue> | undefined>
>
type TupleUnionResearchTitleIsOptional = AssertTrue<
  Equal<TupleUnionResearchProjectionInput["data"]["person"]["title"], Field<string> | undefined>
>
type TupleUnionResearchGithubIsOptional = AssertTrue<
  Equal<TupleUnionResearchProjectionInput["data"]["person"]["github"], Field<string> | undefined>
>
type TupleUnionDeepLegalNameIsOptional = AssertTrue<
  Equal<TupleUnionDeepProjectionInput["data"]["company"]["legalName"], Field<string> | undefined>
>
type ElementUnionResearchTitleIsOptional = AssertTrue<
  Equal<ElementUnionResearchProjectionInput["data"]["person"]["title"], Field<string> | undefined>
>
type ElementUnionResearchGithubIsOptional = AssertTrue<
  Equal<ElementUnionResearchProjectionInput["data"]["person"]["github"], Field<string> | undefined>
>
type ElementUnionResearchNameIsOptional = AssertTrue<
  Equal<ElementUnionResearchProjectionInput["data"]["company"]["name"], Field<string> | undefined>
>
type ElementUnionResearchDomainIsOptional = AssertTrue<
  Equal<ElementUnionResearchProjectionInput["data"]["company"]["domain"], Field<string> | undefined>
>
type ExactMultiResearchTitleIsRequired = AssertTrue<
  Equal<ExactMultiResearchProjectionInput["data"]["person"]["title"], Field<string>>
>
type ExactMultiResearchGithubIsRequired = AssertTrue<
  Equal<ExactMultiResearchProjectionInput["data"]["person"]["github"], Field<string>>
>
type ExactMultiResearchNameIsRequired = AssertTrue<
  Equal<ExactMultiResearchProjectionInput["data"]["company"]["name"], Field<string>>
>
type ExactMultiResearchDomainIsRequired = AssertTrue<
  Equal<ExactMultiResearchProjectionInput["data"]["company"]["domain"], Field<string>>
>
type LiteralResearchTitleIsRequired = AssertTrue<
  Equal<StaticProjectionInput["data"]["person"]["title"], Field<string>>
>
type LiteralDeepLegalNameIsRequired = AssertTrue<
  Equal<StaticDeepProjectionInput["data"]["company"]["legalName"], Field<string>>
>

declare const customProjectionInput: CustomProjectionInput
declare const deepForegroundProjectionInput: DeepForegroundProjectionInput
declare const deepBackgroundProjectionInput: DeepBackgroundProjectionInput
declare const staticProjectionInput: StaticProjectionInput
declare const staticDeepProjectionInput: StaticDeepProjectionInput
const jobFit: Field<string> | undefined = customProjectionInput.data.jobFit
const deepForegroundRiskScore: Field<number> | undefined =
  deepForegroundProjectionInput.data.riskScore
const deepForegroundPhone: Field<string> | undefined =
  deepForegroundProjectionInput.data.person.phone
const deepBackgroundRiskScore: Field<number> | undefined =
  deepBackgroundProjectionInput.data.riskScore
const deepBackgroundPhone: Field<string> | undefined =
  deepBackgroundProjectionInput.data.person.phone
const dynamicDataWithoutSelections: CustomProjectionInput["data"] = {
  company: {},
  person: {},
}
const staticJobFit: Field<boolean> = staticProjectionInput.data.jobFit
const staticPlainAnswer: Field<JSONValue> = staticProjectionInput.data.plainAnswer
const staticDeepAnswer: Field<number> = staticDeepProjectionInput.data.hasTaxExposure
const staticPlainDeepAnswer: Field<JSONValue> = staticDeepProjectionInput.data.plainDeepAnswer
// @ts-expect-error Static output contains exactly the configured custom answer keys.
const assertNoOtherAnswer = () => staticProjectionInput.data.otherAnswer

export type TypeScript5SemanticProof = {
  readonly defaultExecuteInputIsUsable: DefaultExecuteInputIsUsable
  readonly defaultProjectionDataIsUsable: DefaultProjectionDataIsUsable
  readonly elementUnionResearchDomainIsOptional: ElementUnionResearchDomainIsOptional
  readonly elementUnionResearchGithubIsOptional: ElementUnionResearchGithubIsOptional
  readonly elementUnionResearchNameIsOptional: ElementUnionResearchNameIsOptional
  readonly elementUnionResearchTitleIsOptional: ElementUnionResearchTitleIsOptional
  readonly exactMultiResearchDomainIsRequired: ExactMultiResearchDomainIsRequired
  readonly exactMultiResearchGithubIsRequired: ExactMultiResearchGithubIsRequired
  readonly exactMultiResearchNameIsRequired: ExactMultiResearchNameIsRequired
  readonly exactMultiResearchTitleIsRequired: ExactMultiResearchTitleIsRequired
  readonly broadDeepLegalNameIsOptional: BroadDeepLegalNameIsOptional
  readonly broadDeepPhoneIsOptional: BroadDeepPhoneIsOptional
  readonly broadResearchFundingIsOptional: BroadResearchFundingIsOptional
  readonly broadResearchGithubIsOptional: BroadResearchGithubIsOptional
  readonly broadResearchNameIsOptional: BroadResearchNameIsOptional
  readonly broadResearchTitleIsOptional: BroadResearchTitleIsOptional
  readonly broadRecordDeepAnswerIsOptional: BroadRecordDeepAnswerIsOptional
  readonly broadRecordResearchAnswerIsOptional: BroadRecordResearchAnswerIsOptional
  readonly deepBackgroundRiskScoreIsExactlyOptional: DeepBackgroundRiskScoreIsExactlyOptional
  readonly deepBackgroundPhone: typeof deepBackgroundPhone
  readonly deepBackgroundRiskScore: typeof deepBackgroundRiskScore
  readonly deepForegroundCompletionIsUndefined: DeepForegroundCompletionIsUndefined
  readonly deepForegroundPhone: typeof deepForegroundPhone
  readonly deepForegroundRiskScore: typeof deepForegroundRiskScore
  readonly deepForegroundRiskScoreIsExactlyOptional: DeepForegroundRiskScoreIsExactlyOptional
  readonly dynamicDataWithoutSelections: typeof dynamicDataWithoutSelections
  readonly jobFit: typeof jobFit
  readonly jobFitIsExactlyOptional: JobFitIsExactlyOptional
  readonly literalDeepLegalNameIsRequired: LiteralDeepLegalNameIsRequired
  readonly literalResearchTitleIsRequired: LiteralResearchTitleIsRequired
  readonly noOtherAnswer: typeof assertNoOtherAnswer
  readonly researchCompletionIsUndefined: ResearchCompletionIsUndefined
  readonly staticJobFit: typeof staticJobFit
  readonly staticDeepAnswer: typeof staticDeepAnswer
  readonly staticPlainDeepAnswer: typeof staticPlainDeepAnswer
  readonly staticPlainAnswer: typeof staticPlainAnswer
  readonly tupleUnionDeepLegalNameIsOptional: TupleUnionDeepLegalNameIsOptional
  readonly tupleUnionResearchGithubIsOptional: TupleUnionResearchGithubIsOptional
  readonly tupleUnionResearchTitleIsOptional: TupleUnionResearchTitleIsOptional
}

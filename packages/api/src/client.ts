import ky from "ky"
import type { KyInstance, Options } from "ky"

import {
  DeepResearchRequest,
  ResearchRequest,
  SonarResponse,
  snapshotMatchesRequest,
} from "./schemas.ts"
import type {
  AnswersOf,
  DeepResearchCompanyField,
  DeepResearchPersonField,
  Field,
  JSONValue,
  ResearchPersonField,
  SonarData,
  ValidQuestions,
} from "./schemas.ts"

type CapabilityKey =
  | { publishableKey: string; secretKey?: never }
  | { publishableKey?: never; secretKey: string }

type CreateSonarOptions = Omit<Options, "baseUrl" | "prefix"> & {
  baseURL: string
} & CapabilityKey

const forbiddenRoutingOptions = new Set(["baseUrl", "prefix", "prefixUrl"])

const snapshotSonarOptions = (options: CreateSonarOptions): CreateSonarOptions => {
  if (options === null || Object(options) !== options) {
    throw new TypeError("Sonar options must be an object")
  }
  if (Object.getOwnPropertySymbols(options).length > 0) {
    throw new TypeError("Sonar options cannot contain symbol keys")
  }
  for (const key of Object.getOwnPropertyNames(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key)
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError("Sonar options must use own enumerable data properties")
    }
    if (forbiddenRoutingOptions.has(key)) {
      throw new TypeError(`The ${key} option cannot override baseURL`)
    }
  }
  if (!Object.hasOwn(options, "baseURL")) {
    throw new TypeError("Provide an own baseURL")
  }
  const hasPublishableKey = Object.hasOwn(options, "publishableKey")
  const hasSecretKey = Object.hasOwn(options, "secretKey")
  if (hasPublishableKey === hasSecretKey) {
    throw new TypeError("Provide exactly one own publishableKey or secretKey")
  }
  return { ...options }
}

const normalizedCapabilityKey = (
  publishableKey: string | undefined,
  secretKey: string | undefined
): string => {
  const publishableIsValid = publishableKey !== undefined && publishableKey.trim().length > 0
  const secretIsValid = secretKey !== undefined && secretKey.trim().length > 0
  if (publishableIsValid && secretKey === undefined) {
    return publishableKey.trim()
  }
  if (secretIsValid && publishableKey === undefined) {
    return secretKey.trim()
  }
  throw new TypeError("Provide exactly one non-empty publishableKey or secretKey")
}

export const createSonar = (settings: CreateSonarOptions): KyInstance => {
  const { baseURL, publishableKey, secretKey, ...options } = snapshotSonarOptions(settings)
  const parsedBaseURL = new URL(baseURL)
  const capabilityKey = normalizedCapabilityKey(publishableKey, secretKey)
  // SAFETY: Ky's Headers input only widens the standard HeadersInit record with undefined values,
  // which Ky treats as omitted header entries before constructing its Request.
  const headers = new Headers(options.headers as HeadersInit | undefined)
  headers.set("authorization", `Bearer ${capabilityKey}`)

  const configuredFetch = options.fetch
  const fetch = configuredFetch
    ? (input: RequestInfo | URL, init?: RequestInit) =>
        configuredFetch(input instanceof Request ? input.clone() : input, init)
    : undefined

  return ky.create({
    ...options,
    baseUrl: parsedBaseURL,
    fetch,
    headers,
  })
}

type ResearchCatalog = {
  person: Record<ResearchPersonField, string>
  company: {
    domain: string
    name: string
    logo: string
    colors: JSONValue
    location: JSONValue
    description: string
    funding: JSONValue
  }
}

type DeepResearchCatalog = {
  person: Record<DeepResearchPersonField, string>
  company: Record<DeepResearchCompanyField, string>
}

type IsAny<Value> = 0 extends 1 & Value ? true : false

type IsUnion<Value, Whole = Value> = Value extends unknown
  ? [Whole] extends [Value]
    ? false
    : true
  : never

type TupleHasUnionElement<Keys extends readonly unknown[]> = Keys extends readonly [
  infer Head,
  ...infer Tail,
]
  ? true extends IsUnion<Head>
    ? true
    : TupleHasUnionElement<Tail>
  : false

type SelectedCatalogKeys<
  Catalog extends Record<string, JSONValue>,
  Keys extends readonly unknown[],
> = {
  [Key in keyof Catalog]: [Extract<Keys[number], Key>] extends [never] ? never : Key
}[keyof Catalog]

type SelectedFields<
  Catalog extends Record<string, JSONValue>,
  Keys extends readonly (keyof Catalog)[],
> = Keys extends unknown
  ? number extends Keys["length"]
    ? { [Key in SelectedCatalogKeys<Catalog, Keys>]?: Field<Catalog[Key]> }
    : true extends TupleHasUnionElement<Keys>
      ? { [Key in SelectedCatalogKeys<Catalog, Keys>]?: Field<Catalog[Key]> }
      : { [Key in SelectedCatalogKeys<Catalog, Keys>]: Field<Catalog[Key]> }
  : never

type AnswerFields<Answers extends object> = string extends keyof Answers
  ? Readonly<Record<string, Field<JSONValue> | undefined>>
  : { [Key in keyof Answers]: Field<Extract<Answers[Key], JSONValue>> }

type ResearchRequestInput = Omit<ResearchRequest, "research"> & { research: object }
type DeepResearchRequestInput = Omit<DeepResearchRequest, "deepResearch"> & {
  deepResearch: object
}
type ValidSelectionValue<Selection> =
  true extends IsAny<Selection>
    ? never
    : Selection extends readonly string[]
      ? true extends IsAny<Selection[number]>
        ? never
        : unknown
      : never

type ResearchArguments = readonly [client: KyInstance, request: unknown]
type DeepResearchArguments = readonly [client: KyInstance, request: unknown]
type ResearchRequestArgument<Arguments extends ResearchArguments> =
  Arguments[1] extends ResearchRequestInput ? Arguments[1] : never
type DeepResearchRequestArgument<Arguments extends DeepResearchArguments> =
  Arguments[1] extends DeepResearchRequestInput ? Arguments[1] : never

type SelectionWithoutAny<Selection> =
  true extends IsAny<Selection>
    ? never
    : Selection extends readonly unknown[]
      ? {
          [Index in keyof Selection]: true extends IsAny<Selection[Index]>
            ? never
            : Selection[Index]
        }
      : never

type ResearchArgumentsWithoutAny<Arguments extends ResearchArguments> = readonly [
  client: Arguments[0],
  request: Omit<ResearchRequestArgument<Arguments>, "person" | "company"> & {
    person: SelectionWithoutAny<ResearchRequestArgument<Arguments>["person"]>
    company: SelectionWithoutAny<ResearchRequestArgument<Arguments>["company"]>
  },
]

type DeepResearchArgumentsWithoutAny<Arguments extends DeepResearchArguments> = readonly [
  client: Arguments[0],
  request: Omit<DeepResearchRequestArgument<Arguments>, "person" | "company"> & {
    person: SelectionWithoutAny<DeepResearchRequestArgument<Arguments>["person"]>
    company: SelectionWithoutAny<DeepResearchRequestArgument<Arguments>["company"]>
  },
]

type ValidResearchArguments<Arguments extends ResearchArguments> =
  true extends IsAny<Arguments[1]>
    ? never
    : [ResearchRequestArgument<Arguments>] extends [never]
      ? never
      : [ValidSelectionValue<ResearchRequestArgument<Arguments>["person"]>] extends [never]
        ? never
        : [ValidSelectionValue<ResearchRequestArgument<Arguments>["company"]>] extends [never]
          ? never
          : ValidQuestions<ResearchRequestArgument<Arguments>["research"]> extends never
            ? never
            : unknown

type ValidDeepResearchArguments<Arguments extends DeepResearchArguments> =
  true extends IsAny<Arguments[1]>
    ? never
    : [DeepResearchRequestArgument<Arguments>] extends [never]
      ? never
      : [ValidSelectionValue<DeepResearchRequestArgument<Arguments>["person"]>] extends [never]
        ? never
        : [ValidSelectionValue<DeepResearchRequestArgument<Arguments>["company"]>] extends [never]
          ? never
          : ValidQuestions<DeepResearchRequestArgument<Arguments>["deepResearch"]> extends never
            ? never
            : unknown

type ResearchData<Request extends ResearchRequestInput, Answers extends object> = {
  person: SelectedFields<ResearchCatalog["person"], Request["person"]>
  company: SelectedFields<ResearchCatalog["company"], Request["company"]>
} & AnswerFields<Answers>

type DeepResearchData<Request extends DeepResearchRequestInput, Answers extends object> = {
  person: SelectedFields<DeepResearchCatalog["person"], Request["person"]>
  company: SelectedFields<DeepResearchCatalog["company"], Request["company"]>
} & AnswerFields<Answers>

export function createResearch<const Arguments extends ResearchArguments>(
  ...arguments_: Arguments &
    ResearchArgumentsWithoutAny<Arguments> &
    ([ValidResearchArguments<NoInfer<Arguments>>] extends [never] ? never : unknown)
): Promise<
  SonarResponse<
    ResearchData<
      ResearchRequestArgument<Arguments>,
      AnswersOf<ResearchRequestArgument<Arguments>["research"]>
    >
  >
>
export async function createResearch(client: KyInstance, request: ResearchRequest) {
  const body = ResearchRequest.parse(request)
  const response = await client
    .post("/v1/research", {
      headers: { accept: "application/json", "content-type": "application/json" },
      json: body,
      throwHttpErrors: true,
    })
    .json<unknown>()
  return SonarResponse.refine((snapshot) => snapshotMatchesRequest(snapshot, body), {
    message: "Response leaves do not match the research request",
    path: ["data"],
  }).parse(response)
}

export function createDeepResearch<const Arguments extends DeepResearchArguments>(
  ...arguments_: Arguments &
    DeepResearchArgumentsWithoutAny<Arguments> &
    ([ValidDeepResearchArguments<NoInfer<Arguments>>] extends [never] ? never : unknown)
): Promise<
  SonarResponse<
    DeepResearchData<
      DeepResearchRequestArgument<Arguments>,
      AnswersOf<DeepResearchRequestArgument<Arguments>["deepResearch"]>
    >
  >
>
export async function createDeepResearch(client: KyInstance, request: DeepResearchRequest) {
  const body = DeepResearchRequest.parse(request)
  const response = await client
    .post("/v1/deepResearch", {
      headers: { accept: "application/json", "content-type": "application/json" },
      json: body,
      throwHttpErrors: true,
    })
    .json<unknown>()
  return SonarResponse.refine((snapshot) => snapshotMatchesRequest(snapshot, body), {
    message: "Response leaves do not match the deepResearch request",
    path: ["data"],
  }).parse(response)
}

type OptionalKeys<Value> = {
  [Key in keyof Value]-?: object extends Pick<Value, Key> ? Key : never
}[keyof Value]

type IsCallableOrConstructable<Value> = Value extends CallableFunction | NewableFunction
  ? true
  : false

type ValidAnswerValues<Answers extends object> =
  true extends IsUnion<Answers>
    ? never
    : true extends IsCallableOrConstructable<Answers>
      ? never
      : string extends keyof Answers
        ? never
        : [Exclude<keyof Answers, string>] extends [never]
          ? [OptionalKeys<Answers>] extends [never]
            ? ValidQuestions<{
                [Key in keyof Answers & string]: string
              }> extends never
              ? never
              : true extends IsAny<Answers[keyof Answers]>
                ? never
                : [Answers[keyof Answers]] extends [JSONValue]
                  ? Answers
                  : never
            : never
          : never

type RetrievedData<Answers extends object> = SonarData & AnswerFields<Answers>

export function retrieveSonar<const Answers extends object = never>(
  client: KyInstance,
  hash: string &
    ([Answers] extends [never]
      ? unknown
      : [Answers] extends [ValidAnswerValues<Answers>]
        ? unknown
        : never)
): Promise<[Answers] extends [never] ? SonarResponse : SonarResponse<RetrievedData<Answers>>>
export async function retrieveSonar(client: KyInstance, hash: string) {
  if (hash.length === 0 || hash === "." || hash === "..") {
    throw new TypeError("Sonar hash must be a non-empty path-safe value")
  }
  const response = await client
    .get(`/v1/${encodeURIComponent(hash)}`, {
      headers: { accept: "application/json" },
      throwHttpErrors: true,
    })
    .json<unknown>()
  return SonarResponse.parse(response)
}

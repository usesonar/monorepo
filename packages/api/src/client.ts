import ky from "ky"
import type { KyInstance, Options } from "ky"

import {
  DeepResearchRequest,
  SonarResponse,
  compileResearchRequest,
  snapshotMatchesRequest,
} from "./schemas.ts"
import type {
  DeepResearchCompanyInput,
  DeepResearchCompanyField,
  DeepResearchInput,
  DeepResearchPersonInput,
  DeepResearchPersonField,
  Field,
  JSONValue,
  ResearchCompanyInput,
  ResearchInput,
  ResearchOutput,
  ResearchPersonInput,
  ResearchPersonField,
  SonarData,
  ValidAnswerMap,
  ValidDeepResearchEntityInput,
  ValidResearchEntityInput,
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

type SelectedFields<Catalog extends Record<string, JSONValue>, Selection extends object> = {
  [
    Key in keyof Catalog as Key extends keyof Selection
      ? true extends Selection[Key]
        ? object extends Pick<Selection, Key>
          ? never
          : Key
        : never
      : never
  ]: Field<Catalog[Key]>
} & {
  [
    Key in keyof Catalog as Key extends keyof Selection
      ? true extends Selection[Key]
        ? object extends Pick<Selection, Key>
          ? Key
          : never
        : never
      : never
  ]?: Field<Catalog[Key]>
}

type ResearchAnswerFields<Questions extends object> = string extends keyof Questions
  ? Readonly<Record<string, Field<JSONValue> | undefined>>
  : { [Key in keyof Questions]: Field<ResearchOutput<Questions[Key]>> }

type DeepResearchAnswerFields<Questions extends object> = string extends keyof Questions
  ? Readonly<Record<string, Field<string> | undefined>>
  : { [Key in keyof Questions]: Field<string> }

type RetrievedAnswerFields<Answers extends object> = string extends keyof Answers
  ? Readonly<Record<string, Field<JSONValue> | undefined>>
  : { [Key in keyof Answers]: Field<Extract<Answers[Key], JSONValue>> }

type QuestionsOf<
  Entity extends object,
  Tier extends "research" | "deepResearch",
> = Tier extends keyof Entity ? Extract<NonNullable<Entity[Tier]>, object> : Record<never, never>

type ResearchNamespace<Entity extends object> = keyof QuestionsOf<Entity, "research"> extends never
  ? object
  : object extends Pick<Entity, Extract<"research", keyof Entity>>
    ? { research?: ResearchAnswerFields<QuestionsOf<Entity, "research">> }
    : { research: ResearchAnswerFields<QuestionsOf<Entity, "research">> }

type DeepResearchNamespace<Entity extends object> = keyof QuestionsOf<
  Entity,
  "deepResearch"
> extends never
  ? object
  : object extends Pick<Entity, Extract<"deepResearch", keyof Entity>>
    ? { deepResearch?: DeepResearchAnswerFields<QuestionsOf<Entity, "deepResearch">> }
    : { deepResearch: DeepResearchAnswerFields<QuestionsOf<Entity, "deepResearch">> }

export type ResearchData<
  Person extends ResearchPersonInput,
  Company extends ResearchCompanyInput,
> = {
  person: SelectedFields<ResearchCatalog["person"], Person> & ResearchNamespace<Person>
  company: SelectedFields<ResearchCatalog["company"], Company> & ResearchNamespace<Company>
}

export type DeepResearchData<
  Person extends DeepResearchPersonInput,
  Company extends DeepResearchCompanyInput,
> = {
  person: SelectedFields<DeepResearchCatalog["person"], Person> & DeepResearchNamespace<Person>
  company: SelectedFields<DeepResearchCatalog["company"], Company> & DeepResearchNamespace<Company>
}

export function createResearch<
  const Person extends ResearchPersonInput,
  const Company extends ResearchCompanyInput,
>(
  client: KyInstance,
  request: ResearchInput<Person, Company> &
    (Person extends ValidResearchEntityInput<Person> ? unknown : never) &
    (Company extends ValidResearchEntityInput<Company> ? unknown : never)
): Promise<SonarResponse<ResearchData<Person, Company>>>
export async function createResearch(client: KyInstance, request: ResearchInput) {
  // SAFETY: The public overload already proves this broad implementation input is a valid authored
  // research request; the compiler performs the matching runtime validation before transport.
  const body = compileResearchRequest(request as never)
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

export function createDeepResearch<
  const Person extends DeepResearchPersonInput,
  const Company extends DeepResearchCompanyInput,
>(
  client: KyInstance,
  request: DeepResearchInput<Person, Company> &
    (Person extends ValidDeepResearchEntityInput<Person> ? unknown : never) &
    (Company extends ValidDeepResearchEntityInput<Company> ? unknown : never)
): Promise<SonarResponse<DeepResearchData<Person, Company>>>
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

type IsCallableOrConstructable<Value> = Value extends CallableFunction | NewableFunction
  ? true
  : false

type IsUnion<Value, Whole = Value> = Value extends unknown
  ? [Whole] extends [Value]
    ? false
    : true
  : never

export type RetrievedAnswerEntity = {
  research?: object
  deepResearch?: object
}

export type RetrievedAnswers = {
  person?: RetrievedAnswerEntity
  company?: RetrievedAnswerEntity
}

type ValidRetrievedEntity<Entity extends RetrievedAnswerEntity> =
  true extends IsUnion<Entity>
    ? never
    : true extends IsCallableOrConstructable<Entity>
      ? never
      : [Exclude<keyof Entity, "research" | "deepResearch">] extends [never]
        ? NonNullable<Entity["research"]> extends ValidAnswerMap<NonNullable<Entity["research"]>>
          ? NonNullable<Entity["deepResearch"]> extends ValidAnswerMap<
              NonNullable<Entity["deepResearch"]>
            >
            ? Entity
            : never
          : never
        : never

type ValidRetrievedAnswers<Answers extends RetrievedAnswers> =
  true extends IsUnion<Answers>
    ? never
    : true extends IsCallableOrConstructable<Answers>
      ? never
      : [Exclude<keyof Answers, "person" | "company">] extends [never]
        ? Answers extends {
            person?: infer Person extends RetrievedAnswerEntity
            company?: infer Company extends RetrievedAnswerEntity
          }
          ? Answers & {
              person?: ValidRetrievedEntity<Person>
              company?: ValidRetrievedEntity<Company>
            }
          : never
        : never

type RetrievedNamespace<
  Entity extends RetrievedAnswerEntity,
  Tier extends "research" | "deepResearch",
> = Tier extends keyof Entity
  ? { [Key in Tier]: RetrievedAnswerFields<Extract<NonNullable<Entity[Tier]>, object>> }
  : object

type RetrievedEntityData<Catalog extends object, Entity extends RetrievedAnswerEntity> = Catalog &
  RetrievedNamespace<Entity, "research"> &
  RetrievedNamespace<Entity, "deepResearch">

type RetrievedData<Answers extends RetrievedAnswers> = {
  person: RetrievedEntityData<SonarData["person"], NonNullable<Answers["person"]>>
  company: RetrievedEntityData<SonarData["company"], NonNullable<Answers["company"]>>
}

export function retrieveSonar<const Answers extends RetrievedAnswers = never>(
  client: KyInstance,
  hash: string &
    ([Answers] extends [never]
      ? unknown
      : [Answers] extends [ValidRetrievedAnswers<Answers>]
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

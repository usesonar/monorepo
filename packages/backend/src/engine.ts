import { createHmac } from "node:crypto"

import {
  DeepResearchRequest as APIDeepResearchRequest,
  Field as APIField,
  JSONValue as APIJSONValue,
  ResearchRequest as APIResearchRequest,
  SonarSnapshot as APISonarSnapshot,
} from "@usesonar/api"
import type {
  DeepResearchRequest,
  Field,
  JSONValue,
  ResearchJSONSchema,
  ResearchRequest,
  SonarSeed,
  SonarSnapshot,
} from "@usesonar/api"

import { ProviderFailure } from "./providers.ts"
import type { CompanySiteField, ProviderAnswer, ProviderRunner } from "./providers.ts"

export type TestTenant = {
  readonly key: string
  readonly tenantId: string
  readonly capability: "publishable" | "secret"
  readonly allowedOrigins?: readonly string[]
}

export type FakeScenario = {
  readonly autoSettle?: boolean
  readonly now?: string
  readonly fields?: Readonly<Record<string, FakeFieldInput>>
}

export type FakeFieldInput = {
  readonly confidence?: number
  readonly reason?: string
  readonly resolvedAt?: string
  readonly sources?: readonly string[]
  readonly status: string
  readonly value?: JSONValue
}

export type EngineOptions = {
  readonly providerRunner?: ProviderRunner
  readonly serverSecret: string
  readonly tenants: readonly TestTenant[]
  readonly scenario?: FakeScenario
}

type ParsedRequest = ResearchRequest | DeepResearchRequest
type Route = "/v1/research" | "/v1/deepResearch"
type TerminalField = Exclude<Field, { status: "pending" }>
type CustomNamespaces = {
  readonly research?: Readonly<Record<string, Field>>
  readonly deepResearch?: Readonly<Record<string, Field<string>>>
}
type BackendSnapshot = {
  readonly status: SonarSnapshot["status"]
  readonly data: {
    readonly person: SonarSnapshot["data"]["person"] & CustomNamespaces
    readonly company: SonarSnapshot["data"]["company"] & CustomNamespaces
  }
}
type CacheScope = "builtIn" | "custom"
type IdentityStatus = "pending" | "resolved" | "notFound"

type WireEvent = {
  readonly id: string
  readonly event: "snapshot" | "field" | "complete"
  readonly data: JSONValue
}

type Entity = "person" | "company"
type Tier = "research" | "deepResearch"

const tierOf = (request: ParsedRequest): Tier =>
  "deepResearch" in request.person ||
  "deepResearch" in request.company ||
  "phone" in request.person ||
  "legalName" in request.company
    ? "deepResearch"
    : "research"

const questionsOf = (
  request: ParsedRequest,
  entity: Entity
): Readonly<Record<string, string | ResearchJSONSchema>> => {
  const tier = tierOf(request)
  if (tier === "research") {
    // SAFETY: tierOf identifies ResearchRequest from its route-exclusive entity keys.
    const researchRequest = request as ResearchRequest
    return researchRequest[entity].research ?? {}
  }
  // SAFETY: tierOf identifies DeepResearchRequest from its route-exclusive entity keys.
  const deepResearchRequest = request as DeepResearchRequest
  return deepResearchRequest[entity].deepResearch ?? {}
}

const builtInsOf = (request: ParsedRequest, entity: Entity) => {
  const tier = tierOf(request)
  return Object.keys(request[entity]).filter((key) => key !== tier)
}

type CacheEntry = {
  readonly field: TerminalField
  readonly storedAt: number
  negativeExpiresAt?: number
}

type Run = {
  readonly hash: string
  readonly tenantId: string
  readonly route: Route
  readonly request: ParsedRequest
  readonly events: WireEvent[]
  readonly identity: { company: IdentityStatus; person: IdentityStatus }
  readonly startedBatches: Set<string>
  readonly startedPaths: Set<string>
  readonly subscribers: Set<Subscription>
  snapshot: BackendSnapshot
  complete: boolean
}

type Subscription = {
  readonly response: Response
  readonly run: Run
  controller?: ReadableStreamDefaultController<Uint8Array>
  finalized: boolean
}

type SubscriptionReference = { subscription?: Subscription }

export type BackendInspection = {
  readonly cachedFields: Readonly<Record<string, TerminalField>>
  readonly emittedEvents: readonly WireEvent[]
  readonly networkCalls: number
  readonly openScopes: number
  readonly providerBatches: readonly {
    readonly entity: Entity
    readonly paths: readonly string[]
    readonly provider: "firecrawl" | "parallel" | "sixtyFour"
    readonly tier: "builtIn" | Tier
  }[]
  readonly providerCalls: Readonly<Record<string, number>>
  readonly runsCancelled: number
  readonly runsStarted: number
  readonly subscriptionFinalizers: number
}

const pending: Field = { status: "pending" }
const fiveMinutes = 5 * 60 * 1000
const consumerDomains = new Set([
  "aol.com",
  "gmail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
])
const isCompanySiteField = (value: string): value is CompanySiteField =>
  value === "name" || value === "logo" || value === "colors" || value === "description"

const clone = <Value>(value: Value): Value => structuredClone(value)

const ownValue = <Value>(
  record: Readonly<Record<string, Value>> | undefined,
  key: string
): Value | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

const compareCodeUnits = (left: string, right: string) => {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

const isJSONObject = (value: JSONValue): value is { readonly [key: string]: JSONValue } =>
  value !== null && !Array.isArray(value) && Object(value) === value

const normalizedJSON = (value: JSONValue): JSONValue => {
  if (Array.isArray(value)) {
    return value.map(normalizedJSON)
  }
  if (isJSONObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, nested]) => [key, normalizedJSON(nested)])
    )
  }
  return value
}

const normalizedURL = (value: string, kind: "linkedin" | "x") => {
  const url = new URL(value.trim())
  url.hostname = url.hostname.toLowerCase()
  url.hash = ""
  url.search = ""
  let path = url.pathname.replace(/\/+$/u, "")
  if (kind === "x") {
    path = path.replace(/^\/@/u, "/").toLowerCase()
  }
  return `${url.protocol}//${url.host}${path || "/"}`
}

const normalizedName = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase("en-US")
    .replaceAll(/(?<boundary>^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-US"))

const normalizedSeed = (seed: SonarSeed) => {
  const entries: [string, JSONValue][] = []
  if (seed.context !== undefined) {
    entries.push(["context", normalizedJSON(seed.context)])
  }
  if (seed.domain !== undefined) {
    entries.push(["domain", seed.domain.trim().toLowerCase()])
  }
  if (seed.email !== undefined) {
    entries.push(["email", seed.email.trim().toLowerCase()])
  }
  if (seed.fullName !== undefined) {
    entries.push(["fullName", normalizedName(seed.fullName)])
  }
  if (seed.linkedinURL !== undefined) {
    entries.push(["linkedinURL", normalizedURL(seed.linkedinURL, "linkedin")])
  }
  if (seed.xURL !== undefined) {
    entries.push(["xURL", normalizedURL(seed.xURL, "x")])
  }
  return Object.fromEntries(entries.toSorted(([left], [right]) => compareCodeUnits(left, right)))
}

const configOf = (request: ParsedRequest) => {
  const configEntries: [string, JSONValue][] = [
    ["company", normalizedJSON(request.company)],
    ["person", normalizedJSON(request.person)],
    ["ttl", request.ttl],
  ]
  return Object.fromEntries(
    configEntries.toSorted(([left], [right]) => compareCodeUnits(left, right))
  )
}

const ttlMilliseconds = (ttl: string) => {
  const match = /^(?<amount>\d+)(?<unit>ms|s|m|h|d|w)$/u.exec(ttl)
  const amount = Number(match?.groups?.amount)
  switch (match?.groups?.unit) {
    case "ms": {
      return amount
    }
    case "s": {
      return amount * 1000
    }
    case "m": {
      return amount * 60_000
    }
    case "h": {
      return amount * 3_600_000
    }
    case "d": {
      return amount * 86_400_000
    }
    case "w": {
      return amount * 604_800_000
    }
    default: {
      return 0
    }
  }
}

const pathsOf = (request: ParsedRequest) => {
  const tier = tierOf(request)
  return (["person", "company"] as const).flatMap((entity) => [
    ...builtInsOf(request, entity).map((field) => `${entity}.${field}`),
    ...Object.keys(questionsOf(request, entity)).map((key) => `${entity}.${tier}.${key}`),
  ])
}

const isBuiltIn = (path: string) => path.split(".").length === 2

const fieldAt = (snapshot: BackendSnapshot, path: string): Field | undefined => {
  const [slot, namespaceOrKey, customKey, extra] = path.split(".")
  if (
    extra !== undefined ||
    namespaceOrKey === undefined ||
    (slot !== "person" && slot !== "company")
  ) {
    return undefined
  }
  const entity = snapshot.data[slot]
  if (customKey === undefined) {
    const candidate = Object.entries(entity).find(([key]) => key === namespaceOrKey)?.[1]
    const parsed = APIField.safeParse(candidate)
    return parsed.success ? parsed.data : undefined
  }
  if (namespaceOrKey !== "research" && namespaceOrKey !== "deepResearch") {
    return undefined
  }
  const namespace = namespaceOrKey === "research" ? entity.research : entity.deepResearch
  const custom = namespace?.[customKey]
  const parsed = APIField.safeParse(custom)
  return parsed.success ? parsed.data : undefined
}

const withField = (
  snapshot: BackendSnapshot,
  path: string,
  field: TerminalField
): BackendSnapshot => {
  const [slot, namespaceOrKey, customKey, extra] = path.split(".")
  if (
    extra !== undefined ||
    namespaceOrKey === undefined ||
    (slot !== "person" && slot !== "company")
  ) {
    return snapshot
  }
  if (customKey === undefined) {
    return {
      ...snapshot,
      data: {
        ...snapshot.data,
        [slot]: { ...snapshot.data[slot], [namespaceOrKey]: field },
      },
    }
  }
  if (namespaceOrKey !== "research" && namespaceOrKey !== "deepResearch") {
    return snapshot
  }
  return {
    ...snapshot,
    data: {
      ...snapshot.data,
      [slot]: {
        ...snapshot.data[slot],
        [namespaceOrKey]: {
          ...(namespaceOrKey === "research"
            ? snapshot.data[slot].research
            : snapshot.data[slot].deepResearch),
          [customKey]: field,
        },
      },
    },
  }
}

const initialSnapshot = (request: ParsedRequest): BackendSnapshot => {
  const tier = tierOf(request)
  const entitySnapshot = (entity: Entity) => {
    const questions = questionsOf(request, entity)
    const builtIns = Object.fromEntries(builtInsOf(request, entity).map((path) => [path, pending]))
    if (Object.keys(questions).length === 0) {
      return builtIns
    }
    const custom = Object.fromEntries(Object.keys(questions).map((key) => [key, pending]))
    return tier === "research"
      ? { ...builtIns, research: custom }
      : { ...builtIns, deepResearch: custom }
  }
  // oxlint-disable-next-line sort-keys -- The wire contract requires person before company.
  const data = {
    person: entitySnapshot("person"),
    company: entitySnapshot("company"),
  }
  return { data, status: "pending" }
}

const eventPayload = (event: WireEvent) =>
  `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`

const jsonResponse = (body: JSONValue, status = 200) =>
  Response.json(body, {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const safeError = (status: number, message: string) => jsonResponse({ error: message }, status)

const defaultValue = (path: string): JSONValue => {
  if (path === "person.linkedin") {
    return "https://linkedin.com/in/test-person"
  }
  if (path === "person.x") {
    return "https://x.com/test-person"
  }
  if (path === "person.github") {
    return "https://github.com/test-person"
  }
  if (path === "company.logo") {
    return "https://example.test/logo.png"
  }
  if (path === "company.domain") {
    return "example.com"
  }
  if (path === "company.colors" || path === "company.location" || path === "company.funding") {
    return {}
  }
  if (isBuiltIn(path)) {
    return `resolved ${path}`
  }
  if (path.includes(".deepResearch.")) {
    return `resolved ${path}`
  }
  return true
}

const emailDomain = (seed: SonarSeed) => seed.email?.split("@").at(-1)?.trim().toLowerCase()

const isConsumerEmail = (seed: SonarSeed) => {
  const domain = emailDomain(seed)
  return domain === undefined || consumerDomains.has(domain)
}

const companyDomainFromSeed = (seed: SonarSeed) => {
  const explicit = seed.domain?.trim().toLowerCase()
  if (explicit !== undefined) {
    return explicit
  }
  const fromEmail = emailDomain(seed)
  return fromEmail !== undefined && !consumerDomains.has(fromEmail) ? fromEmail : undefined
}

const companyDomainOf = (run: Run) => {
  const fromSeed = companyDomainFromSeed(run.request.seed)
  if (fromSeed !== undefined) {
    return fromSeed
  }
  const domainField = fieldAt(run.snapshot, "company.domain")
  const value = domainField?.status === "resolved" ? domainField.value : undefined
  /* oxlint-disable anti-slop/no-runtime-typeof -- The public snapshot boundary validates company.domain as a string before this identity-gated branch. */
  const domain = typeof value === "string" ? value.trim().toLowerCase() : undefined
  /* oxlint-enable anti-slop/no-runtime-typeof */
  return domain !== undefined && domain.length > 0 ? domain : undefined
}

const providerIdentity = (run: Run, entity: Entity) => {
  const identity = normalizedSeed(run.request.seed)
  const domain = entity === "company" ? companyDomainOf(run) : undefined
  return domain === undefined ? identity : { ...identity, domain }
}

const cacheIdentity = (run: Run, path: string, scope: CacheScope) => {
  const subject = JSON.stringify(normalizedSeed(run.request.seed))
  if (scope === "builtIn") {
    return `builtIn:${path}:${subject}`
  }
  const [entity, tier, key] = path.split(".")
  if ((entity !== "person" && entity !== "company") || key === undefined) {
    return `custom:${run.tenantId}:${run.route}:${path}:${subject}`
  }
  const questions = questionsOf(run.request, entity)
  return `custom:${run.tenantId}:${run.route}:${entity}:${tier}:${key}:${JSON.stringify(ownValue(questions, key) ?? "")}:${subject}`
}

const snapshotResponse = (run: Run) => jsonResponse({ hash: run.hash, ...clone(run.snapshot) })

export class BackendEngine {
  readonly #serverSecret: string
  readonly #tenants: Map<string, TestTenant>
  readonly #scenario: FakeScenario
  readonly #runs = new Map<string, Run>()
  readonly #cache = new Map<string, CacheEntry>()
  readonly #cachedFields: Record<string, TerminalField> = {}
  readonly #providerCalls = new Map<string, number>()
  readonly #providerBatches: BackendInspection["providerBatches"][number][] = []
  readonly #providerRunner: ProviderRunner | undefined
  readonly #providerControllers = new Set<AbortController>()
  readonly #responseSubscriptions = new Map<Response, Subscription>()
  readonly #readers = new Map<Response, ReadableStreamDefaultReader<Uint8Array>>()
  #now: number
  #runsStarted = 0
  #runsCancelled = 0
  #subscriptionFinalizers = 0
  #openScopes = 0
  #closed = false

  constructor(options: EngineOptions) {
    this.#serverSecret = options.serverSecret
    this.#providerRunner = options.providerRunner
    this.#tenants = new Map(options.tenants.map((tenant) => [tenant.key, tenant]))
    this.#scenario = options.scenario ?? {}
    this.#now = Date.parse(this.#scenario.now ?? "2026-08-26T12:00:00.000Z")
  }

  acquireScope() {
    this.#openScopes += 1
  }

  releaseScope() {
    this.#openScopes -= 1
  }

  inspect(): BackendInspection {
    return {
      cachedFields: clone(this.#cachedFields),
      emittedEvents: [...this.#runs.values()].flatMap((run) => clone(run.events)),
      networkCalls: 0,
      openScopes: this.#openScopes,
      providerBatches: clone(this.#providerBatches),
      providerCalls: Object.fromEntries(this.#providerCalls),
      runsCancelled: this.#runsCancelled,
      runsStarted: this.#runsStarted,
      subscriptionFinalizers: this.#subscriptionFinalizers,
    }
  }

  async handle(request: Request): Promise<Response> {
    if (this.#closed) {
      return safeError(503, "Backend is closed")
    }
    const url = new URL(request.url)
    const route = url.pathname
    if (request.method === "POST" && (route === "/v1/research" || route === "/v1/deepResearch")) {
      return await this.#post(request, route)
    }
    if (request.method === "GET" && /^\/v1\/[^/]+$/u.test(route)) {
      return this.#get(request, route.slice("/v1/".length))
    }
    return safeError(404, "Not found")
  }

  async #post(request: Request, route: Route): Promise<Response> {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    if (contentType !== "application/json") {
      return safeError(415, "Unsupported media type")
    }
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return safeError(400, "Invalid request")
    }
    const parsed =
      route === "/v1/research"
        ? APIResearchRequest.safeParse(body)
        : APIDeepResearchRequest.safeParse(body)
    if (!parsed.success) {
      return safeError(400, "Invalid request")
    }
    const tenant = this.#authenticate(request)
    if (tenant instanceof Response) {
      return tenant
    }
    const accept = request.headers.get("accept")?.split(",", 1)[0]?.trim() ?? "application/json"
    if (accept !== "application/json" && accept !== "text/event-stream") {
      return safeError(406, "Unsupported representation")
    }

    const run = this.#run(tenant, route, parsed.data)
    if (accept === "text/event-stream") {
      return this.#stream(run, request.headers.get("last-event-id"))
    }
    return snapshotResponse(run)
  }

  #get(request: Request, hash: string) {
    const tenant = this.#authenticate(request)
    if (tenant instanceof Response) {
      return tenant
    }
    const run = this.#runs.get(hash)
    return run?.tenantId === tenant.tenantId ? snapshotResponse(run) : safeError(404, "Not found")
  }

  #authenticate(request: Request): TestTenant | Response {
    const authorization = request.headers.get("authorization")
    const key = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined
    const tenant = key === undefined ? undefined : this.#tenants.get(key)
    if (!tenant) {
      return safeError(401, "Unauthorized")
    }
    const origin = request.headers.get("origin")
    const allowedOrigins = tenant.allowedOrigins ?? []
    if (
      tenant.capability === "publishable" &&
      allowedOrigins.length > 0 &&
      (origin === null || !allowedOrigins.includes(origin))
    ) {
      return safeError(403, "Origin forbidden")
    }
    return tenant
  }

  #hash(tenantId: string, route: Route, request: ParsedRequest) {
    return createHmac("sha256", this.#serverSecret)
      .update(
        `${tenantId}${route}${JSON.stringify(normalizedSeed(request.seed))}${JSON.stringify(configOf(request))}`
      )
      .digest("hex")
  }

  #run(tenant: TestTenant, route: Route, request: ParsedRequest) {
    const hash = this.#hash(tenant.tenantId, route, request)
    const existing = this.#runs.get(hash)
    if (existing) {
      return existing
    }

    const snapshot = initialSnapshot(request)
    const run: Run = {
      complete: false,
      events: [{ data: clone(snapshot), event: "snapshot", id: "0" }],
      hash,
      identity: {
        company: companyDomainFromSeed(request.seed) === undefined ? "pending" : "resolved",
        person: "resolved",
      },
      request,
      route,
      snapshot,
      startedBatches: new Set(),
      startedPaths: new Set(),
      subscribers: new Set(),
      tenantId: tenant.tenantId,
    }
    this.#runs.set(hash, run)
    this.#runsStarted += 1

    const cachedFields: [string, TerminalField][] = []
    for (const path of pathsOf(request)) {
      const cached = this.#readCache(run, path)
      if (cached) {
        this.#settleRun(run, path, cached, false)
        cachedFields.push([path, cached])
      }
    }
    for (const [path, cached] of cachedFields) {
      this.#updateIdentityGate(run, path, cached, false)
    }
    this.#applyImmediateSkips(run)
    this.#applyUnavailableCustomSkips(run)
    this.#startReadyPaths(run)
    if (this.#scenario.autoSettle ?? false) {
      this.#settleAllRun(run)
    } else {
      this.#completeIfTerminal(run)
    }
    return run
  }

  #applyImmediateSkips(run: Run) {
    if (fieldAt(run.snapshot, "person.phone")?.status !== "pending") {
      return
    }
    if (isConsumerEmail(run.request.seed)) {
      if (!this.#providerCalls.has("person.phone")) {
        this.#providerCalls.set("person.phone", 0)
      }
      this.#settleRun(run, "person.phone", { reason: "consumerEmail", status: "skipped" }, false)
    }
  }

  #applyUnavailableCustomSkips(run: Run) {
    const tier = tierOf(run.request)
    for (const entity of ["person", "company"] as const) {
      const identityPath = entity === "person" ? "person.linkedin" : "company.domain"
      if (run.identity[entity] !== "pending" || fieldAt(run.snapshot, identityPath) !== undefined) {
        continue
      }
      const reason = entity === "person" ? "noPersonSeed" : "noCompanySeed"
      for (const path of pathsOf(run.request)) {
        if (
          path.startsWith(`${entity}.${tier}.`) &&
          fieldAt(run.snapshot, path)?.status === "pending"
        ) {
          this.#settleRun(run, path, { reason, status: "skipped" }, false)
        }
      }
    }
  }

  #startReadyPaths(run: Run) {
    for (const path of pathsOf(run.request)) {
      if (fieldAt(run.snapshot, path)?.status !== "pending") {
        continue
      }
      const ready =
        path === "company.domain" ||
        path === "person.linkedin" ||
        (path.startsWith("company.") && run.identity.company === "resolved") ||
        (path.startsWith("person.") && run.identity.person === "resolved")
      if (ready) {
        if (isBuiltIn(path)) {
          const companyField = path.startsWith("company.") ? path.slice("company.".length) : ""
          if (this.#providerRunner?.companySite !== undefined && isCompanySiteField(companyField)) {
            this.#startCompanySiteBatch(run)
          } else {
            this.#startPath(run, path)
          }
        } else {
          const [entity] = path.split(".")
          if (entity === "person" || entity === "company") {
            this.#startBatch(run, entity)
          }
        }
      }
    }
  }

  #startCompanySiteBatch(run: Run) {
    const batchKey = "builtIn:companySite"
    if (run.startedBatches.has(batchKey)) {
      return
    }
    const paths = pathsOf(run.request).filter((path) => {
      const field = path.startsWith("company.") ? path.slice("company.".length) : ""
      return isCompanySiteField(field) && fieldAt(run.snapshot, path)?.status === "pending"
    })
    if (paths.length === 0) {
      return
    }
    const domain = companyDomainOf(run)
    if (domain === undefined || domain.length === 0) {
      return
    }
    run.startedBatches.add(batchKey)
    for (const path of paths) {
      run.startedPaths.add(path)
    }
    this.#providerCalls.set(
      "firecrawl.company",
      (this.#providerCalls.get("firecrawl.company") ?? 0) + 1
    )
    this.#providerBatches.push({ entity: "company", paths, provider: "firecrawl", tier: "builtIn" })
    this.#executeCompanySiteBatch(run, domain, paths)
  }

  #executeCompanySiteBatch(run: Run, domain: string, paths: readonly string[]) {
    const companySite = this.#providerRunner?.companySite
    if (companySite === undefined) {
      return
    }
    const controller = new AbortController()
    this.#providerControllers.add(controller)
    const fields = paths.flatMap((path) => {
      const field = path.slice("company.".length)
      return isCompanySiteField(field) ? [field] : []
    })
    void this.#settleBatchPromise(
      run,
      paths,
      controller,
      companySite({ domain, fields }, controller.signal)
    )
  }

  #startBatch(run: Run, entity: Entity) {
    const tier = tierOf(run.request)
    const batchKey = `${tier}:${entity}`
    if (run.startedBatches.has(batchKey)) {
      return
    }
    const paths = pathsOf(run.request).filter(
      (path) =>
        path.startsWith(`${entity}.${tier}.`) && fieldAt(run.snapshot, path)?.status === "pending"
    )
    if (paths.length === 0) {
      return
    }
    run.startedBatches.add(batchKey)
    for (const path of paths) {
      run.startedPaths.add(path)
    }
    const provider = tier === "research" ? "parallel" : "sixtyFour"
    const callKey = `${provider}.${entity}`
    this.#providerCalls.set(callKey, (this.#providerCalls.get(callKey) ?? 0) + 1)
    this.#providerBatches.push({ entity, paths, provider, tier })
    this.#executeBatch(run, entity, tier, paths)
  }

  #executeBatch(run: Run, entity: Entity, tier: Tier, paths: readonly string[]) {
    if (this.#providerRunner === undefined) {
      return
    }
    const questions = questionsOf(run.request, entity)
    const controller = new AbortController()
    this.#providerControllers.add(controller)
    const requestId = `${run.hash}:${entity}:${tier}`
    const promise =
      tier === "research"
        ? this.#providerRunner.research(
            {
              entity,
              identity: providerIdentity(run, entity),
              questions,
              requestId,
            },
            controller.signal
          )
        : this.#providerRunner.deepResearch(
            {
              entity,
              identity: providerIdentity(run, entity),
              // SAFETY: DeepResearchRequest is the only source of deepResearch question maps.
              questions: questions as Readonly<Record<string, string>>,
              requestId,
            },
            controller.signal
          )
    void this.#settleBatchPromise(run, paths, controller, promise)
  }

  async #settleBatchPromise(
    run: Run,
    paths: readonly string[],
    controller: AbortController,
    promise: Promise<Readonly<Record<string, ProviderAnswer>>>
  ) {
    try {
      const answers = await promise
      if (controller.signal.aborted) {
        return
      }
      for (const path of paths) {
        const key = path.split(".").at(-1)
        const answer = key === undefined ? undefined : ownValue(answers, key)
        this.#settleProviderAnswer(run, path, answer)
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }
      const reason =
        error instanceof ProviderFailure && error.kind === "timeout" ? "timeout" : "providerEmpty"
      for (const path of paths) {
        this.#settleRun(run, path, { reason, status: "notFound" }, true)
      }
    } finally {
      this.#providerControllers.delete(controller)
    }
  }

  #settleProviderAnswer(run: Run, path: string, answer: ProviderAnswer | undefined) {
    if (answer?.status !== "resolved") {
      this.#settleRun(run, path, { reason: "providerEmpty", status: "notFound" }, true)
      return
    }
    this.#settleRun(
      run,
      path,
      {
        confidence: answer.confidence,
        resolvedAt: new Date(this.#now).toISOString(),
        sources: [...answer.sources],
        status: "resolved",
        value: answer.value,
      },
      true
    )
  }

  #startPath(run: Run, path: string) {
    if (!run.startedPaths.has(path)) {
      run.startedPaths.add(path)
      const calls = (this.#providerCalls.get(path) ?? 0) + 1
      this.#providerCalls.set(path, calls)
    }
  }

  #readCache(run: Run, path: string) {
    const scope = isBuiltIn(path) ? "builtIn" : "custom"
    const entry =
      this.#cache.get(`${scope}:${path}:*`) ?? this.#cache.get(cacheIdentity(run, path, scope))
    if (!entry) {
      return
    }
    if (entry.negativeExpiresAt !== undefined && this.#now >= entry.negativeExpiresAt) {
      return
    }
    if (
      entry.field.status === "resolved" &&
      this.#now - Date.parse(entry.field.resolvedAt) >= ttlMilliseconds(run.request.ttl)
    ) {
      return
    }
    return clone(entry.field)
  }

  #writeCache(run: Run, path: string, field: TerminalField) {
    if (field.status === "skipped") {
      return
    }
    const scope = isBuiltIn(path) ? "builtIn" : "custom"
    const negativeExpiresAt =
      field.status === "notFound"
        ? this.#now + Math.min(ttlMilliseconds(run.request.ttl), fiveMinutes)
        : undefined
    const entry: CacheEntry = {
      field: clone(field),
      storedAt: this.#now,
    }
    if (negativeExpiresAt !== undefined) {
      entry.negativeExpiresAt = negativeExpiresAt
    }
    this.#cache.set(cacheIdentity(run, path, scope), entry)
    this.#cachedFields[path] = clone(field)
  }

  #terminalField(path: string, input?: FakeFieldInput): TerminalField {
    const source = input ?? ownValue(this.#scenario.fields, path)
    const candidate =
      source?.status === "resolved"
        ? {
            confidence: 1,
            resolvedAt: new Date(this.#now).toISOString(),
            sources: ["https://example.test"],
            value: defaultValue(path),
            ...source,
          }
        : (source ?? {
            confidence: 1,
            resolvedAt: new Date(this.#now).toISOString(),
            sources: ["https://example.test"],
            status: "resolved",
            value: defaultValue(path),
          })
    const parsed = APIField.safeParse(candidate)
    if (!parsed.success || parsed.data.status === "pending") {
      throw new TypeError(`Invalid terminal field for ${path}`)
    }
    const fieldSnapshot = withField(
      { data: { company: {}, person: {} }, status: "pending" },
      path,
      parsed.data
    )
    if (!APISonarSnapshot.safeParse(fieldSnapshot).success) {
      return { reason: "providerEmpty", status: "notFound" }
    }
    return parsed.data
  }

  #settleRun(run: Run, path: string, field: TerminalField, writeCache: boolean) {
    if (fieldAt(run.snapshot, path)?.status !== "pending") {
      return
    }
    run.snapshot = withField(run.snapshot, path, field)
    const data = { path, ...clone(field) }
    this.#append(run, { data, event: "field", id: String(run.events.length) })
    if (writeCache) {
      this.#writeCache(run, path, field)
    }
    this.#completeIfTerminal(run)
  }

  #updateIdentityGate(run: Run, path: string, field: TerminalField, startDependents = true) {
    if (path === "person.linkedin") {
      if (field.status === "resolved" && startDependents) {
        this.#startReadyPaths(run)
      }
      return
    }
    if (path !== "company.domain") {
      return
    }
    if (field.status === "resolved") {
      run.identity.company = "resolved"
      if (startDependents) {
        this.#startReadyPaths(run)
      }
      return
    }
    if (companyDomainFromSeed(run.request.seed) !== undefined) {
      return
    }
    run.identity.company = "notFound"
    for (const pendingPath of pathsOf(run.request)) {
      if (
        pendingPath.startsWith("company.") &&
        fieldAt(run.snapshot, pendingPath)?.status === "pending"
      ) {
        this.#settleRun(run, pendingPath, { reason: "identityFailed", status: "notFound" }, false)
      }
    }
  }

  #completeIfTerminal(run: Run) {
    if (
      run.complete ||
      pathsOf(run.request).some((path) => fieldAt(run.snapshot, path)?.status === "pending")
    ) {
      return
    }
    run.complete = true
    run.snapshot = { ...run.snapshot, status: "complete" }
    this.#append(run, {
      data: { hash: run.hash },
      event: "complete",
      id: String(run.events.length),
    })
  }

  #append(run: Run, event: WireEvent) {
    run.events.push(event)
    const payload = new TextEncoder().encode(eventPayload(event))
    for (const subscription of run.subscribers) {
      subscription.controller?.enqueue(payload)
    }
    if (event.event === "complete") {
      for (const subscription of run.subscribers) {
        subscription.controller?.close()
        this.#finalizeSubscription(subscription)
      }
    }
  }

  #stream(run: Run, lastEventId: string | null) {
    const last = lastEventId === null ? -1 : Number(lastEventId)
    const start = Number.isInteger(last) && last >= 0 ? last + 1 : 0
    const reference: SubscriptionReference = {}
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      cancel: () => {
        if (reference.subscription) {
          this.#finalizeSubscription(reference.subscription)
        }
      },
      start: (controller) => {
        streamController = controller
      },
    })
    const response = new Response(body, {
      headers: {
        "cache-control": "no-cache",
        "content-type": "text/event-stream; charset=utf-8",
      },
    })
    const subscription: Subscription = { finalized: false, response, run }
    reference.subscription = subscription
    subscription.controller = streamController
    this.#responseSubscriptions.set(response, subscription)
    for (const event of run.events.slice(start)) {
      streamController?.enqueue(new TextEncoder().encode(eventPayload(event)))
    }
    if (run.complete) {
      streamController?.close()
      this.#finalizeSubscription(subscription)
    } else {
      run.subscribers.add(subscription)
    }
    return response
  }

  #finalizeSubscription(subscription: Subscription) {
    if (subscription.finalized) {
      return
    }
    subscription.finalized = true
    subscription.run.subscribers.delete(subscription)
    this.#responseSubscriptions.delete(subscription.response)
    this.#subscriptionFinalizers += 1
  }

  settle(path: string, input?: FakeFieldInput) {
    const runs = [...this.#runs.values()].toReversed()
    const run = runs.find((candidate) => fieldAt(candidate.snapshot, path)?.status === "pending")
    if (!run || !run.startedPaths.has(path)) {
      return
    }
    const field = this.#terminalField(path, input)
    this.#settleRun(run, path, field, true)
    this.#updateIdentityGate(run, path, field)
  }

  #settleAllRun(run: Run) {
    let settled = false
    do {
      settled = false
      for (const path of pathsOf(run.request)) {
        if (fieldAt(run.snapshot, path)?.status === "pending" && run.startedPaths.has(path)) {
          const field = this.#terminalField(path)
          this.#settleRun(run, path, field, true)
          this.#updateIdentityGate(run, path, field)
          settled = true
        }
      }
    } while (settled)
  }

  settleAll() {
    for (const run of this.#runs.values()) {
      this.#settleAllRun(run)
    }
  }

  settleIdentify(input: FakeFieldInput) {
    for (const run of this.#runs.values()) {
      if (input.status === "notFound") {
        run.identity.company = "notFound"
        run.identity.person = "notFound"
        for (const path of pathsOf(run.request)) {
          if (fieldAt(run.snapshot, path)?.status === "pending") {
            this.#settleRun(run, path, { reason: "identityFailed", status: "notFound" }, false)
          }
        }
        continue
      }
      run.identity.company = "resolved"
      run.identity.person = "resolved"
      for (const path of ["person.linkedin", "company.domain"]) {
        if (fieldAt(run.snapshot, path)?.status === "pending") {
          this.#startPath(run, path)
          this.#settleRun(run, path, this.#terminalField(path, input), true)
        }
      }
      this.#startReadyPaths(run)
    }
  }

  timeout(path: string) {
    const runs = [...this.#runs.values()].toReversed()
    const run = runs.find((candidate) => fieldAt(candidate.snapshot, path)?.status === "pending")
    if (!run || !run.startedPaths.has(path)) {
      return
    }
    const field: TerminalField = { reason: "timeout", status: "notFound" }
    this.#settleRun(run, path, field, true)
    this.#updateIdentityGate(run, path, field)
  }

  snapshot(hash: string) {
    const run = this.#runs.get(hash)
    if (!run) {
      throw new Error("Unknown run")
    }
    return clone(run.snapshot)
  }

  cacheField(path: string, input: FakeFieldInput, options: { readonly scope: CacheScope }) {
    const field = this.#terminalField(path, input)
    for (const key of this.#cache.keys()) {
      if (key.startsWith(`${options.scope}:${path}:`)) {
        this.#cache.delete(key)
      }
    }
    const negativeExpiresAt = field.status === "notFound" ? this.#now + fiveMinutes : undefined
    const entry: CacheEntry = {
      field: clone(field),
      storedAt: this.#now,
    }
    if (negativeExpiresAt !== undefined) {
      entry.negativeExpiresAt = negativeExpiresAt
    }
    this.#cache.set(`${options.scope}:${path}:*`, entry)
    this.#cachedFields[path] = clone(field)
  }

  advanceBy(milliseconds: number) {
    this.#now += milliseconds
  }

  async nextSSE(response: Response): Promise<WireEvent> {
    let reader = this.#readers.get(response)
    if (!reader) {
      if (!response.body) {
        throw new Error("SSE response has no body")
      }
      reader = response.body.getReader()
      this.#readers.set(response, reader)
    }
    const decoder = new TextDecoder()
    let source = ""
    while (!source.includes("\n\n")) {
      // oxlint-disable-next-line no-await-in-loop -- Stream chunks must be read sequentially until one complete SSE frame arrives.
      const result = await reader.read()
      if (result.done) {
        throw new Error("SSE stream ended before the next event")
      }
      source += decoder.decode(result.value, { stream: true })
    }
    const [message] = source.split("\n\n", 1)
    const lines = message?.split("\n") ?? []
    const id = lines.find((line) => line.startsWith("id: "))?.slice(4)
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7)
    const data = lines.find((line) => line.startsWith("data: "))?.slice(6)
    if (
      id === undefined ||
      data === undefined ||
      (event !== "snapshot" && event !== "field" && event !== "complete")
    ) {
      throw new Error("Invalid SSE event")
    }
    return { data: APIJSONValue.parse(JSON.parse(data)), event, id }
  }

  async collectSSE(response: Response) {
    const events: WireEvent[] = []
    while (events.at(-1)?.event !== "complete") {
      // oxlint-disable-next-line no-await-in-loop -- Each event determines whether the sequential protocol stream is complete.
      events.push(await this.nextSSE(response))
    }
    return events
  }

  async disconnect(response: Response) {
    const reader = this.#readers.get(response)
    if (reader) {
      await reader.cancel()
      this.#readers.delete(response)
      return
    }
    await response.body?.cancel()
  }

  close(): Promise<void> {
    if (this.#closed) {
      return Promise.resolve()
    }
    this.#closed = true
    for (const controller of this.#providerControllers) {
      controller.abort()
      this.#runsCancelled += 1
    }
    this.#providerControllers.clear()
    for (const subscription of this.#responseSubscriptions.values()) {
      subscription.controller?.close()
      this.#finalizeSubscription(subscription)
    }
    return this.#providerRunner?.close?.() ?? Promise.resolve()
  }
}

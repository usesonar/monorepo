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
  ResearchRequest,
  SonarSeed,
  SonarSnapshot,
} from "@usesonar/api"

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
  readonly serverSecret: string
  readonly tenants: readonly TestTenant[]
  readonly scenario?: FakeScenario
}

type ParsedRequest = ResearchRequest | DeepResearchRequest
type Route = "/v1/research" | "/v1/deepResearch"
type TerminalField = Exclude<Field, { status: "pending" }>
type CacheScope = "builtIn" | "custom"
type IdentityStatus = "pending" | "resolved" | "notFound"

type WireEvent = {
  readonly id: string
  readonly event: "snapshot" | "field" | "complete"
  readonly data: JSONValue
}

const questionsOf = (request: ParsedRequest): Readonly<Record<string, string>> =>
  request.research ?? request.deepResearch ?? {}

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
  readonly startedPaths: Set<string>
  readonly subscribers: Set<Subscription>
  snapshot: SonarSnapshot
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
    ["company", [...request.company].toSorted(compareCodeUnits)],
    ["person", [...request.person].toSorted(compareCodeUnits)],
    ["ttl", request.ttl],
  ]
  if (request.deepResearch === undefined) {
    configEntries.push(["research", normalizedJSON(request.research ?? {})])
  } else {
    configEntries.push(["deepResearch", normalizedJSON(request.deepResearch)])
  }
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

const pathsOf = (request: ParsedRequest) => [
  ...request.person.map((field) => `person.${field}`),
  ...request.company.map((field) => `company.${field}`),
  ...Object.keys(questionsOf(request)),
]

const isBuiltIn = (path: string) => path.startsWith("person.") || path.startsWith("company.")

const fieldAt = (snapshot: SonarSnapshot, path: string): Field | undefined => {
  const [slot, key, extra] = path.split(".")
  if (extra === undefined && key !== undefined && slot === "person") {
    return Object.entries(snapshot.data.person).find(([candidate]) => candidate === key)?.[1]
  }
  if (extra === undefined && key !== undefined && slot === "company") {
    return Object.entries(snapshot.data.company).find(([candidate]) => candidate === key)?.[1]
  }
  const custom = Object.entries(snapshot.data).find(([candidate]) => candidate === path)?.[1]
  const parsed = APIField.safeParse(custom)
  return parsed.success ? parsed.data : undefined
}

const withField = (snapshot: SonarSnapshot, path: string, field: TerminalField): SonarSnapshot => {
  const [slot, key, extra] = path.split(".")
  if (extra === undefined && key !== undefined && (slot === "person" || slot === "company")) {
    return {
      ...snapshot,
      data: {
        ...snapshot.data,
        [slot]: { ...snapshot.data[slot], [key]: field },
      },
    }
  }
  return { ...snapshot, data: { ...snapshot.data, [path]: field } }
}

const initialSnapshot = (request: ParsedRequest): SonarSnapshot => {
  const person = Object.fromEntries(request.person.map((path) => [path, pending]))
  const company = Object.fromEntries(request.company.map((path) => [path, pending]))
  const questions = questionsOf(request)
  // oxlint-disable-next-line sort-keys -- The wire contract requires person before company.
  const data = {
    person,
    company,
    ...Object.fromEntries(Object.keys(questions).map((key) => [key, pending])),
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
  if (path.startsWith("person.") || path.startsWith("company.")) {
    return `resolved ${path}`
  }
  return true
}

const isConsumerEmail = (seed: SonarSeed) => {
  const domain = seed.email?.split("@").at(-1)?.toLowerCase()
  return domain === undefined || consumerDomains.has(domain)
}

const cacheIdentity = (run: Run, path: string, scope: CacheScope) => {
  const subject = JSON.stringify(normalizedSeed(run.request.seed))
  if (scope === "builtIn") {
    return `builtIn:${path}:${subject}`
  }
  const questions = questionsOf(run.request)
  return `custom:${run.tenantId}:${run.route}:${path}:${ownValue(questions, path) ?? ""}:${subject}`
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
        company: request.seed.domain === undefined ? "pending" : "resolved",
        person: request.seed.linkedinURL === undefined ? "pending" : "resolved",
      },
      request,
      route,
      snapshot,
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

  #startReadyPaths(run: Run) {
    for (const path of pathsOf(run.request)) {
      if (fieldAt(run.snapshot, path)?.status !== "pending") {
        continue
      }
      const ready =
        path === "company.domain" ||
        path === "person.linkedin" ||
        (path.startsWith("company.") && run.identity.company === "resolved") ||
        (path.startsWith("person.") && run.identity.person === "resolved") ||
        (!isBuiltIn(path) && run.identity.company === "resolved")
      if (ready) {
        this.#startPath(run, path)
      }
    }
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
    let side: "person" | "company" | undefined
    if (path === "person.linkedin") {
      side = "person"
    } else if (path === "company.domain") {
      side = "company"
    }
    if (side === undefined) {
      return
    }
    if (field.status === "resolved") {
      run.identity[side] = "resolved"
      if (startDependents) {
        this.#startReadyPaths(run)
      }
      return
    }
    run.identity[side] = "notFound"
    for (const pendingPath of pathsOf(run.request)) {
      const isDependent =
        side === "person"
          ? pendingPath.startsWith("person.")
          : pendingPath.startsWith("company.") || !isBuiltIn(pendingPath)
      if (isDependent && fieldAt(run.snapshot, pendingPath)?.status === "pending") {
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
    for (const subscription of this.#responseSubscriptions.values()) {
      subscription.controller?.close()
      this.#finalizeSubscription(subscription)
    }
    return Promise.resolve()
  }
}

import { compileResearchRequest } from "@usesonar/api"

import type { AnyDeepResearchConfig, AnyResearchConfig, JSONValue, SonarSeed } from "./model.js"

type IdentityConfig = AnyResearchConfig | AnyDeepResearchConfig

type CanonicalRequest =
  | { readonly tier: "research"; readonly config: IdentityConfig; readonly seed: SonarSeed }
  | {
      readonly tier: "deepResearch"
      readonly config: IdentityConfig
      readonly seed: SonarSeed
    }

type NormalizedSeed = {
  linkedinURL?: string
  fullName?: string
  xURL?: string
  email?: string
  domain?: string
  context?: JSONValue
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
  url.pathname = path || "/"
  return url.toString()
}

const isJSONObject = (value: JSONValue): value is { readonly [key: string]: JSONValue } =>
  value !== null && !Array.isArray(value) && Object(value) === value

const compareStrings = (left: string, right: string) => {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

const normalizedJSON = (value: JSONValue): JSONValue => {
  if (Array.isArray(value)) {
    return value.map(normalizedJSON)
  }
  if (isJSONObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => compareStrings(left, right))
        .map(([key, nested]) => [key, normalizedJSON(nested)])
    )
  }
  return value
}

const ttlMultiplier = (unit: string) => {
  switch (unit) {
    case "ms": {
      return 1
    }
    case "s": {
      return 1000
    }
    case "m": {
      return 60_000
    }
    case "h": {
      return 3_600_000
    }
    case "d": {
      return 86_400_000
    }
    case "w": {
      return 604_800_000
    }
    default: {
      return null
    }
  }
}

const normalizedTTL = (value: string) => {
  const match = /^(?<amount>\d+)(?<unit>ms|s|m|h|d|w)$/u.exec(value)
  const amount = match?.groups?.amount
  const unit = match?.groups?.unit
  const multiplier = unit === undefined ? null : ttlMultiplier(unit)
  return amount === undefined || multiplier === null ? value : Number(amount) * multiplier
}

const normalizedSeed = (seed: SonarSeed) => {
  const normalized: NormalizedSeed = {}
  if (seed.linkedinURL) {
    normalized.linkedinURL = normalizedURL(seed.linkedinURL, "linkedin")
  }
  if (seed.fullName) {
    normalized.fullName = seed.fullName.trim().toLowerCase()
  }
  if (seed.xURL) {
    normalized.xURL = normalizedURL(seed.xURL, "x")
  }
  if (seed.email) {
    normalized.email = seed.email.trim().toLowerCase()
  }
  if (seed.domain) {
    normalized.domain = seed.domain.trim().toLowerCase()
  }
  if (seed.context) {
    normalized.context = normalizedJSON(seed.context)
  }
  return normalized
}

const normalizedConfig = (config: IdentityConfig) => {
  // SAFETY: Research configs are compiled before this function, and deep-research configs are
  // already serializable, so both entity selectors contain only JSON values here.
  const company = config.company as JSONValue
  // SAFETY: The same compiled-or-serializable config invariant applies to the person selector.
  const person = config.person as JSONValue
  return {
    company: normalizedJSON(company),
    person: normalizedJSON(person),
    ttl: normalizedTTL(config.ttl),
  }
}

export const canonicalRequestIdentity = (request: CanonicalRequest) => {
  const config =
    request.tier === "research"
      ? (({ seed: _seed, ...compiled }) => compiled)(
          // SAFETY: The research branch carries an authored ResearchConfig plus a valid SonarSeed;
          // the API compiler validates and converts it before identity serialization.
          compileResearchRequest({ ...request.config, seed: request.seed } as never)
        )
      : request.config
  return JSON.stringify({
    config: normalizedConfig(config),
    seed: normalizedSeed(request.seed),
    tier: request.tier,
  })
}

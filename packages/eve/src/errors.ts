/* eslint-disable anti-slop/no-unknown-parameters -- This file is the single public failure boundary; it deliberately discards every property of an untrusted failure rather than parsing or retaining it. */

export type SonarToolRoute = "research" | "deepResearch"
export type SonarToolFailureKind = "cancellation" | "configuration" | "execution" | "validation"

export class SonarToolError extends Error {
  readonly _tag = "SonarToolError"
  readonly kind: SonarToolFailureKind
  readonly route: SonarToolRoute

  constructor(route: SonarToolRoute, kind: SonarToolFailureKind, message: string) {
    super(message)
    this.name = "SonarToolError"
    this.kind = kind
    this.route = route
    delete this.stack
  }
}

export const sonarToolError = (
  route: SonarToolRoute,
  kind: SonarToolFailureKind,
  message: string
) => new SonarToolError(route, kind, message)

const publicMessage = (route: SonarToolRoute, kind: SonarToolFailureKind) => {
  if (kind === "validation") {
    return route === "research"
      ? "Invalid Sonar research input or configuration"
      : "Invalid Sonar deep research input or configuration"
  }
  if (kind === "configuration") {
    return "Sonar configuration could not be created"
  }
  if (kind === "cancellation") {
    return route === "research"
      ? "Sonar research was cancelled"
      : "Sonar deep research was cancelled"
  }
  return route === "research"
    ? "Research could not be completed"
    : "Deep research could not be completed"
}

export const sanitizeSonarFailure = (
  route: SonarToolRoute,
  kind: SonarToolFailureKind,
  error: unknown
) => {
  if (error instanceof SonarToolError) {
    return error
  }
  return sonarToolError(route, kind, publicMessage(route, kind))
}

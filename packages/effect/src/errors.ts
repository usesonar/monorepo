import type { HTTPError } from "./http-error.js"
import type { ProtocolError } from "./protocol-error.js"
import type { RequestError } from "./request-error.js"
import type { TransportError } from "./transport-error.js"

export { HTTPError } from "./http-error.js"
export { ProtocolError } from "./protocol-error.js"
export { RequestError } from "./request-error.js"
export { TransportError } from "./transport-error.js"

export type SonarClientError = RequestError | TransportError | HTTPError | ProtocolError

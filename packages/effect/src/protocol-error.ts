import { Data } from "effect"

type ProtocolErrorFields = {
  readonly message: string
}

export class ProtocolError extends Data.TaggedError("ProtocolError")<ProtocolErrorFields> {
  constructor(fields: ProtocolErrorFields) {
    super({ message: fields.message })
  }
}

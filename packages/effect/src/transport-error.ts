import { Data } from "effect"

type TransportErrorFields = {
  readonly message: string
}

export class TransportError extends Data.TaggedError("TransportError")<TransportErrorFields> {
  constructor(fields: TransportErrorFields) {
    super({ message: fields.message })
  }
}

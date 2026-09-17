import { Data } from "effect"

type RequestErrorFields = {
  readonly message: string
}

export class RequestError extends Data.TaggedError("RequestError")<RequestErrorFields> {
  constructor(fields: RequestErrorFields) {
    super({ message: fields.message })
  }
}

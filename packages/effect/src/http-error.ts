import { Data } from "effect"

type HTTPErrorFields = {
  readonly status: number
  readonly message: string
}

export class HTTPError extends Data.TaggedError("HTTPError")<HTTPErrorFields> {
  constructor(fields: HTTPErrorFields) {
    super({ message: fields.message, status: fields.status })
  }
}

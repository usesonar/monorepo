import { defineEval } from "eve/evals"

export default defineEval({
  description: "Selected background deep research returns one normal final Sonar value.",
  async test(t) {
    const turn = await t.send(
      "Use deep background research to determine Ada's legal name and tax exposure."
    )

    turn.expectOk()
    turn.calledTool("deep-background-sonar", {
      count: 1,
      input: { email: "ada@example.com", fullName: "Ada Lovelace" },
      status: "completed",
    })
    turn.notCalledTool("research-sonar")
    turn.notCalledTool("deep-research-sonar")
    turn.eventsSatisfy(
      "background returns the full final snapshot without delegation",
      (events) => {
        const serialized = JSON.stringify(events)
        return (
          serialized.includes('"type":"action.result"') &&
          serialized.includes("fixture.invalid/entity") &&
          !/delegat|task\.send|poll|"status":"working"/iu.test(serialized)
        )
      }
    )
    turn.messageIncludes("Analytical Engines LLC")
    turn.eventsSatisfy(
      "background model output omits private execution metadata",
      () =>
        turn.message !== undefined &&
        !/sources|resolvedAt|fixture\.invalid|provider|cache|hash/u.test(turn.message)
    )
  },
})

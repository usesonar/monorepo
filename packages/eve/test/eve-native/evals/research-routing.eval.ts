import { defineEval } from "eve/evals"

export default defineEval({
  description:
    "Routes a research request through researchSonar and exposes full partials only to Eve runtime events.",
  async test(t) {
    const turn = await t.send(
      "Use research to identify Ada and tell me whether her company sells to SMBs."
    )

    turn.expectOk()
    turn.calledTool("research-sonar", {
      count: 1,
      input: { email: "ada@example.com", fullName: "Ada Lovelace" },
      status: "completed",
    })
    turn.notCalledTool("deep-research-sonar")
    turn.eventsSatisfy("research publishes a complete preliminary snapshot", (events) =>
      events.some(
        (event) =>
          event.type === "action.partial" && JSON.stringify(event).includes('"status":"pending"')
      )
    )
    turn.eventsSatisfy("the full final action result retains sources", (events) =>
      events.some(
        (event) =>
          event.type === "action.result" &&
          JSON.stringify(event).includes("fixture.invalid/profile")
      )
    )
    turn.messageIncludes("Founder")
    turn.messageIncludes("sellsToSMB")
    turn.eventsSatisfy(
      "the model reply omits private execution metadata",
      () =>
        turn.message !== undefined &&
        !/sources|resolvedAt|fixture\.invalid|provider|cache|hash/u.test(turn.message)
    )
  },
})

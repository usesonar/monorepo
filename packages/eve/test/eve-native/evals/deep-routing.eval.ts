import { defineEval } from "eve/evals"

export default defineEval({
  description:
    "Routes a deep request through deepResearchSonar with complete seed prerequisites and sanitized model output.",
  async test(t) {
    const turn = await t.send(
      "Use deep research to determine Ada's company's legal name and tax exposure."
    )

    turn.expectOk()
    turn.calledTool("deep-research-sonar", {
      count: 1,
      input: { email: "ada@example.com", fullName: "Ada Lovelace" },
      status: "completed",
    })
    turn.notCalledTool("research-sonar")
    turn.notCalledTool("deep-background-sonar")
    turn.eventsSatisfy("deep foreground publishes a complete preliminary snapshot", (events) =>
      events.some(
        (event) =>
          event.type === "action.partial" && JSON.stringify(event).includes('"status":"pending"')
      )
    )
    turn.eventsSatisfy(
      "deep foreground retains full sources in the final action result",
      (events) =>
        events.some(
          (event) =>
            event.type === "action.result" &&
            JSON.stringify(event).includes("fixture.invalid/entity")
        )
    )
    turn.messageIncludes("Analytical Engines LLC")
    turn.messageIncludes("hasTaxExposure")
    turn.eventsSatisfy(
      "the model reply omits unresolved leaves and private execution metadata",
      () =>
        turn.message !== undefined &&
        !/phone|sources|resolvedAt|fixture\.invalid|provider|cache|hash/u.test(turn.message)
    )
  },
})

import { deepResearchSonar } from "../../../../src/index.js"
import { deepConfig, sonarFixtureLayer } from "../lib/sonar-fixture.js"

export default deepResearchSonar(deepConfig, {
  description: "Use this selected background form only when background execution is explicit.",
  execution: "background",
  layer: sonarFixtureLayer,
})

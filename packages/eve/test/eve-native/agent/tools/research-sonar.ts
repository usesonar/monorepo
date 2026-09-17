import { researchSonar } from "../../../../src/index.js"
import { researchConfig, sonarFixtureLayer } from "../lib/sonar-fixture.js"

export default researchSonar(researchConfig, { layer: sonarFixtureLayer })

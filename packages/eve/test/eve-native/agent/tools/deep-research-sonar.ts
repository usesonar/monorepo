import { deepResearchSonar } from "../../../../src/index.js"
import { deepConfig, sonarFixtureLayer } from "../lib/sonar-fixture.js"

export default deepResearchSonar(deepConfig, { layer: sonarFixtureLayer })

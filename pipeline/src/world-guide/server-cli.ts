import "dotenv/config";
import initialSourceConfiguration from "../../config/source-configuration.initial.v1.json" with { type: "json" };
import { GeminiJsonClient } from "../gemini/client.js";
import { parseSourceConfiguration } from "../sources/config.js";
import { createWorldGuideServer } from "./server.js";
import { parseWorldGuideConfig } from "./config.js";
import { createWorldGuideResearchService } from "./research.js";

const config = parseWorldGuideConfig();
const research = config.researchEnabled
  ? createWorldGuideResearchService({
    sourceConfiguration: parseSourceConfiguration(initialSourceConfiguration),
    client: new GeminiJsonClient({ apiKey: config.googleAiApiKey!, model: config.researchModel }),
  })
  : undefined;
const server = createWorldGuideServer(config, Date.now, { research });

server.listen(config.port, "127.0.0.1", () => {
  process.stdout.write(`World Guide local backend listening at http://127.0.0.1:${config.port} (${config.enabled ? "enabled" : "disabled"})\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}

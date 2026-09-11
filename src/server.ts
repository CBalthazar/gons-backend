import { loadEnv } from "./env.js";
import { buildApp } from "./app.js";

const env = loadEnv();
const app = await buildApp(env);

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`GONS API listening on :${env.PORT}${env.API_PREFIX} (docs: /docs)`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

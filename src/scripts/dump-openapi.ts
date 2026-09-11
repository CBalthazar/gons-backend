import { buildApp } from "../app.js";
import type { Env } from "../env.js";

const env: Env = await import("../env.js").then((m) => m.loadEnv());
const app = await buildApp(env);
await app.ready();
console.log(JSON.stringify(app.swagger(), null, 2));
await app.close();

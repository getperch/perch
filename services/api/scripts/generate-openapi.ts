import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { handler } from "../src/handler.js";

/**
 * Writes the OpenAPI 3.1 doc `app.ts` already serves at `/openapi.json` to a committed file, so
 * `apps/desktop/src-tauri`'s `typify` codegen (build.rs) has something to read without needing to
 * run this Node app at Rust build time. Re-run whenever a route's contract changes.
 *
 * Goes through `handler` (the same `hono/aws-lambda` entry point Lambda actually invokes) rather
 * than calling `app.request(...)` directly — `contextMiddleware` (context.ts) unconditionally
 * reads `c.env.event`, which only exists when invoked through the Lambda adapter's event shape.
 */
const event = {
  httpMethod: "GET",
  path: "/api/openapi.json",
  headers: {},
  multiValueHeaders: {},
  body: null,
  isBase64Encoded: false,
  queryStringParameters: null,
  requestContext: { authorizer: {}, stage: "generate" },
  resource: "/api/{proxy+}",
  pathParameters: { proxy: "openapi.json" },
};
const res = await handler(event as never, {} as never, () => {});
const out = fileURLToPath(new URL("../openapi.json", import.meta.url));
await writeFile(out, `${JSON.stringify(JSON.parse(res.body), null, 2)}\n`);
console.log(`Wrote ${out}`);

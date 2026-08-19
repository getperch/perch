import { defaultIsContentTypeBinary, handle } from "hono/aws-lambda";
import { app } from "./app.js";

/**
 * All request/response API traffic (channels, members incl. createAgent, messages, tasks,
 * approvals, the SSE `/channels/{id}/events` polling endpoint) goes through this one Lambda
 * behind the `/api/{proxy+}` route on the REST API — there's no separate streaming Lambda; SSE
 * here is bounded-window polling over the same buffered proxy integration (see
 * channel-events.ts's doc comment).
 *
 * `defaultIsContentTypeBinary` treats any content-type outside a small allowlist (`text/plain`,
 * `html`, `css`, `javascript`, `csv`, plus anything with `json`/`xml` in it) as binary and
 * base64-encodes the Lambda response body. `text/event-stream` isn't in that allowlist, so SSE
 * responses were silently getting base64-encoded — and since `infra/api.ts` never configures the
 * REST API's `binaryMediaTypes`, API Gateway has nothing telling it to decode that back, so it
 * forwarded the base64 string through as literal text: a 200 with a real byte count, but a body
 * that contains no `data:`/`id:` lines at all, which is exactly the "0 event frames" symptom seen
 * client-side. Overriding just this one content-type to non-binary is the fix.
 */
export const handler = handle(app, {
  isContentTypeBinary: (contentType) => (contentType.startsWith("text/event-stream") ? false : defaultIsContentTypeBinary(contentType)),
});

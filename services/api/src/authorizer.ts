import type { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerHandler } from "aws-lambda";
import { createClient } from "@openauthjs/openauth/client";
import { subjects } from "./auth-subjects.js";

// `createClient()` caches the OAuth discovery document (and JWKS) in memory forever once fetched
// successfully — see auth-issuer.ts's comment on the same class of bug. That means a stale/broken
// cache picked up during earlier iteration doesn't get evicted just because the underlying
// endpoint gets fixed; this module has to actually reload for it to re-fetch.
//
// The `issuer` value here has to be the bare origin, not the full "/{stage}/auth" URL, even
// though the full URL is what's actually needed to reach the endpoints. OpenAuth mints every
// token's `iss` claim as `new URL(...).origin` (see its issuer.ts) — that unconditionally
// discards any path, so the claim is always just the bare origin, structurally, no matter where
// this is mounted. `client.verify()` checks the token's `iss` against whatever `issuer` we
// configure here, so if we pass the full prefixed URL, every otherwise-valid token fails an
// issuer mismatch check silently (verify() returns `{err}`, no exception — nothing to catch,
// which is why this was invisible). The custom `fetch` below is what still lets the *actual*
// HTTP calls (well-known, jwks, token) reach the right mounted path.
const issuerUrl = new URL(process.env.OPENAUTH_ISSUER_URL!);
// Defensive against a trailing slash anywhere upstream (e.g. infra's restApi.url has one) —
// a mismatched double-vs-single slash here previously caused a silent double-prefix bug.
const issuerPath = issuerUrl.pathname.replace(/\/+$/, "");
function createPerchClient() {
  return createClient({
    clientID: "perch-desktop",
    issuer: issuerUrl.origin,
    fetch: (input, init) => {
      // A poisoned discovery-doc cache (see the try/catch in `handler` below) surfaces here as
      // `input === undefined` — the library calls `f(wk.jwks_uri)` with a `jwks_uri` that was
      // never actually present in whatever got cached. Fail loudly and specifically instead of
      // letting `.toString()` throw an opaque TypeError that's harder to recognize in logs.
      if (input == null) {
        throw new Error("openauth: undefined fetch target — likely a corrupted cached discovery document");
      }
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (!url.pathname.startsWith(issuerPath)) url.pathname = `${issuerPath}${url.pathname}`;
      return fetch(url.toString(), init);
    },
  });
}
let client = createPerchClient();

// API Gateway caches the returned policy per identity source (the raw Authorization header
// value) for the authorizer's TTL, and reuses it for *any* subsequent call from that same token —
// matching the call's own methodArn against the cached policy's Resource. Echoing back the exact
// methodArn we were invoked with (as this used to) scopes the cached Allow to only that one
// verb+route: e.g. an initial GET for /api/channels caches an Allow for GET .../api/channels,
// and a later POST to /api/channels (different verb, same path) doesn't match it —
// API Gateway denies (403) without even re-invoking this Lambda. Wildcarding verb and resource
// path here means one cached decision covers every route behind this authorizer.
function policy(effect: "Allow" | "Deny", methodArn: string, context?: Record<string, string>): APIGatewayAuthorizerResult {
  const [arnPrefix, stage] = methodArn.split("/");
  const resource = `${arnPrefix}/${stage}/*/*`;
  return {
    principalId: "user",
    policyDocument: { Version: "2012-10-17", Statement: [{ Action: "execute-api:Invoke", Effect: effect, Resource: resource }] },
    context,
  };
}

export const handler: APIGatewayRequestAuthorizerHandler = async (event) => {
  const header = event.headers?.Authorization ?? event.headers?.authorization;
  const token = header?.replace(/^Bearer\s+/i, "");
  if (!token) return policy("Deny", event.methodArn);

  let verified;
  try {
    verified = await client.verify(subjects, token);
  } catch (err) {
    // Most likely the poisoned-discovery-cache bug documented above: an unhandled exception here
    // (rather than a clean `{err}` from verify()) would otherwise bubble up as a raw 500 from API
    // Gateway. Rebuild the client so the *next* request on this warm container gets a fresh
    // discovery/JWKS fetch instead of staying broken until the container recycles.
    console.error("[perch] authorizer: client.verify threw, rebuilding client", err);
    client = createPerchClient();
    return policy("Deny", event.methodArn);
  }
  if (verified.err || verified.subject.type !== "user") return policy("Deny", event.methodArn);

  return policy("Allow", event.methodArn, {
    userId: verified.subject.properties.userID,
    workspaceId: verified.subject.properties.workspaceID,
  });
};

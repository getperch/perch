import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { issuer } from "@openauthjs/openauth";
import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { subjects } from "./auth-subjects.js";
import { resolveOrBootstrapMember } from "./workspace-bootstrap.js";
import { TABLE_NAME } from "./db.js";
import { loginPage, registerPage, changePage } from "./auth-pages.js";

/**
 * Mounted at /auth/* on the main API Gateway REST API (see infra/api.ts) — one URL for
 * everything, no separate CloudFront distribution or Auth component needed. Reuses the main
 * DynamoDB table for OpenAuth's own storage (codes, sessions, password hashes) instead of
 * provisioning a second table; OpenAuth namespaces its own keys internally, so there's no
 * collision with the WORKSPACE#/CHANNEL# keys the rest of the app uses.
 *
 * login/register/change render custom HTML instead of using @openauthjs/openauth's PasswordUI.
 * That's not just branding — every link/form action below is a relative path, which is what
 * makes mounting this whole thing under /auth (via Hono's `.route()` composition) work
 * correctly. PasswordUI's own subpath-safety wasn't mature/reliable enough to depend on.
 */
const issuerApp = issuer({
  subjects,
  storage: DynamoStorage({ table: TABLE_NAME }),
  providers: {
    password: PasswordProvider({
      sendCode: async (email, code) => {
        // No email provider wired up for self-hosted deployments yet — the verification code
        // lands in CloudWatch logs instead. Swap this for SES (or similar) before real use.
        console.log(`[fizz] verification code for ${email}: ${code}`);
      },
      login: async (_req, _form, error) => loginPage(error),
      register: async (_req, state, _form, error) => registerPage(state, error),
      change: async (_req, state, _form, error) => changePage(state, error),
    }),
  },
  success: async (ctx, value) => {
    if (value.provider !== "password") throw new Error(`unsupported provider: ${value.provider}`);
    const person = await resolveOrBootstrapMember(value.email);
    return ctx.subject("user", { userID: person.id, workspaceID: person.workspaceId });
  },
  // OpenAuth's default `allow` only accepts localhost or same-subdomain redirect URIs — a custom
  // URL scheme like the desktop app's `fizz://callback` (see apps/desktop/src/lib/auth.ts) is
  // neither, so it has to be explicitly allowlisted here.
  allow: async ({ clientID, redirectURI }) => clientID === "fizz-desktop" && redirectURI === "fizz://callback",
});

const app = new Hono();
app.route("/auth", issuerApp);

const honoHandler = handle(app);

/**
 * API Gateway REST APIs never expose their stage name (e.g. "robss") to the Lambda — `event.path`
 * is always relative to the API's root resource, with the stage already stripped. OpenAuth's
 * issuer generates some of its own internal redirects (e.g. auto-selecting the sole configured
 * provider, "/authorize" -> "/password/authorize") as root-absolute paths, and its
 * `.well-known/oauth-authorization-server` discovery document embeds fully-qualified
 * self-referential URLs (issuer/authorize/token/jwks_uri) — both assume it owns the whole domain.
 * It's actually mounted at "/{stage}/auth" here, so both need that real prefix patched back in:
 * the Location header for redirects, and any occurrence of this API's own bare origin for
 * response bodies (this is what the authorizer's JWKS fetch depends on — a wrong jwks_uri means
 * every authenticated request fails with a cryptic "JSON Web Key Set malformed" error, since it
 * ends up fetching a 403 page instead of key material).
 */
export const handler = async (event: { requestContext: { stage: string }; headers?: Record<string, string> }, context: unknown) => {
  const result = await honoHandler(event as Parameters<typeof honoHandler>[0], context as never);
  const authPrefix = `/${event.requestContext.stage}/auth`;
  const prefixPath = (path: string) => `${authPrefix}${path}`;

  // API Gateway REST API's Lambda proxy integration event always carries both `headers` and
  // `multiValueHeaders` — which one Hono's adapter mirrors back in the response depends on its
  // own detection, so both have to be checked here rather than assuming a single shape.
  const singleLocation = (result as { headers?: Record<string, unknown> }).headers?.location;
  if (typeof singleLocation === "string" && singleLocation.startsWith("/") && !singleLocation.startsWith("//")) {
    (result as { headers: Record<string, unknown> }).headers.location = prefixPath(singleLocation);
  }

  const multiLocation = (result as { multiValueHeaders?: Record<string, unknown[]> }).multiValueHeaders?.location;
  if (Array.isArray(multiLocation) && typeof multiLocation[0] === "string" && multiLocation[0].startsWith("/") && !multiLocation[0].startsWith("//")) {
    multiLocation[0] = prefixPath(multiLocation[0]);
  }

  const host = event.headers?.host ?? event.headers?.Host;
  const origin = host ? `https://${host}` : undefined;
  if (origin && typeof result.body === "string" && result.body.includes(origin)) {
    // Blanket replace — every occurrence of this API's bare origin in a freshly-generated
    // response body is wrong the same way (the issuer doesn't know it's mounted under a
    // prefix at all), whether or not it's followed by a path segment (e.g. the discovery
    // document's own top-level "issuer" field is just the bare origin, no trailing slash).
    result.body = result.body.split(origin).join(`${origin}${authPrefix}`);
  }

  // Edge-optimized REST APIs (the default for sst.aws.ApiGatewayV1) sit behind an AWS-managed
  // CloudFront distribution. Without an explicit no-store, GET responses here (the login page,
  // the .well-known discovery document, etc.) can get cached at the edge — which, during any
  // period where this handler was returning something broken, could mean a client keeps getting
  // served that stale broken response long after the underlying bug is fixed.
  const anyResult = result as unknown as { headers?: Record<string, unknown>; multiValueHeaders?: Record<string, unknown[]> };
  if (anyResult.headers) anyResult.headers["cache-control"] = "no-store";
  if (anyResult.multiValueHeaders) anyResult.multiValueHeaders["cache-control"] = ["no-store"];

  return result;
};

import type { APIGatewayProxyEvent } from "aws-lambda";
import type { MiddlewareHandler } from "hono";
import type { LambdaContext } from "hono/aws-lambda";

export type Context = {
  workspaceId: string;
  actorId: string;
};

export type AppEnv = {
  Variables: Context;
  Bindings: { event: APIGatewayProxyEvent; lambdaContext: LambdaContext };
};

/**
 * `authorizer.ts` (a custom Lambda REQUEST authorizer, see infra/api.ts) puts its verified
 * OpenAuth subject on `event.requestContext.authorizer` as plain string values — `userId` there
 * is already a real workspace Member id (see auth-issuer.ts's success callback), not a raw
 * auth-provider id, so `actorId` here is directly usable as a Person.id everywhere downstream.
 */
export const contextMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const event = c.env.event;
  const authorizer = (event.requestContext as { authorizer?: Record<string, string> }).authorizer ?? {};
  c.set("workspaceId", event.headers["x-workspace-id"] ?? authorizer.workspaceId ?? "ws_default");
  c.set("actorId", authorizer.userId ?? "anonymous");
  await next();
};

/** Small helper so route handlers can pass a plain `{workspaceId, actorId}` to emit()/appendChannelEvent() unchanged. */
export function ctxOf(c: { get(key: "workspaceId"): string; get(key: "actorId"): string }): Context {
  return { workspaceId: c.get("workspaceId"), actorId: c.get("actorId") };
}

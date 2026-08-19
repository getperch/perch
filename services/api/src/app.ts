import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { AppEnv } from "./context.js";
import { contextMiddleware } from "./context.js";
import { channelsApp } from "./routers/channels.js";
import { messagesApp } from "./routers/messages.js";
import { channelEventsApp } from "./routers/channel-events.js";
import { membersApp } from "./routers/members.js";
import { mentionsApp } from "./routers/mentions.js";
import { modelsApp } from "./routers/models.js";
import { tasksApp } from "./routers/tasks.js";
import { approvalsApp } from "./routers/approvals.js";
import { runsApp } from "./routers/runs.js";
import { workspaceApp } from "./routers/workspace.js";
import { pluginsApp } from "./routers/plugins.js";
import { knowledgeApp } from "./routers/knowledge.js";
import { googleWorkspaceApp } from "./routers/google-workspace.js";

const routes = new OpenAPIHono<AppEnv>();

routes.use("*", cors({ origin: "*" }));
routes.use("*", contextMiddleware);

routes.route("/channels", channelsApp);
routes.route("/channels", messagesApp);
routes.route("/channels", channelEventsApp);
routes.route("/members", membersApp);
routes.route("/mentions", mentionsApp);
routes.route("/models", modelsApp);
routes.route("/tasks", tasksApp);
routes.route("/approvals", approvalsApp);
routes.route("/runs", runsApp);
routes.route("/workspace", workspaceApp);
routes.route("/plugins", pluginsApp);
routes.route("/knowledge", knowledgeApp);
routes.route("/google-workspace", googleWorkspaceApp);

routes.doc31("/openapi.json", { openapi: "3.1.0", info: { title: "Fizz API", version: "0.1.0" } });

/**
 * `infra/api.ts` mounts this Lambda behind `ANY /api/{proxy+}` on the REST API — API Gateway's
 * Lambda proxy integration forwards the *full* incoming path (e.g. `/api/channels`) as
 * `event.path`, not just the `{proxy+}` capture, so Hono's own router has to see routes under
 * `/api` too or every request 404s from inside Hono itself (a real bug this project shipped with:
 * `services/api`'s own smoke tests during development hand-built Lambda events with `path:
 * "/channels"` directly, which never exercised the real `/api`-prefixed path API Gateway actually
 * sends — everything looked fine locally and still 404ed once deployed).
 */
export const app = new OpenAPIHono<AppEnv>();
app.route("/api", routes);

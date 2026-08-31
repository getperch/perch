import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "./db.js";

/**
 * Persists the AWS Lambda durable execution ARN `workflow.start()` hands back, keyed by the
 * `runId` its payload was given — as its own item (`RUNEXEC#<id>`, deliberately NOT `RUN#<id>...`
 * — see below), not a field on the `Run` row itself. That matters: agent-runtime's own
 * `createRun()` (services/agent-runtime/src/persist.ts) writes the whole `run` object in one
 * `PutCommand` without knowing this ARN, so if it landed inside that same item, whichever of the
 * two writes happens second would silently wipe out the other's — real risk here since `createRun`
 * runs asynchronously, moments after `workflow.start()` returns this ARN to the caller. A separate
 * item sidesteps the race entirely: order never matters.
 *
 * The `RUNEXEC#` prefix (not `RUN#<id>#EXEC`) is load-bearing, not cosmetic: every "list this
 * workspace's runs" query — services/agent-runtime/src/persist.ts's `getWorkspaceSpendToday`,
 * services/api/src/routers/{runs,workspace}.ts — does `begins_with(sk, "RUN#")` under
 * `WORKSPACE#<id>` and assumes every match has a `.run` attribute. A `RUN#<id>#EXEC` item matched
 * that prefix too, with no `.run` on it — confirmed live: `checkBudget` (called on literally every
 * agent turn) crashed on `Cannot read properties of undefined (reading 'startedAt')` for every
 * single run started after this was added, since the durable execution's own `StepError` aborts
 * the whole invocation before `createRun` or any handler.ts log line ever runs. `RUNEXEC#` can't
 * collide with a `RUN#` prefix scan, by construction, so this can't recur.
 *
 * Read by `POST /runs/{runId}/cancel` (services/api/src/routers/runs.ts) to actually stop the
 * execution via `workflow.stop()`, not just mark the DB row failed.
 */
export async function recordExecutionArn(workspaceId: string, runId: string, arn: string | undefined): Promise<void> {
  if (!arn) return;
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${workspaceId}`, sk: `RUNEXEC#${runId}`, durableExecutionArn: arn } }));
}

export async function getExecutionArn(workspaceId: string, runId: string): Promise<string | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `RUNEXEC#${runId}` } }));
  return res.Item?.durableExecutionArn as string | undefined;
}

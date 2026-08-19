import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "./db.js";

/**
 * One AgentCore browser session per run, reused across every browser tool call within that run
 * (Strands calls this Lambda fresh per tool call — see agent-runtime/src/tools.ts — so session
 * state has to live outside the invocation). Deliberately no explicit close/flush on run
 * completion: the row's DynamoDB TTL plus AgentCore's own idle session timeout are what end and
 * flush the session's recording. That trades "recording available the instant the run ends" for
 * not having to hook agent-runtime's completion/failure paths — see the plan's decision log.
 */
const SESSION_TTL_SECONDS = 60 * 30;

export async function getOrCreateSession(
  runId: string,
  start: () => Promise<{ sessionId: string; wsEndpoint: string }>,
  reconnect: (sessionId: string) => Promise<string>,
): Promise<{ sessionId: string; wsEndpoint: string }> {
  const key = { pk: `RUN#${runId}`, sk: "BROWSER_SESSION" };
  const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  if (existing.Item?.sessionId) {
    const sessionId = existing.Item.sessionId as string;
    return { sessionId, wsEndpoint: await reconnect(sessionId) };
  }

  const session = await start();
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...key, sessionId: session.sessionId, ttl: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS },
    }),
  );
  return session;
}

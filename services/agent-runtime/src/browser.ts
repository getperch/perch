import {
  BedrockAgentCoreClient,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";

/**
 * Minimal AgentCore Browser session wrapper for procedure replay. Deliberately a local copy of the
 * same ~20 lines in services/tools/browser-agentcore and services/procedure-recorder — this repo
 * keeps service Lambdas independently deployable rather than sharing a runtime package (see
 * services/agent-runtime/src/events.ts's "small local copy" note for the same call).
 */

const client = new BedrockAgentCoreClient({ region: process.env.HOME_REGION });
const BROWSER_IDENTIFIER = process.env.AGENTCORE_BROWSER_ID ?? "";

export async function startBrowserSession(): Promise<{ sessionId: string; automationEndpoint: string }> {
  if (!BROWSER_IDENTIFIER) throw new Error("AGENTCORE_BROWSER_ID is not set");
  const res = await client.send(
    new StartBrowserSessionCommand({ browserIdentifier: BROWSER_IDENTIFIER, name: "perch-routine-replay", sessionTimeoutSeconds: 600 }),
  );
  const automationEndpoint = res.streams?.automationStream?.streamEndpoint;
  if (!res.sessionId || !automationEndpoint) throw new Error("AgentCore did not return a session id / automation endpoint");
  return { sessionId: res.sessionId, automationEndpoint };
}

export async function stopBrowserSession(sessionId: string): Promise<void> {
  await client.send(new StopBrowserSessionCommand({ browserIdentifier: BROWSER_IDENTIFIER, sessionId })).catch(() => {});
}

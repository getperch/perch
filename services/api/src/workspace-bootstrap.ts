import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { ddb, TABLE_NAME } from "./db.js";

// Self-hosted deployments are single-workspace for now — matches the `ws_default` fallback
// in services/api/src/context.ts.
const WORKSPACE_ID = "ws_default";

async function listPersonMembers() {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `WORKSPACE#${WORKSPACE_ID}`, ":prefix": "MEMBER#" },
    }),
  );
  return (res.Items ?? []).map((i) => i.member).filter((m) => m.kind === "person");
}

/** Bootstraps the workspace itself, plus its first Member — nothing else creates the META row. */
async function bootstrapWorkspace(email: string) {
  const now = new Date().toISOString();
  const workspace = { id: WORKSPACE_ID, name: "Workspace", spendCapUsdPerDay: 60, createdAt: now };
  const person = {
    kind: "person" as const,
    id: ulid(),
    workspaceId: WORKSPACE_ID,
    name: email.split("@")[0]!,
    email,
    role: "owner" as const,
    mono: email.slice(0, 2).toUpperCase(),
    colorBg: "#c4ddfb",
    colorFg: "#00458c",
    createdAt: now,
  };
  await Promise.all([
    ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${WORKSPACE_ID}`, sk: "META", workspace } })),
    ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${WORKSPACE_ID}`, sk: `MEMBER#${person.id}`, member: person } })),
  ]);
  return person;
}

/**
 * Called from the OpenAuth issuer's `success` callback for every completed password sign-in —
 * both a first-time registration and every later login land here, so this has to be idempotent
 * by email rather than assuming "new account".
 *
 * Invite-gated: a Person with this email must already exist (an admin added them via the People
 * screen) before they can sign in — except the very first account ever, which bootstraps the
 * workspace and becomes its owner, since there's no other way in before that.
 */
export async function resolveOrBootstrapMember(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  const persons = await listPersonMembers();
  const existing = persons.find((m) => typeof m.email === "string" && m.email.toLowerCase() === email);
  if (existing) return existing;
  if (persons.length > 0) {
    throw new Error("This email hasn't been invited to a workspace yet — ask an admin to add you first.");
  }
  return bootstrapWorkspace(email);
}

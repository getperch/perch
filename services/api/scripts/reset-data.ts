/**
 * Wipes every item from the workspace DynamoDB table for the current SST stage — workspace,
 * channels, members, messages, runs, tasks, approvals, channel events, AND the OpenAuth keys
 * stored alongside them (see auth-issuer.ts). After running this you sign in again from scratch;
 * the first sign-in re-bootstraps the workspace and its owner (workspace-bootstrap.ts).
 *
 * This is a local-dev reset for when a stored record no longer satisfies the current zod schema
 * and `normalizeMembersLenient` starts silently dropping it (agent vanishing from People, etc.) —
 * cheaper here than writing a migration. It refuses to run against a "production" stage.
 *
 * Run it through SST so the table name is injected:
 *   pnpm --filter @fizz/api reset-data          # wraps the command in `sst shell`
 *   sst shell -- pnpm --filter @fizz/api exec tsx scripts/reset-data.ts
 *
 * Pass --yes to skip the confirmation prompt.
 */
import { createInterface } from "node:readline/promises";
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

function resourceValue(name: string): Record<string, unknown> | undefined {
  const raw = process.env[`SST_RESOURCE_${name}`];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function resolveTableName(): string {
  const fromResource = resourceValue("Table")?.name;
  if (typeof fromResource === "string" && fromResource) return fromResource;
  if (process.env.WORKSPACE_TABLE_NAME) return process.env.WORKSPACE_TABLE_NAME;
  throw new Error(
    "Couldn't resolve the table name. Run this through SST so the resource env is present:\n" +
      "  pnpm --filter @fizz/api reset-data",
  );
}

function resolveStage(): string {
  const fromResource = resourceValue("App")?.stage;
  if (typeof fromResource === "string" && fromResource) return fromResource;
  return process.env.SST_STAGE ?? process.env.STAGE ?? "unknown";
}

async function main() {
  const stage = resolveStage();
  if (/^prod(uction)?$/i.test(stage)) {
    throw new Error(`Refusing to wipe data for stage "${stage}" — this script is for local/dev stages only.`);
  }

  const tableName = resolveTableName();
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  if (!process.argv.includes("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `This deletes EVERY item in "${tableName}" (stage "${stage}"), including auth keys. Type the stage name to confirm: `,
    );
    rl.close();
    if (answer.trim() !== stage) {
      console.log("Aborted — input did not match the stage name.");
      process.exit(1);
    }
  }

  let deleted = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: "pk, sk",
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const items = page.Items ?? [];
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: { [tableName]: batch.map((item) => ({ DeleteRequest: { Key: { pk: item.pk, sk: item.sk } } })) },
        }),
      );
      deleted += batch.length;
      process.stdout.write(`\rDeleted ${deleted} items…`);
    }
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  process.stdout.write(`\rDeleted ${deleted} items. Table "${tableName}" is now empty.\n`);
  console.log("Sign in again to re-bootstrap the workspace and owner.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

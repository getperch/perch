import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.WORKSPACE_TABLE_NAME ?? "workspace";
const GENESIS_HASH = "0".repeat(64);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Reserves the next `{seq, prevHash}` for a workspace's audit chain with an optimistic-concurrency
 * update, retrying on conflict. The SQS FIFO queue in front of this handler (MessageGroupId =
 * workspaceId, see infra) already serializes events per workspace, so contention here should be
 * rare — this is a belt-and-suspenders guard against duplicate/out-of-order delivery.
 */
export async function reserveNextChainPosition(workspaceId: string): Promise<{ seq: number; prevHash: string }> {
  const key = { pk: `WORKSPACE#${workspaceId}`, sk: "AUDITCHAIN" };

  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
    const seq = current.Item?.seq ?? 0;
    const prevHash = current.Item?.lastHash ?? GENESIS_HASH;

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: key,
          UpdateExpression: "SET seq = :nextSeq",
          ConditionExpression: "attribute_not_exists(seq) OR seq = :expectedSeq",
          ExpressionAttributeValues: { ":nextSeq": seq + 1, ":expectedSeq": seq },
        }),
      );
      return { seq, prevHash };
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) continue;
      throw err;
    }
  }
  throw new Error(`could not reserve audit chain position for workspace ${workspaceId} after retries`);
}

export async function recordChainHash(workspaceId: string, hash: string) {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `WORKSPACE#${workspaceId}`, sk: "AUDITCHAIN" },
      UpdateExpression: "SET lastHash = :hash",
      ExpressionAttributeValues: { ":hash": hash },
    }),
  );
}

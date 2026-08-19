import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/** Same single table and key schema as services/api/src/db.ts — see that file for the layout. */
export const TABLE_NAME = process.env.WORKSPACE_TABLE_NAME ?? "workspace";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

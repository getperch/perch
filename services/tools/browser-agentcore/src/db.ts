import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// This Lambda deploys to us-east-1 (see infra/gateway.ts's file comment — Gateway can only front
// Lambdas in its own region), but the workspace table lives in the app's home region — pin
// explicitly, since DynamoDBClient defaults to this Lambda's own runtime region otherwise.
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.HOME_REGION }));
export const TABLE_NAME = process.env.WORKSPACE_TABLE_NAME ?? "";

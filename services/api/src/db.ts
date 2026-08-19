import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Single DynamoDB table for the whole workspace domain (see infra/README for the key schema):
 *   Workspace  PK=WORKSPACE#<id>        SK=META
 *   Channel    PK=WORKSPACE#<id>        SK=CHANNEL#<id>
 *   Member     PK=WORKSPACE#<id>        SK=MEMBER#<id>
 *   GoogleWorkspaceConnection (per-agent, non-secret metadata only — the refresh token itself is
 *              an SSM SecureString, see google-oauth.ts) PK=WORKSPACE#<id>  SK=MEMBER#<id>#GOOGLE_WORKSPACE
 *   Task       PK=WORKSPACE#<id>        SK=TASK#<id>
 *   Approval   PK=WORKSPACE#<id>        SK=APPROVAL#<id>
 *   Run        PK=WORKSPACE#<id>        SK=RUN#<id>
 *   RunStep    PK=RUN#<id>              SK=STEP#<ulid>
 *   Message    PK=CHANNEL#<id>          SK=MSG#<ulid>
 *   ChannelEvent (feeds the SSE tail)   PK=CHANNEL#<id>  SK=EVENT#<ulid>
 * `SST_RESOURCE_Table` is injected by the SST `Linkable`/`Table` resource at deploy time.
 */
export const TABLE_NAME = process.env.WORKSPACE_TABLE_NAME ?? "workspace";

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

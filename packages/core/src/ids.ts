import { z } from "zod";

/**
 * ULIDs are used for every entity id: lexicographically sortable, so DynamoDB sort keys stay
 * time-ordered. Plain strings rather than zod `.brand()`ed types on purpose — branding buys
 * compile-time id-mixing safety but forces a cast at every object literal built outside a
 * `.parse()` call, which is most of the backend. Not worth the friction for a v0 scaffold.
 */
export const idSchema = z.string().min(1);

export const workspaceId = idSchema;
export const channelId = idSchema;
export const memberId = idSchema;
export const messageId = idSchema;
export const runId = idSchema;
export const runStepId = idSchema;
export const taskId = idSchema;
export const approvalId = idSchema;
export const auditEventId = idSchema;

export type WorkspaceId = z.infer<typeof workspaceId>;
export type ChannelId = z.infer<typeof channelId>;
export type MemberId = z.infer<typeof memberId>;
export type MessageId = z.infer<typeof messageId>;
export type RunId = z.infer<typeof runId>;
export type RunStepId = z.infer<typeof runStepId>;
export type TaskId = z.infer<typeof taskId>;
export type ApprovalId = z.infer<typeof approvalId>;
export type AuditEventId = z.infer<typeof auditEventId>;

import { z } from "zod";
import { auditEventId, workspaceId } from "./ids.js";

/**
 * One immutable action in the workspace's audit trail. `services/audit-writer` appends these,
 * hash-chained, to an S3 bucket with Object Lock (WORM) — this schema is the payload of that chain.
 */
export const auditEventType = z.enum([
  "workspace.updated",
  "member.created",
  "member.updated",
  "member.deleted",
  "channel.created",
  "channel.updated",
  "channel.deleted",
  "channel.member_added",
  "channel.member_removed",
  "message.sent",
  "message.reacted",
  "message.edited",
  "message.deleted",
  "run.started",
  "run.step",
  "run.completed",
  "run.failed",
  "approval.requested",
  "approval.approved",
  "approval.denied",
  "task.created",
  "task.updated",
  "google_workspace.connected",
  "google_workspace.disconnected",
  "knowledge.created",
  "knowledge.updated",
  "knowledge.deprecated",
  "knowledge.verified",
]);
export type AuditEventType = z.infer<typeof auditEventType>;

export const auditEvent = z.object({
  id: auditEventId,
  workspaceId,
  type: auditEventType,
  /** id of the actor: a member id, or "system" for scheduled triggers */
  actorId: z.string(),
  /** free-form event payload, shape depends on `type` */
  data: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof auditEvent>;

/** The record actually persisted to S3: the event plus its position in the tamper-evident hash chain. */
export const auditRecord = z.object({
  seq: z.number().int().nonnegative(),
  prevHash: z.string(),
  hash: z.string(),
  event: auditEvent,
});
export type AuditRecord = z.infer<typeof auditRecord>;

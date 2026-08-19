/// <reference path="../.sst/platform/config.d.ts" />

/**
 * services/api and services/agent-runtime both call `emit()`, which puts every audit-worthy
 * action onto this bus. A single rule fans everything out to a FIFO queue (MessageGroupId =
 * workspaceId) so services/audit-writer processes one workspace's events strictly in order —
 * that ordering guarantee is what makes the hash chain in the S3 audit log valid.
 */
export function makeEventBus() {
  const bus = new sst.aws.Bus("EventBus");

  const auditQueue = new sst.aws.Queue("AuditQueue", {
    fifo: true,
    transform: {
      queue: (args) => {
        args.contentBasedDeduplication = true;
      },
    },
  });

  // FIFO targets require MessageGroupId per message — pulled from the event detail so all of one
  // workspace's events land in the same group, which is what makes the audit hash chain's
  // per-workspace ordering guarantee hold.
  bus.subscribeQueue("AuditSubscription", auditQueue, {
    pattern: { source: ["workspace.api", "workspace.agent-runtime"] },
    transform: {
      target: (args) => {
        args.sqsTarget = { messageGroupId: "$.detail.workspaceId" };
      },
    },
  });

  return { bus, auditQueue };
}

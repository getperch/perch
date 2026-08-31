import type { SQSHandler } from "aws-lambda";
import { auditEvent } from "@perch/core";
import { reserveNextChainPosition, recordChainHash } from "./chain-state.js";
import { computeHash, writeAuditRecord } from "./s3-writer.js";

/**
 * One SQS FIFO queue per deployment, MessageGroupId = workspaceId (see infra/sst.config.ts),
 * batch size 1 — guarantees in-order, one-at-a-time processing per workspace so the hash chain
 * never has to reconcile out-of-order writes. Source events come from EventBridge (`emit()` in
 * services/api) fanned out to this queue.
 */
export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const detail = JSON.parse(record.body).detail;
    const parsed = auditEvent.safeParse(detail);
    if (!parsed.success) {
      console.error("audit-writer: dropping malformed event", parsed.error.flatten());
      continue;
    }

    const { seq, prevHash } = await reserveNextChainPosition(parsed.data.workspaceId);
    const hash = computeHash(prevHash, parsed.data);
    await writeAuditRecord({ seq, prevHash, hash, event: parsed.data });
    await recordChainHash(parsed.data.workspaceId, hash);
  }
};

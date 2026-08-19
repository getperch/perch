import { workflow } from "sst/aws/workflow";

/**
 * Resumes a run paused on `DurableContext.callback()` in services/agent-runtime. `callbackId` is
 * the `Approval.callbackToken` stored when the approval-needed step created the callback.
 */
export async function resolveDurableCallback(callbackId: string, result: unknown) {
  await workflow.succeed(callbackId, { payload: result });
}

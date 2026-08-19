import { z } from "zod";
import { approval, approvalId } from "@fizz/core";

export const resolveApprovalInput = z.object({
  approvalId,
  decision: z.enum(["approved", "denied"]),
});
export const resolveApprovalOutput = approval;

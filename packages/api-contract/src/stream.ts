import { z } from "zod";
import { approval, channelId, message, run, runStep, task } from "@perch/core";

/**
 * The event union sent down `GET /channels/{id}/events` as SSE `data:` payloads.
 * `cursor` is echoed back by clients as `Last-Event-ID` on reconnect so the stream Lambda
 * can resume from exactly where it left off — see infra README for the reconnect contract.
 */
export const channelStreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message.created"), cursor: z.string(), channelId, message }),
  // Covers reactions, edits, and deletes — anything that mutates an existing message in place.
  // Clients just replace-by-id in their cache rather than needing a variant per mutation kind.
  z.object({ type: z.literal("message.updated"), cursor: z.string(), channelId, message }),
  z.object({ type: z.literal("run.updated"), cursor: z.string(), channelId, run }),
  z.object({ type: z.literal("run.step"), cursor: z.string(), channelId, step: runStep }),
  z.object({ type: z.literal("approval.updated"), cursor: z.string(), channelId, approval }),
  z.object({ type: z.literal("task.created"), cursor: z.string(), channelId, task }),
  z.object({ type: z.literal("task.updated"), cursor: z.string(), channelId, task }),
]);
export type ChannelStreamEvent = z.infer<typeof channelStreamEvent>;

/**
 * Plain `Omit<Union, K>` collapses a discriminated union to its members' common keys, losing the
 * discriminant-based narrowing — this distributes over the union first so each variant keeps its
 * own shape minus `cursor`. Used wherever a producer builds the event before a cursor exists.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ChannelStreamEventInput = DistributiveOmit<ChannelStreamEvent, "cursor">;

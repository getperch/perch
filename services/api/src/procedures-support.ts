import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { DeleteParameterCommand, GetParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { Procedure } from "@perch/core";

/**
 * Out-of-band plumbing for Routines that the `/procedures` router leans on: per-routine secret
 * parameters and the EventBridge Scheduler schedules. Kept out of the router so its handlers stay
 * readable. (Recording now runs locally in the desktop sidecar — see apps/desktop/sidecar.)
 */

const STAGE = process.env.STAGE ?? "dev";
const HOME_REGION = process.env.HOME_REGION;
const SCHEDULE_GROUP = process.env.ROUTINE_SCHEDULE_GROUP ?? "";
const SCHEDULER_TARGET_ARN = process.env.ROUTINE_SCHEDULER_FUNCTION_ARN ?? "";
const SCHEDULER_ROLE_ARN = process.env.ROUTINE_SCHEDULER_ROLE_ARN ?? "";

const scheduler = new SchedulerClient({ region: HOME_REGION });
const ssm = new SSMClient({ region: HOME_REGION });

/** `/perch/{stage}/{workspaceId}/procedure/{procedureId}/{key}` — matches the google-oauth.ts
 * convention. The `*`-wildcarded form is granted to this function and the replay runtime in
 * infra/api.ts. */
export function procedureSecretSsmPath(workspaceId: string, procedureId: string, key: string): string {
  return `/perch/${STAGE}/${workspaceId}/procedure/${procedureId}/${key}`;
}

export async function putProcedureSecret(workspaceId: string, procedureId: string, key: string, value: string): Promise<void> {
  await ssm.send(
    new PutParameterCommand({ Name: procedureSecretSsmPath(workspaceId, procedureId, key), Value: value, Type: "SecureString", Overwrite: true }),
  );
}

export async function deleteProcedureSecret(workspaceId: string, procedureId: string, key: string): Promise<void> {
  await ssm.send(new DeleteParameterCommand({ Name: procedureSecretSsmPath(workspaceId, procedureId, key) })).catch((err) => {
    if ((err as { name?: string }).name !== "ParameterNotFound") throw err;
  });
}

export async function readProcedureSecret(workspaceId: string, procedureId: string, key: string): Promise<string> {
  const res = await ssm.send(new GetParameterCommand({ Name: procedureSecretSsmPath(workspaceId, procedureId, key), WithDecryption: true }));
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`secret "${key}" is not set for this routine`);
  return value;
}

/* ─── EventBridge Scheduler: one schedule per scheduled routine ─────────────── */

/**
 * Standard 5-field cron -> EventBridge Scheduler's 6-field `cron(...)`. EB requires a `?` in
 * exactly one of day-of-month / day-of-week, uses 1-7 = SUN-SAT for day-of-week (vs standard
 * 0-6 = SUN-SAT), and takes a trailing year field. Good enough for the cadences the UI's cron
 * builder emits (`0 9 * * *`, `0 9 * * 1-5`, `0 9 1 * *`, …); a hand-written cron with both DOM
 * and DOW set will lose the DOW half.
 */
export function fiveFieldToEventBridgeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`schedule cron must have 5 fields, got "${cron}"`);
  let [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  if (dow !== "*") {
    dow = dow.replace(/\d/g, (d) => String((Number(d) % 7) + 1)); // 0-6 SUN-SAT -> 1-7 SUN-SAT
    dom = "?";
  } else {
    dow = "?";
  }
  return `cron(${min} ${hour} ${dom} ${mon} ${dow} *)`;
}

const scheduleName = (procedureId: string) => `routine-${procedureId}`;

export async function syncProcedureSchedule(procedure: Procedure): Promise<void> {
  const name = scheduleName(procedure.id);
  if (!procedure.schedule) {
    await deleteProcedureSchedule(procedure.id);
    return;
  }
  const params = {
    Name: name,
    GroupName: SCHEDULE_GROUP,
    ScheduleExpression: fiveFieldToEventBridgeCron(procedure.schedule.cron),
    ScheduleExpressionTimezone: procedure.schedule.timezone,
    FlexibleTimeWindow: { Mode: "OFF" as const },
    Target: {
      Arn: SCHEDULER_TARGET_ARN,
      RoleArn: SCHEDULER_ROLE_ARN,
      Input: JSON.stringify({ workspaceId: procedure.workspaceId, procedureId: procedure.id }),
    },
  };
  const exists = await scheduler
    .send(new GetScheduleCommand({ Name: name, GroupName: SCHEDULE_GROUP }))
    .then(() => true)
    .catch((err) => {
      if ((err as { name?: string }).name === "ResourceNotFoundException") return false;
      throw err;
    });
  await scheduler.send(exists ? new UpdateScheduleCommand(params) : new CreateScheduleCommand(params));
}

export async function deleteProcedureSchedule(procedureId: string): Promise<void> {
  await scheduler
    .send(new DeleteScheduleCommand({ Name: scheduleName(procedureId), GroupName: SCHEDULE_GROUP }))
    .catch((err) => {
      if ((err as { name?: string }).name !== "ResourceNotFoundException") throw err;
    });
}

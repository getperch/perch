/// <reference path="../.sst/platform/config.d.ts" />

/**
 * Routine scheduling. One EventBridge Scheduler *schedule* is created per scheduled routine at
 * runtime by `services/api/src/routers/procedures.ts` (via `@aws-sdk/client-scheduler`), all in
 * the group this creates; every schedule targets the one thin `procedure-scheduler` Lambda, which
 * does nothing but `workflow.start` the routine's replay (see services/procedure-scheduler).
 *
 * The dedicated Lambda (rather than pointing Scheduler straight at a new `api` route) keeps a
 * clean IAM boundary — Scheduler assumes a role that can invoke exactly this one function and
 * nothing else.
 */
export function makeRoutineScheduling(args: { table: sst.aws.Dynamo; bus: sst.aws.Bus; agentRuntime: sst.aws.Workflow }) {
  const { table, bus, agentRuntime } = args;

  const scheduleGroup = new aws.scheduler.ScheduleGroup("RoutineScheduleGroup", {
    name: `perch-${$app.stage}-routines`,
  });

  const procedureScheduler = new sst.aws.Function("ProcedureScheduler", {
    handler: "services/procedure-scheduler/src/handler.handler",
    link: [table, bus, agentRuntime],
    environment: { WORKSPACE_TABLE_NAME: table.name },
  });

  // The role EventBridge Scheduler assumes when it fires a schedule — allowed to invoke only the
  // one scheduler Lambda.
  const schedulerRole = new aws.iam.Role("RoutineSchedulerInvokeRole", {
    assumeRolePolicy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { Service: "scheduler.amazonaws.com" }, Action: "sts:AssumeRole" }],
    }),
  });
  new aws.iam.RolePolicy("RoutineSchedulerInvokePolicy", {
    role: schedulerRole.id,
    policy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: "lambda:InvokeFunction", Resource: procedureScheduler.arn }],
    }),
  });

  return {
    scheduleGroupName: scheduleGroup.name,
    procedureSchedulerArn: procedureScheduler.arn,
    schedulerRoleArn: schedulerRole.arn,
  };
}

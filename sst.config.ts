/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "perch",
      // Self-hosters running their own copy typically want `remove` even in "production" so a
      // teardown doesn't strand billed resources; the audit bucket's Object Lock makes the audit
      // trail itself un-deletable regardless of this setting.
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: { aws: { package: "@pulumi/aws", version: "7.43.0" } },
    };
  },
  async run() {
    const {
      makeTable,
      makeAuditBucket,
      makeAgentPluginsBucket,
      makeAgentRecordingsBucket,
      makeAgentMemoryBucket,
    } = await import("./infra/storage.js");
    const { makeEventBus } = await import("./infra/events.js");
    const { makeApi } = await import("./infra/api.js");
    const table = makeTable();
    const auditBucket = makeAuditBucket();
    const agentPluginsBucket = makeAgentPluginsBucket();
    const agentRecordingsBucket = makeAgentRecordingsBucket();
    const agentMemoryBucket = makeAgentMemoryBucket();
    const { bus, auditQueue } = makeEventBus();
    const { restApi } = makeApi({
      table,
      bus,
      auditBucket,
      auditQueue,
      agentPluginsBucket,
      agentRecordingsBucket,
      agentMemoryBucket,
    });
    return {
      apiUrl: restApi.url,
      auditBucketName: auditBucket.name,
      agentPluginsBucketName: agentPluginsBucket.name,
      agentRecordingsBucketName: agentRecordingsBucket.name,
      agentMemoryBucketName: agentMemoryBucket.name,
    };
  },
});

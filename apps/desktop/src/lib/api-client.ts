import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { channels, members, mentions, models, messages, tasks, approvals, runs, workspace, plugins, googleWorkspace } from "@perch/api-contract";
import { signOut } from "./auth.js";
import { pushToast } from "./toasts.js";

/**
 * Every `api/*.rs` command already attaches the token/base URL from the Rust-side store, tries a
 * transparent refresh on a 401, and only clears the store if that doesn't recover it (see
 * `api/client.rs`'s `send_authenticated`) — `Err("signed out")` reaching here means refresh was
 * either not possible or failed, not just an ordinary expiry. That's a rejected promise here, not
 * a thrown session-shaped error, so this is what flips the frontend's React state back to
 * signed-out (the store itself is already cleared by the time this runs).
 */
async function invokeApi<T>(cmd: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  try {
    const result = await invoke<unknown>(cmd, args);
    return schema.parse(result);
  } catch (err) {
    if (err === "signed out") {
      await signOut();
      pushToast("info", "You were signed out — please sign in again");
      throw new Error("signed out");
    }
    throw err;
  }
}

type Body<Input extends z.ZodType, Drop extends string> = Omit<z.infer<Input>, Drop>;

export const api = {
  channels: {
    list: () => invokeApi("channels_list", {}, channels.listChannelsOutput),
    get: (channelId: string) => invokeApi("channels_get", { channelId }, channels.getChannelOutput),
    create: (input: Body<typeof channels.createChannelInput, "workspaceId">) =>
      invokeApi("channels_create", { input }, channels.createChannelOutput),
    getOrCreateDirect: (otherMemberIds: string[]) =>
      invokeApi("channels_get_or_create_direct", { input: { otherMemberIds } }, channels.getOrCreateDirectOutput),
    addMember: (channelId: string, memberId: string) =>
      invokeApi("channels_add_member", { channelId, input: { memberId } }, channels.addChannelMemberOutput),
    removeMember: (channelId: string, memberId: string) =>
      invokeApi("channels_remove_member", { channelId, memberId }, channels.removeChannelMemberOutput),
    update: (channelId: string, input: Body<typeof channels.updateChannelInput, "channelId">) =>
      invokeApi("channels_update", { channelId, input }, channels.updateChannelOutput),
    delete: (channelId: string) => invokeApi("channels_delete", { channelId }, channels.deleteChannelOutput),
  },
  models: {
    list: () => invokeApi("models_list", {}, models.listModelsOutput),
  },
  messages: {
    list: (channelId: string, params?: { cursor?: string; limit?: number }) =>
      invokeApi("messages_list", { channelId, ...params }, messages.listMessagesOutput),
    send: (channelId: string, input: Body<typeof messages.sendMessageInput, "channelId">) =>
      invokeApi("messages_send", { channelId, input }, messages.sendMessageOutput),
    toggleReaction: (channelId: string, messageId: string, emoji: string) =>
      invokeApi("messages_toggle_reaction", { channelId, messageId, input: { emoji } }, messages.toggleReactionOutput),
    edit: (channelId: string, messageId: string, text: string) =>
      invokeApi("messages_edit", { channelId, messageId, input: { text } }, messages.editMessageOutput),
    delete: (channelId: string, messageId: string) =>
      invokeApi("messages_delete", { channelId, messageId }, messages.deleteMessageOutput),
  },
  members: {
    me: () => invokeApi("members_me", {}, members.meOutput),
    list: () => invokeApi("members_list", {}, members.listMembersOutput),
    createPerson: (input: Body<typeof members.createPersonInput, "workspaceId">) =>
      invokeApi("members_create_person", { input }, members.createPersonOutput),
    createAgent: (input: Body<typeof members.createAgentInput, "workspaceId">) =>
      invokeApi("members_create_agent", { input }, members.createAgentOutput),
    updateAgent: (memberId: string, config: z.infer<typeof members.updateAgentInput>["config"]) =>
      invokeApi("members_update_agent", { memberId, config }, members.updateAgentOutput),
    delete: (memberId: string) => invokeApi("members_delete", { memberId }, members.deleteMemberOutput),
  },
  mentions: {
    list: () => invokeApi("mentions_list", {}, mentions.listMentionsOutput),
  },
  tasks: {
    list: (channelId?: string) => invokeApi("tasks_list", { channelId }, tasks.listTasksOutput),
    create: (input: Body<typeof tasks.createTaskInput, "workspaceId">) =>
      invokeApi("tasks_create", { input }, tasks.createTaskOutput),
    update: (taskId: string, input: Body<typeof tasks.updateTaskInput, "taskId">) =>
      invokeApi("tasks_update", { taskId, input }, tasks.updateTaskOutput),
  },
  approvals: {
    resolve: (approvalId: string, decision: "approved" | "denied") =>
      invokeApi("approvals_resolve", { approvalId, input: { decision } }, approvals.resolveApprovalOutput),
  },
  runs: {
    get: (runId: string) => invokeApi("runs_get", { runId }, runs.getRunOutput),
  },
  workspace: {
    get: () => invokeApi("workspace_get", {}, workspace.getWorkspaceOutput),
    updateSpendCap: (spendCapUsdPerDay: number) =>
      invokeApi("workspace_update_spend_cap", { input: { spendCapUsdPerDay } }, workspace.updateSpendCapOutput),
    getSpend: () => invokeApi("workspace_get_spend", {}, workspace.getSpendOutput),
    updateSettings: (input: Body<typeof workspace.updateSettingsInput, "workspaceId">) =>
      invokeApi("workspace_update_settings", { input }, workspace.updateSettingsOutput),
  },
  plugins: {
    list: (q?: string) => invokeApi("plugins_list", { q }, plugins.listOutput),
    get: (name: string, version: string) => invokeApi("plugins_get", { name, version }, plugins.getOutput),
    publish: (memberId: string) => invokeApi("plugins_publish", { input: { memberId } }, plugins.publishOutput),
    import: (url: string) => invokeApi("plugins_import", { input: { url } }, plugins.importOutput),
  },
  artifacts: {
    getContent: (url: string) => invokeApi("artifacts_get_content", { url }, z.string()),
  },
  googleWorkspace: {
    /** Fetches the OAuth client id and opens the system browser to Google's consent screen for
     * `memberId` — resolves once the browser is opened, not once the flow completes (see
     * `completeGoogleConnect`, driven by the `perch://google-workspace-callback` deep link). */
    beginConnect: (memberId: string) => invokeApi("begin_google_connect", { memberId }, z.void()),
    /** Finishes the flow once the deep link routes back into the app (see main.tsx) — the Rust
     * side does the token exchange with the backend and returns the connected email. */
    completeConnect: (callbackUrl: string) => invokeApi("complete_google_connect", { callbackUrl }, googleWorkspace.connectOutput),
    getConnection: (memberId: string) => invokeApi("google_workspace_get_connection", { memberId }, googleWorkspace.getConnectionOutput),
    disconnect: (memberId: string) => invokeApi("disconnect_google_workspace", { memberId }, googleWorkspace.disconnectOutput),
    /** Backs the Settings screen's Google Workspace card — the one workspace-level OAuth client,
     * configured at runtime rather than via `sst secret set`. */
    getStatus: () => invokeApi("google_workspace_get_client_status", {}, googleWorkspace.getClientStatusOutput),
    saveClient: (clientId: string, clientSecret: string) =>
      invokeApi("google_workspace_save_client", { input: { clientId, clientSecret } }, googleWorkspace.putClientOutput),
    clearClient: () => invokeApi("google_workspace_clear_client", {}, googleWorkspace.deleteClientOutput),
  },
};

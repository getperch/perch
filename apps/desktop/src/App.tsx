import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import type { AgentConfig, ApprovalPolicy, ArtifactRef, Channel, Member, Message, SkillDoc, Task, TaskSource, ToolGrant, TriggerConfig } from "@perch/core";
import { pluginToAgentDraft } from "@perch/core";
import {
  AppShell,
  Sidebar,
  WorkspaceRail,
  HomeScreen,
  ChatScreen,
  MentionsScreen,
  ProfileRail,
  EmptyScreen,
  AddMemberScreen,
  AddToWorkspaceModal,
  NewDmScreen,
  RunDetailScreen,
  TasksScreen,
  SettingsScreen,
  AgentDetailScreen,
  Dialog,
  ToastHost,
  LoadingScreen,
  useIsNarrow,
  responsiveBreakpointPx,
  HomeIcon,
  BellIcon,
  CheckSquareIcon,
  GridIcon,
  SettingsIcon,
  type NavItem,
  type ImportedAgentDraft,
} from "@perch/ui";
import { api } from "./lib/api-client.js";
import { useAuth, signOut } from "./lib/auth.js";
import { useChannelStream } from "./lib/stream.js";
import { useMentionNotifications } from "./lib/notifications.js";
import { useToasts, dismissToast, pushToast } from "./lib/toasts.js";
import { SignIn } from "./SignIn.js";

type Screen =
  | { name: "home" }
  | { name: "chat" }
  | { name: "new-dm" }
  | { name: "mentions" }
  | { name: "canvases" }
  | { name: "add-member" }
  | { name: "run"; runId: string }
  | { name: "tasks" }
  | { name: "people" }
  | { name: "settings" }
  | { name: "agent"; memberId: string };

type MessagesPage = { messages: Message[]; nextCursor?: string };
type MessagesCache = InfiniteData<MessagesPage>;

/** Pages come back newest-group-first (page 0 is the newest 50), each page internally oldest -> newest. */
function flattenMessages(data: MessagesCache | undefined): Message[] {
  return (data?.pages ?? []).slice().reverse().flatMap((p) => p.messages);
}

/**
 * Every message mutation round-trips through Tauri -> the Rust HTTP client -> API Gateway -> the
 * Lambda, which is consistently ~1-2s even when nothing's wrong — patching the cache here first
 * makes the UI feel instant, then `invalidateQueries` in `onSuccess` reconciles with the real
 * server response (and `onError` rolls back if the request actually failed).
 *
 * The list is an infinite query (one page per scroll-back into history), so the updater runs
 * against the whole flattened thread and the result is re-seated into the newest page; the older
 * pages keep their `pageParams`/`nextCursor` so "load older" still walks backwards correctly.
 */
function patchMessagesCache(queryClient: QueryClient, channelId: string, updater: (messages: Message[]) => Message[]) {
  queryClient.setQueryData<MessagesCache>(["messages", "list", channelId], (old) => {
    if (!old || old.pages.length === 0) return old;
    const patched = updater(flattenMessages(old));
    return { ...old, pages: old.pages.map((p, i) => (i === 0 ? { ...p, messages: patched } : { ...p, messages: [] })) };
  });
}

async function beginOptimisticEdit(queryClient: QueryClient, channelId: string) {
  await queryClient.cancelQueries({ queryKey: ["messages", "list", channelId] });
  return queryClient.getQueryData<MessagesCache>(["messages", "list", channelId]);
}

export function App() {
  const auth = useAuth();
  const toasts = useToasts();

  return (
    <>
      {auth.status === "loading" ? (
        <LoadingScreen />
      ) : auth.status === "signed-out" ? (
        <SignIn />
      ) : (
        <Workspace />
      )}
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

function Workspace() {
  const queryClient = useQueryClient();
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [activeChannelId, setActiveChannelId] = useState<string>();
  /** Member whose profile is shown in the right rail (sidebar agents list, a message avatar, the
   * channel header panel toggle). */
  const [selectedMemberId, setSelectedMemberId] = useState<string>();
  /** Local-only presentation toggle for agent messages — no backend field (matches the design's
   * `agentMessageStyle` prop). */
  const [agentMessageStyle] = useState<"tinted" | "flat">("tinted");
  const isNarrowViewport = useIsNarrow(responsiveBreakpointPx);
  const [draft, setDraft] = useState("");
  const [openArtifact, setOpenArtifact] = useState<ArtifactRef>();
  const artifactContent = useQuery({
    queryKey: ["artifact", openArtifact?.url],
    queryFn: () => api.artifacts.getContent(openArtifact!.url),
    enabled: !!openArtifact,
  });
  /** The unified "Add to workspace" modal, or null when closed. */
  const [addModal, setAddModal] = useState<null | "channel" | "people" | "agent">(null);

  const channels = useQuery({ queryKey: ["channels", "list"], queryFn: () => api.channels.list() });
  const members = useQuery({ queryKey: ["members", "list"], queryFn: () => api.members.list() });
  const tasks = useQuery({ queryKey: ["tasks", "list"], queryFn: () => api.tasks.list() });
  const workspace = useQuery({ queryKey: ["workspace", "get"], queryFn: () => api.workspace.get() });
  const me = useQuery({ queryKey: ["members", "me"], queryFn: () => api.members.me() });
  // Polled so a new @mention surfaces (and fires a desktop notification, below) without the user
  // having to be on the Notifications screen.
  const mentions = useQuery({ queryKey: ["mentions", "list"], queryFn: () => api.mentions.list(), refetchInterval: 30_000 });
  const spend = useQuery({ queryKey: ["workspace", "spend"], queryFn: () => api.workspace.getSpend() });
  const models = useQuery({ queryKey: ["models", "list"], queryFn: () => api.models.list() });
  const availableModels = models.data ?? DEFAULT_MODELS;

  // A valid session whose Member record no longer exists (e.g. the workspace data was wiped) —
  // `GET /members/me` 404s with "current user not found". Nothing in the app can render without a
  // current user and retrying won't help, so drop the stale session and fall back to sign-in,
  // which re-bootstraps the workspace on the next login.
  useEffect(() => {
    if (!me.isError) return;
    const msg = me.error instanceof Error ? me.error.message : String(me.error);
    if (/current user not found/i.test(msg)) void signOut();
  }, [me.isError, me.error]);

  useMentionNotifications(mentions.data);

  const [addMemberError, setAddMemberError] = useState<string>();
  const openAddMember = () => {
    setAddMemberError(undefined);
    setPluginSelection(undefined);
    setImportedPlugin(undefined);
    setImportPluginError(undefined);
    setPluginQuery("");
    setAddModal(null);
    setScreen({ name: "add-member" });
  };

  const [pluginSelection, setPluginSelection] = useState<{ name: string; version: string }>();
  const [pluginQuery, setPluginQuery] = useState("");
  const plugins = useQuery({ queryKey: ["plugins", "list", pluginQuery], queryFn: () => api.plugins.list(pluginQuery || undefined), enabled: screen.name === "add-member" });
  const selectedPlugin = useQuery({
    queryKey: ["plugins", "get", pluginSelection?.name, pluginSelection?.version],
    queryFn: () => api.plugins.get(pluginSelection!.name, pluginSelection!.version),
    enabled: !!pluginSelection,
  });
  const [importedPlugin, setImportedPlugin] = useState<{ manifest: import("@perch/core").PluginManifest; skillMarkdown: string; additionalSkills?: Record<string, string> }>();
  const [importPluginError, setImportPluginError] = useState<string>();
  const importPluginUrl = useMutation({
    mutationFn: (url: string) => api.plugins.import(url),
    onSuccess: (result) => {
      setImportPluginError(undefined);
      setPluginSelection(undefined);
      setImportedPlugin(result);
    },
    onError: (err: Error) => setImportPluginError(err.message),
  });
  const importedAgentDraft: ImportedAgentDraft | null = useMemo(() => {
    const source = selectedPlugin.data ?? importedPlugin;
    if (!source) return null;
    const draft = pluginToAgentDraft(source.manifest, source.skillMarkdown, source.additionalSkills);
    return {
      roleDescription: draft.roleDescription,
      instructions: draft.instructions,
      toolNames: draft.config.tools.map((t) => t.toolName),
      toolApprovalOverrides: Object.fromEntries(draft.config.tools.map((t) => [t.toolName, t.needsApproval])),
      modelId: draft.config.model,
      triggerEnabled: Object.fromEntries(draft.config.triggers.map((t) => [t.kind, t.enabled])),
      dailySpendCapUsd: draft.config.dailySpendCapUsd,
      skills: draft.config.skills,
    };
  }, [selectedPlugin.data, importedPlugin]);

  const [publishedByAgent, setPublishedByAgent] = useState<Record<string, { name: string; version: string }>>({});
  const publishAgent = useMutation({
    mutationFn: (vars: { memberId: string }) => api.plugins.publish(vars.memberId),
    onSuccess: (result, vars) => setPublishedByAgent((m) => ({ ...m, [vars.memberId]: result })),
  });

  const agentDetailMemberId = screen.name === "agent" ? screen.memberId : undefined;
  const googleWorkspaceConnection = useQuery({
    queryKey: ["googleWorkspace", "connection", agentDetailMemberId],
    queryFn: () => api.googleWorkspace.getConnection(agentDetailMemberId!),
    enabled: !!agentDetailMemberId,
  });
  // Resolves once the system browser is opened, not once the flow completes — the connection
  // itself lands later via main.tsx's deep-link handler, which invalidates the query above once
  // `perch://google-workspace-callback` comes back.
  const connectGoogleWorkspace = useMutation({
    mutationFn: (memberId: string) => api.googleWorkspace.beginConnect(memberId),
  });
  const disconnectGoogleWorkspace = useMutation({
    mutationFn: (memberId: string) => api.googleWorkspace.disconnect(memberId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["googleWorkspace", "connection"] }),
  });

  // Backs the Settings screen's Google Workspace card — the one workspace-level OAuth client
  // (distinct from each agent's own connection above), configured at runtime instead of a
  // deploy-time `sst secret set`.
  const googleWorkspaceStatus = useQuery({
    queryKey: ["googleWorkspace", "status"],
    queryFn: () => api.googleWorkspace.getStatus(),
    enabled: screen.name === "settings",
  });
  const saveGoogleWorkspaceClient = useMutation({
    mutationFn: (vars: { clientId: string; clientSecret: string }) => api.googleWorkspace.saveClient(vars.clientId, vars.clientSecret),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["googleWorkspace", "status"] }),
  });
  const clearGoogleWorkspaceClient = useMutation({
    mutationFn: () => api.googleWorkspace.clearClient(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["googleWorkspace", "status"] }),
  });

  const channelId = activeChannelId ?? channels.data?.find((c) => c.kind !== "direct")?.id;
  const messages = useInfiniteQuery({
    queryKey: ["messages", "list", channelId],
    queryFn: ({ pageParam }) => api.messages.list(channelId!, pageParam ? { cursor: pageParam as string } : undefined),
    initialPageParam: undefined as string | undefined,
    // Each successive page walks further back in time; `nextCursor` is absent once we hit the
    // start of the channel's history.
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!channelId,
  });
  const flatMessages = useMemo(() => flattenMessages(messages.data), [messages.data]);
  const run = useQuery({
    queryKey: ["runs", "get", screen.name === "run" ? screen.runId : undefined],
    queryFn: () => api.runs.get(screen.name === "run" ? screen.runId : ""),
    enabled: screen.name === "run",
  });

  const sendMessage = useMutation({
    mutationFn: (vars: { channelId: string; text: string; optimisticId: string }) => api.messages.send(vars.channelId, { text: vars.text }),
    onMutate: async (vars) => {
      const previous = await beginOptimisticEdit(queryClient, vars.channelId);
      const optimistic: Message = {
        id: vars.optimisticId,
        workspaceId: workspace.data?.id ?? "",
        channelId: vars.channelId,
        authorId: me.data?.id,
        isSystem: false,
        text: vars.text,
        tools: [],
        citations: [],
        reactions: [],
        createdAt: new Date().toISOString(),
      };
      patchMessagesCache(queryClient, vars.channelId, (messages) => [...messages, optimistic]);
      return { previous };
    },
    // Relabels the optimistic row from `optimistic-<id>` to `failed-<id>` instead of restoring
    // `ctx.previous` — keeps the message visible with retry/dismiss (see ChatScreen's MessageRow)
    // rather than having it silently vanish.
    onError: (_err, vars) => {
      patchMessagesCache(queryClient, vars.channelId, (messages) =>
        messages.map((msg) => (msg.id === vars.optimisticId ? { ...msg, id: `failed-${vars.optimisticId}` } : msg)),
      );
      pushToast("error", "Message failed to send");
    },
    onSuccess: (_data, vars) => queryClient.invalidateQueries({ queryKey: ["messages", "list", vars.channelId] }),
  });
  const toggleReaction = useMutation({
    mutationFn: (vars: { channelId: string; messageId: string; emoji: string }) => api.messages.toggleReaction(vars.channelId, vars.messageId, vars.emoji),
    onMutate: async (vars) => {
      const previous = await beginOptimisticEdit(queryClient, vars.channelId);
      const actorId = me.data?.id;
      patchMessagesCache(queryClient, vars.channelId, (messages) =>
        messages.map((msg) => {
          if (msg.id !== vars.messageId || !actorId) return msg;
          const already = msg.reactions.some((r) => r.memberId === actorId && r.emoji === vars.emoji);
          return {
            ...msg,
            reactions: already
              ? msg.reactions.filter((r) => !(r.memberId === actorId && r.emoji === vars.emoji))
              : [...msg.reactions, { emoji: vars.emoji, memberId: actorId }],
          };
        }),
      );
      return { previous };
    },
    onError: (_err, vars, ctx) => ctx?.previous && queryClient.setQueryData(["messages", "list", vars.channelId], ctx.previous),
    onSuccess: (_data, vars) => queryClient.invalidateQueries({ queryKey: ["messages", "list", vars.channelId] }),
  });
  const editMessage = useMutation({
    mutationFn: (vars: { channelId: string; messageId: string; text: string }) => api.messages.edit(vars.channelId, vars.messageId, vars.text),
    onMutate: async (vars) => {
      const previous = await beginOptimisticEdit(queryClient, vars.channelId);
      patchMessagesCache(queryClient, vars.channelId, (messages) =>
        messages.map((msg) => (msg.id === vars.messageId ? { ...msg, text: vars.text, editedAt: new Date().toISOString() } : msg)),
      );
      return { previous };
    },
    onError: (_err, vars, ctx) => ctx?.previous && queryClient.setQueryData(["messages", "list", vars.channelId], ctx.previous),
    onSuccess: (_data, vars) => queryClient.invalidateQueries({ queryKey: ["messages", "list", vars.channelId] }),
  });
  const deleteMessage = useMutation({
    mutationFn: (vars: { channelId: string; messageId: string }) => api.messages.delete(vars.channelId, vars.messageId),
    onMutate: async (vars) => {
      const previous = await beginOptimisticEdit(queryClient, vars.channelId);
      patchMessagesCache(queryClient, vars.channelId, (messages) =>
        messages.map((msg) =>
          msg.id === vars.messageId
            ? { ...msg, text: undefined, tools: [], citations: [], artifact: undefined, deletedAt: new Date().toISOString() }
            : msg,
        ),
      );
      return { previous };
    },
    onError: (_err, vars, ctx) => ctx?.previous && queryClient.setQueryData(["messages", "list", vars.channelId], ctx.previous),
    onSuccess: (_data, vars) => queryClient.invalidateQueries({ queryKey: ["messages", "list", vars.channelId] }),
  });
  const createAgent = useMutation({
    mutationFn: (vars: Parameters<typeof api.members.createAgent>[0]) => api.members.createAgent(vars),
    onSuccess: (member) => {
      // Seed the list so the agent screen finds the new member before the refetch lands,
      // otherwise AgentDetailScreen renders null (blank) for a beat.
      queryClient.setQueryData<Member[]>(["members", "list"], (prev) => (prev ? [...prev, member as Member] : prev));
      queryClient.invalidateQueries({ queryKey: ["members", "list"] });
      setAddMemberError(undefined);
      setAddModal(null);
      setScreen({ name: "agent", memberId: member.id });
    },
    onError: (err: Error) => setAddMemberError(err.message),
  });
  const createPerson = useMutation({
    mutationFn: (vars: Parameters<typeof api.members.createPerson>[0]) => api.members.createPerson(vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", "list"] });
      setAddMemberError(undefined);
      setAddModal(null);
      // Chat renders null when there's no channel yet (fresh workspace) — go Home instead.
      setScreen(channelId ? { name: "chat" } : { name: "home" });
    },
    onError: (err: Error) => setAddMemberError(err.message),
  });
  const addExistingMember = useMutation({
    mutationFn: (vars: { channelId: string; memberId: string }) => api.channels.addMember(vars.channelId, vars.memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels", "list"] });
      setAddMemberError(undefined);
      setScreen({ name: "chat" });
    },
    onError: (err: Error) => setAddMemberError(err.message),
  });
  const removeChannelMember = useMutation({
    mutationFn: (vars: { channelId: string; memberId: string }) => api.channels.removeMember(vars.channelId, vars.memberId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["channels", "list"] }),
    onError: (err: Error) => pushToast("error", err.message || "Couldn't remove member"),
  });
  const updateChannel = useMutation({
    mutationFn: (vars: { channelId: string; name?: string; topic?: string }) =>
      api.channels.update(vars.channelId, { name: vars.name, topic: vars.topic }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["channels", "list"] }),
    onError: (err: Error) => pushToast("error", err.message || "Couldn't update channel"),
  });
  const resolveApproval = useMutation({
    mutationFn: (vars: { approvalId: string; decision: "approved" | "denied" }) => api.approvals.resolve(vars.approvalId, vars.decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", "list", channelId] }),
  });
  const updateSpendCap = useMutation({
    mutationFn: (vars: { spendCapUsdPerDay: number }) => api.workspace.updateSpendCap(vars.spendCapUsdPerDay),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace", "get"] }),
  });
  const updateSettings = useMutation({
    mutationFn: (vars: { approvalPolicy?: ApprovalPolicy; maxStepsPerRun?: number; maxConcurrentRuns?: number; trustedPluginRegistries?: string[] }) =>
      api.workspace.updateSettings(vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace", "get"] }),
  });
  const createTask = useMutation({
    mutationFn: (vars: { channelId: string; ownerId: string; title: string; source: TaskSource; scheduleLabel?: string; detail?: string }) =>
      api.tasks.create(vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", "list"] }),
  });
  const updateTask = useMutation({
    mutationFn: (vars: { taskId: string; status?: Task["status"]; detail?: string }) =>
      api.tasks.update(vars.taskId, { status: vars.status, detail: vars.detail }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", "list"] }),
  });
  const updateAgentTriggers = useMutation({
    mutationFn: (vars: { memberId: string; triggers: TriggerConfig[] }) => api.members.updateAgent(vars.memberId, { triggers: vars.triggers }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", "list"] }),
  });
  const updateAgentTools = useMutation({
    mutationFn: (vars: { memberId: string; tools: ToolGrant[] }) => api.members.updateAgent(vars.memberId, { tools: vars.tools }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", "list"] }),
  });
  const updateAgentModel = useMutation({
    mutationFn: (vars: { memberId: string; model: string }) => api.members.updateAgent(vars.memberId, { model: vars.model as AgentConfig["model"] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", "list"] }),
  });
  const updateAgentSkills = useMutation({
    mutationFn: (vars: { memberId: string; skills: SkillDoc[] }) => api.members.updateAgent(vars.memberId, { skills: vars.skills }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", "list"] }),
  });
  const createChannel = useMutation({
    mutationFn: (vars: { name: string; topic?: string; memberIds?: string[] }) => api.channels.create(vars),
    onSuccess: (channel) => {
      queryClient.invalidateQueries({ queryKey: ["channels", "list"] });
      setActiveChannelId(channel.id);
      setScreen({ name: "chat" });
      setAddModal(null);
    },
  });
  const openDirect = useMutation({
    mutationFn: (vars: { otherMemberIds: string[] }) => api.channels.getOrCreateDirect(vars.otherMemberIds),
    onSuccess: (channel) => {
      queryClient.invalidateQueries({ queryKey: ["channels", "list"] });
      setActiveChannelId(channel.id);
      setScreen({ name: "chat" });
    },
  });
  const deleteChannel = useMutation({
    mutationFn: (channelId: string) => api.channels.delete(channelId),
    onSuccess: (_r, channelId) => {
      queryClient.invalidateQueries({ queryKey: ["channels", "list"] });
      if (activeChannelId === channelId) setActiveChannelId(undefined);
      setScreen({ name: "home" });
    },
    onError: (err: Error) => pushToast("error", err.message || "Couldn't delete channel"),
  });
  const deleteMember = useMutation({
    mutationFn: (memberId: string) => api.members.delete(memberId),
    onSuccess: (_r, memberId) => {
      queryClient.invalidateQueries({ queryKey: ["members", "list"] });
      queryClient.invalidateQueries({ queryKey: ["channels", "list"] });
      if (selectedMemberId === memberId) setSelectedMemberId(undefined);
    },
    onError: (err: Error) => pushToast("error", err.message || "Couldn't remove member"),
  });

  // Live delivery: SSE events for the open channel patch the same query-cache keys the
  // request/response mutations above invalidate, so both paths converge on one source of truth.
  useChannelStream(channelId, (event) => {
    if (event.type === "message.created" || event.type === "message.updated") {
      queryClient.invalidateQueries({ queryKey: ["messages", "list", event.channelId] });
    } else if (event.type === "run.updated" || event.type === "run.step") {
      queryClient.invalidateQueries({ queryKey: ["runs", "get"] });
      // A completed/failed run almost always posted a reply message. Re-checking the message
      // list here too means one dropped SSE frame (see stream.rs's per-frame parsing) doesn't
      // permanently hide that reply — the run's own event gives it a second chance to show up.
      if (event.type === "run.updated" && (event.run.status === "completed" || event.run.status === "failed")) {
        queryClient.invalidateQueries({ queryKey: ["messages", "list", event.channelId] });
      }
    } else if (event.type === "approval.updated") {
      queryClient.invalidateQueries({ queryKey: ["messages", "list", event.channelId] });
    } else if (event.type === "task.created" || event.type === "task.updated") {
      queryClient.invalidateQueries({ queryKey: ["tasks", "list"] });
    }
  });

  const membersById = useMemo(() => {
    const map: Record<string, Member> = {};
    for (const m of members.data ?? []) map[m.id] = m;
    return map;
  }, [members.data]);

  const activeChannel = channels.data?.find((c) => c.id === channelId);
  const currentUser = me.data;
  const groupChannels = (channels.data ?? []).filter((c) => c.kind !== "direct");
  const directChannels = (channels.data ?? [])
    .filter((c) => c.kind === "direct" && currentUser && c.memberIds.includes(currentUser.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const activeDirectId = activeChannel?.kind === "direct" ? activeChannel.id : undefined;

  const agentMembers = (members.data ?? []).filter((m): m is Extract<Member, { kind: "agent" }> => m.kind === "agent");
  const workspaceOwner = (members.data ?? []).find((m) => m.kind === "person" && m.role === "owner");
  const spendByAgentId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of spend.data?.agents ?? []) map[a.agentId] = a.spentTodayUsd;
    return map;
  }, [spend.data]);
  const selectedMember = selectedMemberId ? membersById[selectedMemberId] : undefined;

  const openDirectWith = (memberId: string) => openDirect.mutate({ otherMemberIds: [memberId] });

  // Existing direct-message conversations — labelled by the other participant (or the first, on a
  // group DM). New ones are started from the "+" via NewDirectMessageModal.
  const dms = useMemo(
    () =>
      directChannels.map((c) => {
        const otherId = c.memberIds.find((id) => id !== me.data?.id);
        const other = otherId ? membersById[otherId] : undefined;
        return {
          id: c.id,
          name: other?.name ?? c.name,
          mono: other?.mono ?? c.name.slice(0, 2).toUpperCase(),
          colorBg: other?.colorBg ?? "#D6D6CD",
          colorFg: other?.colorFg ?? "#3A3A34",
          kind: (other?.kind ?? "person") as "agent" | "person",
        };
      }),
    [directChannels, membersById, me.data?.id],
  );

  const unreadMentions = (mentions.data ?? []).filter((m) => m.unread).length;
  const navItems: NavItem[] = [
    { key: "home", label: "Home", glyph: <HomeIcon size={15} /> },
    { key: "mentions", label: "Notifications", glyph: <BellIcon size={15} />, count: unreadMentions || undefined, accentCount: true },
    { key: "tasks", label: "Tasks", glyph: <CheckSquareIcon size={15} />, count: tasks.data?.filter((t: Task) => t.status !== "done").length },
    { key: "canvases", label: "Canvases", glyph: <GridIcon size={15} /> },
    { key: "settings", label: "Settings", glyph: <SettingsIcon size={15} /> },
  ];

  const channelsById = useMemo(() => {
    const map: Record<string, Channel> = {};
    for (const c of channels.data ?? []) map[c.id] = c;
    return map;
  }, [channels.data]);

  // React Query catches a queryFn's rejection internally rather than letting it become an
  // unhandled promise rejection, so a failed load otherwise fails silently. Only `me` is truly
  // fatal — without the current user there's nothing to render. Every other query degrades to its
  // `?? []` / `?? undefined` fallback and shows a dismissible retry strip (see `degradedQueries`)
  // rather than blanking the whole app: one member row that won't decode server-side (a legacy
  // record missing a now-required field) used to take the entire workspace down with it.
  const secondaryQueries = { channels, members, tasks, workspace, spend, mentions };
  const degraded = Object.entries(secondaryQueries).filter(([, q]) => q.isError);
  if (me.isError) {
    console.error("Initial workspace load failed:", me.error);
    const meErrMsg = me.error instanceof Error ? me.error.message : String(me.error);
    // The effect above is signing us out — show the neutral loading state, not a scary error card.
    if (/current user not found/i.test(meErrMsg)) return <LoadingScreen label="Signing you out…" />;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Couldn't load your workspace</div>
        <div style={{ fontSize: 13, color: "#666", maxWidth: 420 }}>{me.error instanceof Error ? me.error.message : String(me.error)}</div>
        <button onClick={() => me.refetch()}>Retry</button>
      </div>
    );
  }

  if (!currentUser) return <LoadingScreen label="Loading your workspace…" />; // waiting on members.me load

  const retryDegraded = () => degraded.forEach(([, q]) => q.refetch());

  const workspaceSummary = {
    id: workspace.data?.id ?? "ws",
    name: workspace.data?.name ?? "Workspace",
    mark: (workspace.data?.name ?? "W").slice(0, 1).toUpperCase(),
    meta: "Your workspace",
    active: true,
  };

  // The profile rail is a global surface, but the redesign runs Settings/People full-width.
  const railAllowed = screen.name !== "settings" && screen.name !== "people";
  const profileRail = selectedMember && railAllowed ? (
    <ProfileRail
      member={selectedMember}
      channelName={activeChannel?.kind === "group" ? activeChannel.name : undefined}
      tasks={tasks.data ?? []}
      spendToday={spendByAgentId[selectedMember.id]}
      toolCount={selectedMember.kind === "agent" ? selectedMember.config.tools.length : 0}
      ownerName={workspaceOwner?.name}
      ownedAgents={
        selectedMember.kind === "person" && selectedMember.role === "owner"
          ? agentMembers.map((a) => ({ id: a.id, name: a.name, mono: a.mono, role: a.roleDescription, colorBg: a.colorBg, colorFg: a.colorFg }))
          : []
      }
      onClose={() => setSelectedMemberId(undefined)}
      onMessage={() => openDirectWith(selectedMember.id)}
      onConfigure={() => setScreen({ name: "agent", memberId: selectedMember.id })}
      onOpenAgent={(id) => setSelectedMemberId(id)}
    />
  ) : undefined;

  return (
    <>
    {degraded.length > 0 && (
      <div
        style={{
          position: "fixed",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 300,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          borderRadius: 10,
          background: "#17142A",
          color: "#fff",
          fontSize: 12.5,
          boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
        }}
      >
        <span>Some data didn't load ({degraded.map(([k]) => k).join(", ")}).</span>
        <button onClick={retryDegraded} style={{ background: "rgba(255,255,255,0.16)", border: "none", color: "#fff", borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer" }}>
          Retry
        </button>
      </div>
    )}
    <AppShell
      workspaceRail={
        <WorkspaceRail
          workspace={workspaceSummary}
          workspaces={[workspaceSummary]}
          currentUser={currentUser}
          onPickWorkspace={() => {}}
          onOpenPreferences={() => setScreen({ name: "settings" })}
          onSignOut={signOut}
        />
      }
      sidebar={
        <Sidebar
          workspaceName={workspace.data?.name ?? "Workspace"}
          navItems={navItems}
          activeNavKey={screen.name}
          onNav={(key) => setScreen({ name: key } as Screen)}
          channels={groupChannels}
          activeChannelId={screen.name === "chat" ? channelId : undefined}
          onSelectChannel={(id) => {
            setActiveChannelId(id);
            setScreen({ name: "chat" });
          }}
          onCreateChannel={() => setAddModal("channel")}
          onToggleWorkspaceMenu={() => {}}
          dms={dms}
          activeDmId={screen.name === "chat" ? activeDirectId : undefined}
          onOpenDm={(id) => {
            setActiveChannelId(id);
            setScreen({ name: "chat" });
          }}
          onNewMessage={() => setScreen({ name: "new-dm" })}
        />
      }
      rightRail={profileRail}
      rightRailOpen={!!profileRail}
      main={({ isNarrow, openSidebar }) => {
        if (screen.name === "home") {
          return (
            <HomeScreen
              currentUserId={currentUser.id}
              currentUserName={currentUser.name}
              tasks={tasks.data ?? []}
              membersById={membersById}
              channelsById={channelsById}
              recentMessages={flatMessages}
              spendTodayUsd={spend.data?.spentTodayUsd ?? 0}
              spendCapUsd={workspace.data?.spendCapUsdPerDay ?? 0}
              onOpenRun={(runId) => setScreen({ name: "run", runId })}
              onGoTasks={() => setScreen({ name: "tasks" })}
              onOpenChannel={(id) => {
                setActiveChannelId(id);
                setScreen({ name: "chat" });
              }}
              onInvite={() => setAddModal("people")}
              isNarrow={isNarrow}
              onOpenSidebar={openSidebar}
            />
          );
        }

        if (screen.name === "mentions") {
          return (
            <MentionsScreen
              mentions={mentions.data ?? []}
              onOpenChannel={(id) => {
                setActiveChannelId(id);
                setScreen({ name: "chat" });
              }}
              isNarrow={isNarrow}
              onOpenSidebar={openSidebar}
            />
          );
        }

        if (screen.name === "new-dm") {
          return (
            <NewDmScreen
              members={(members.data ?? []).filter((m) => m.id !== currentUser.id)}
              onPick={(memberId) => openDirect.mutate({ otherMemberIds: [memberId] })}
              onCancel={() => setScreen({ name: "home" })}
              onAddMember={openAddMember}
              isNarrow={isNarrow}
              onOpenSidebar={openSidebar}
            />
          );
        }

        if (screen.name === "canvases") {
          return (
            <EmptyScreen
              title="Canvases"
              icon={<GridIcon size={22} stroke="currentColor" />}
              line="Canvases are shared documents that people and agents edit together. Coming soon."
              isNarrow={isNarrow}
              onOpenSidebar={openSidebar}
            />
          );
        }

        if (screen.name === "add-member") {
          return (
            <AddMemberScreen
              channels={channels.data ?? []}
              defaultChannelIds={channelId ? [channelId] : []}
              members={members.data ?? []}
              availableTools={DEFAULT_TOOLS}
              availableModels={availableModels}
              templates={DEFAULT_TEMPLATES}
              plugins={plugins.data ?? []}
              pluginQuery={pluginQuery}
              onPluginQueryChange={setPluginQuery}
              trustedPluginRegistries={workspace.data?.trustedPluginRegistries ?? []}
              importPluginUrlBusy={importPluginUrl.isPending}
              importPluginUrlError={importPluginError}
              onImportPluginUrl={(url) => importPluginUrl.mutate(url)}
              importedAgentDraft={importedAgentDraft}
              onBrowsePlugin={(name, version) => {
                setImportedPlugin(undefined);
                setImportPluginError(undefined);
                setPluginSelection({ name, version });
              }}
              busy={createAgent.isPending || createPerson.isPending || addExistingMember.isPending}
              error={addMemberError}
              onBack={() => {
                setAddMemberError(undefined);
                setScreen({ name: "chat" });
              }}
              onAddExistingMember={(memberId) => {
                if (!channelId) return;
                addExistingMember.mutate({ channelId, memberId });
              }}
              onCreateAgent={(draft) =>
                createAgent.mutate({
                  name: draft.name,
                  handle: draft.handle,
                  roleDescription: draft.roleDescription,
                  colorBg: "#a5e3d6",
                  colorFg: "#005348",
                  config: {
                    instructions: draft.instructions,
                    model: draft.modelId as never,
                    tools: draft.toolNames.map((toolName) => ({ toolName, needsApproval: !!draft.toolApprovalOverrides[toolName] })),
                    triggers: Object.entries(draft.triggerEnabled)
                      .filter(([, on]) => on)
                      .map(([kind]) => ({ kind: kind as never, enabled: true })),
                    dailySpendCapUsd: draft.dailySpendCapUsd,
                    postsInChannelIds: draft.postsInChannelIds as never,
                    skills: draft.skills,
                  },
                })
              }
              onCreatePerson={(draft) =>
                createPerson.mutate({
                  name: draft.fullName,
                  email: draft.email,
                  role: draft.role,
                  channelIds: draft.channelIds as never,
                })
              }
            />
          );
        }

        if (screen.name === "run") {
          if (!run.data) return null;
          const agent = membersById[run.data.run.agentId];
          return (
            <RunDetailScreen
              run={run.data.run}
              steps={run.data.steps}
              agentName={agent?.name ?? "Agent"}
              agentMono={agent?.mono ?? "?"}
              agentBg="#fad0b5"
              agentFg="#6e3500"
              onBack={() => setScreen({ name: "chat" })}
              onRerun={() => {}}
            />
          );
        }

        if (screen.name === "tasks") {
          const fallbackChannelId = channelId ?? groupChannels[0]?.id;
          return (
            <TasksScreen
              tasks={tasks.data ?? []}
              members={members.data ?? []}
              membersById={membersById}
              currentUserId={currentUser.id}
              channelsById={channelsById}
              onOpenRun={(runId) => setScreen({ name: "run", runId })}
              onToggleDone={(taskId, done) => updateTask.mutate({ taskId, status: done ? "done" : "open" })}
              onCreateTask={(input) => {
                if (!fallbackChannelId) return;
                createTask.mutate({
                  channelId: fallbackChannelId,
                  ownerId: input.ownerId ?? currentUser.id,
                  title: input.title,
                  source: input.source ?? "chat",
                  scheduleLabel: input.scheduleLabel,
                  detail: input.detail,
                });
              }}
              onApproveTask={(task) =>
                task.approvalId
                  ? resolveApproval.mutate({ approvalId: task.approvalId, decision: "approved" })
                  : updateTask.mutate({ taskId: task.id, status: "in_progress" })
              }
              onDenyTask={(task) =>
                task.approvalId
                  ? resolveApproval.mutate({ approvalId: task.approvalId, decision: "denied" })
                  : updateTask.mutate({ taskId: task.id, status: "declined" })
              }
              onUpdateAgentTriggers={(agentId, triggers) => updateAgentTriggers.mutate({ memberId: agentId, triggers })}
              isNarrow={isNarrow}
              onOpenSidebar={openSidebar}
            />
          );
        }

        if (screen.name === "agent") {
          const agent = membersById[screen.memberId];
          if (!agent || agent.kind !== "agent") return null;
          return (
            <AgentDetailScreen
              agent={agent}
              busy={publishAgent.isPending}
              error={publishAgent.error?.message}
              published={publishedByAgent[agent.id]}
              availableTools={DEFAULT_TOOLS}
              toolsSaving={updateAgentTools.isPending}
              availableModels={availableModels}
              modelSaving={updateAgentModel.isPending}
              skillsSaving={updateAgentSkills.isPending}
              googleWorkspaceConnection={googleWorkspaceConnection.data}
              googleWorkspaceConnecting={connectGoogleWorkspace.isPending}
              googleWorkspaceDisconnecting={disconnectGoogleWorkspace.isPending}
              googleWorkspaceError={connectGoogleWorkspace.error?.message ?? disconnectGoogleWorkspace.error?.message}
              onBack={() => setScreen({ name: "people" })}
              onPublish={() => publishAgent.mutate({ memberId: agent.id })}
              onSaveTools={(tools) => updateAgentTools.mutate({ memberId: agent.id, tools })}
              onSaveModel={(model) => updateAgentModel.mutate({ memberId: agent.id, model })}
              onSaveSkills={(skills) => updateAgentSkills.mutate({ memberId: agent.id, skills })}
              onConnectGoogleWorkspace={() => connectGoogleWorkspace.mutate(agent.id)}
              onDisconnectGoogleWorkspace={() => disconnectGoogleWorkspace.mutate(agent.id)}
            />
          );
        }

        if (screen.name === "settings" || screen.name === "people") {
          if (!workspace.data) return null;
          return (
            <SettingsScreen
              initialSection={screen.name === "people" ? "people" : "general"}
              workspace={workspace.data}
              members={members.data ?? []}
              spendCapSaving={updateSpendCap.isPending}
              spendCapError={updateSpendCap.error?.message}
              settingsSaving={updateSettings.isPending}
              settingsError={updateSettings.error?.message}
              onSpendCapChange={(usd) => updateSpendCap.mutate({ spendCapUsdPerDay: usd })}
              onApprovalPolicyChange={(policy) => updateSettings.mutate({ approvalPolicy: policy })}
              onLimitsChange={(limits) => updateSettings.mutate(limits)}
              onTrustedRegistriesChange={(hosts) => updateSettings.mutate({ trustedPluginRegistries: hosts })}
              googleWorkspaceStatus={googleWorkspaceStatus.data}
              googleWorkspaceSaving={saveGoogleWorkspaceClient.isPending || clearGoogleWorkspaceClient.isPending}
              googleWorkspaceError={saveGoogleWorkspaceClient.error?.message ?? clearGoogleWorkspaceClient.error?.message}
              onGoogleWorkspaceClientSave={(client) => saveGoogleWorkspaceClient.mutate(client)}
              onGoogleWorkspaceClientClear={() => clearGoogleWorkspaceClient.mutate()}
              onAddPeople={() => setAddModal("people")}
              onOpenMember={(id) => setSelectedMemberId(id)}
              onConfigureAgent={(id) => setScreen({ name: "agent", memberId: id })}
              onDeleteMember={(id) => deleteMember.mutate(id)}
              currentUserId={currentUser.id}
              onSignOut={signOut}
              isNarrow={isNarrow}
              onOpenSidebar={openSidebar}
            />
          );
        }

        if (!activeChannel) return null;
        return (
          <ChatScreen
            channel={activeChannel}
            messages={flatMessages}
            messagesLoading={messages.isPending}
            hasMoreOlder={messages.hasNextPage}
            loadingOlder={messages.isFetchingNextPage}
            onLoadOlder={() => {
              if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
            }}
            membersById={membersById}
            draft={draft}
            onDraftChange={setDraft}
            onSend={(mode) => {
              if (!channelId || !draft.trim()) return;
              // `mode` (ask/edit) isn't sent to the backend yet — sendMessage's input schema has
              // no field for it. Threaded through now so the composer's toggle isn't a dead end;
              // wire it up once the backend has somewhere to put it.
              void mode;
              sendMessage.mutate({ channelId, text: draft, optimisticId: `optimistic-${crypto.randomUUID()}` });
              setDraft("");
            }}
            onApprove={(id) => resolveApproval.mutate({ approvalId: id, decision: "approved" })}
            onDeny={(id) => resolveApproval.mutate({ approvalId: id, decision: "denied" })}
            onToggleReaction={(messageId, emoji) => {
              if (!channelId) return;
              toggleReaction.mutate({ channelId, messageId, emoji });
            }}
            onEditMessage={(messageId, text) => {
              if (!channelId) return;
              editMessage.mutate({ channelId, messageId, text });
            }}
            onDeleteMessage={(messageId) => {
              if (!channelId) return;
              deleteMessage.mutate({ channelId, messageId });
            }}
            onRetryMessage={(messageId, text) => {
              if (!channelId) return;
              patchMessagesCache(queryClient, channelId, (messages) => messages.filter((msg) => msg.id !== messageId));
              sendMessage.mutate({ channelId, text, optimisticId: `optimistic-${crypto.randomUUID()}` });
            }}
            onDismissMessage={(messageId) => {
              if (!channelId) return;
              patchMessagesCache(queryClient, channelId, (messages) => messages.filter((msg) => msg.id !== messageId));
            }}
            currentUserId={currentUser.id}
            onOpenRun={(runId) => setScreen({ name: "run", runId })}
            onAddMember={openAddMember}
            onBrowsePeople={() => setScreen({ name: "people" })}
            agentMessageStyle={agentMessageStyle}
            panelActive={!!selectedMember}
            onTogglePanel={() =>
              setSelectedMemberId((cur) =>
                cur ? undefined : (members.data ?? []).find((m) => m.kind === "agent" && activeChannel.memberIds.includes(m.id))?.id,
              )
            }
            onOpenMember={(id) => setSelectedMemberId(id)}
            onDeleteChannel={(id) => deleteChannel.mutate(id)}
            onEditChannel={(patch) => activeChannel && updateChannel.mutate({ channelId: activeChannel.id, ...patch })}
            onRemoveMember={(memberId) => activeChannel && removeChannelMember.mutate({ channelId: activeChannel.id, memberId })}
            onAddExistingMember={(memberId) => activeChannel && addExistingMember.mutate({ channelId: activeChannel.id, memberId })}
            channelMembers={(members.data ?? []).filter((m) => activeChannel.memberIds.includes(m.id))}
            isNarrow={isNarrow}
            onOpenSidebar={openSidebar}
            openArtifact={openArtifact}
            artifactContent={artifactContent.data}
            artifactLoading={artifactContent.isLoading}
            artifactError={artifactContent.error?.message}
            onOpenArtifact={setOpenArtifact}
            onCloseArtifact={() => setOpenArtifact(undefined)}
          />
        );
      }}
    />
    {addModal && (
      <AddToWorkspaceModal
        tab={addModal}
        onTabChange={setAddModal}
        workspaceName={workspace.data?.name ?? "this workspace"}
        channels={groupChannels}
        members={members.data ?? []}
        currentUserId={currentUser.id}
        ownerName={workspaceOwner?.name}
        busy={createChannel.isPending || createPerson.isPending || createAgent.isPending}
        error={createChannel.error?.message ?? createPerson.error?.message ?? createAgent.error?.message}
        onClose={() => setAddModal(null)}
        onCreateChannel={(name, topic, memberIds) => createChannel.mutate({ name, topic, memberIds })}
        onInvitePeople={(emails, role, channelIds) =>
          emails.forEach((email) =>
            createPerson.mutate({
              name: email.split("@")[0]!.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              email,
              role,
              channelIds,
            }),
          )
        }
        onCreateAgent={(draft) =>
          createAgent.mutate({
            name: draft.name,
            handle: draft.name.trim().toLowerCase().replace(/\s+/g, "-"),
            roleDescription: draft.roleDescription,
            colorBg: "#a5e3d6",
            colorFg: "#005348",
            config: {
              instructions: draft.instructions,
              model: DEFAULT_MODELS[0]!.id as never,
              tools: [],
              triggers: [{ kind: "mention", enabled: true }],
              dailySpendCapUsd: 25,
              postsInChannelIds: draft.channelIds as never,
              skills: [],
            },
          })
        }
        onAdvancedAgentSetup={openAddMember}
      />
    )}
    {isNarrowViewport && selectedMember && (
      <Dialog open onClose={() => setSelectedMemberId(undefined)} title={selectedMember.name} width={420}>
        <ProfileRail
          bare
          member={selectedMember}
          channelName={activeChannel?.kind === "group" ? activeChannel.name : undefined}
          tasks={tasks.data ?? []}
          spendToday={spendByAgentId[selectedMember.id]}
          toolCount={selectedMember.kind === "agent" ? selectedMember.config.tools.length : 0}
          ownerName={workspaceOwner?.name}
          ownedAgents={
            selectedMember.kind === "person" && selectedMember.role === "owner"
              ? agentMembers.map((a) => ({ id: a.id, name: a.name, mono: a.mono, role: a.roleDescription, colorBg: a.colorBg, colorFg: a.colorFg }))
              : []
          }
          onClose={() => setSelectedMemberId(undefined)}
          onMessage={() => openDirectWith(selectedMember.id)}
          onConfigure={() => setScreen({ name: "agent", memberId: selectedMember.id })}
          onOpenAgent={(id) => setSelectedMemberId(id)}
        />
      </Dialog>
    )}
    </>
  );
}

// Only tools with a real Gateway target (see services/agent-runtime/src/mcp-gateways.ts's
// assertHasGatewayTarget and infra/gateway.ts) belong here — granting anything else hard-fails
// every run for that agent before the model is even invoked, since resolveGrantedTools throws on
// an unbacked tool name rather than silently dropping it.
const DEFAULT_TOOLS = [
  { name: "web_search", desc: "Search the web for current information", needsApproval: false },
  { name: "http_fetch", desc: "Read from any URL", needsApproval: false },
  { name: "gmail", desc: "Read and send Gmail from its own connected Google account", needsApproval: false },
  { name: "calendar", desc: "Read and create Google Calendar events from its own connected account", needsApproval: false },
  { name: "browser", desc: "Browse the web, with a recorded session", needsApproval: true },
];

// Fallback only — the real list comes from `GET /models` (services/api/src/routers/models.ts).
// Kept roughly in sync so an offline first paint still shows sensible options.
const DEFAULT_MODELS = [
  { id: "anthropic.claude-3-5-sonnet-20241022-v2:0", name: "Claude 3.5 Sonnet", sub: "Best for most work", provider: "Anthropic" },
  { id: "anthropic.claude-3-opus-20240229-v1:0", name: "Claude 3 Opus", sub: "Highest capability, slower", provider: "Anthropic" },
  { id: "anthropic.claude-3-5-haiku-20241022-v1:0", name: "Claude 3.5 Haiku", sub: "Fast and cheap", provider: "Anthropic" },
  { id: "moonshotai.kimi-k2.5", name: "Kimi K2.5", sub: "Long-context, agentic", provider: "Moonshot AI" },
  { id: "amazon.nova-pro-v1:0", name: "Amazon Nova Pro", sub: "Strong multimodal, mid-cost", provider: "Amazon" },
  { id: "amazon.nova-lite-v1:0", name: "Amazon Nova Lite", sub: "Fast, low-cost multimodal", provider: "Amazon" },
  { id: "amazon.nova-micro-v1:0", name: "Amazon Nova Micro", sub: "Fastest and cheapest, text-only", provider: "Amazon" },
  { id: "meta.llama3-1-70b-instruct-v1:0", name: "Llama 3.1 70B", sub: "Open-weight, balanced", provider: "Meta" },
  { id: "meta.llama3-1-8b-instruct-v1:0", name: "Llama 3.1 8B", sub: "Very fast, very cheap", provider: "Meta" },
  { id: "mistral.mistral-large-2407-v1:0", name: "Mistral Large", sub: "Strong reasoning", provider: "Mistral" },
  { id: "mistral.mistral-small-2402-v1:0", name: "Mistral Small", sub: "Fast and cheap", provider: "Mistral" },
  { id: "cohere.command-r-plus-v1:0", name: "Command R+", sub: "Strong for RAG and tool use", provider: "Cohere" },
];

const DEFAULT_TEMPLATES = [
  { name: "Ops monitor", instructions: "Watch for anomalies and post a summary every morning." },
  { name: "Incident responder", instructions: "Triage incoming alerts, investigate root cause, and propose a fix." },
  { name: "Research assistant", instructions: "Answer questions by researching and citing sources." },
  {
    name: "Google Workspace assistant",
    instructions:
      "Help manage email and calendar: triage inbox, draft replies, and schedule meetings. Only send email or create events when explicitly asked — summarize and propose first otherwise.",
  },
];

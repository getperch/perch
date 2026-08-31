import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { A2uiDocument, Run } from "@perch/core";

/**
 * In-memory stand-in for the DynamoDB document client. `ddb.send` handles the `GetCommand` /
 * `PutCommand` shapes `persist.ts` actually uses; keys are `${pk}${sk}` (a Put with only
 * `{ pk, sk, messageId }` — the A2UI pointer — is stored whole).
 */
const store = new Map<string, Record<string, unknown>>();
const keyOf = (k: { pk: string; sk: string }) => `${k.pk}|${k.sk}`;

const send = vi.fn(async (command: unknown) => {
  if (command instanceof GetCommand) {
    const item = store.get(keyOf(command.input.Key as { pk: string; sk: string }));
    return { Item: item };
  }
  if (command instanceof PutCommand) {
    const item = command.input.Item as { pk: string; sk: string };
    store.set(keyOf(item), item);
    return {};
  }
  throw new Error(`unexpected command: ${(command as { constructor: { name: string } }).constructor.name}`);
});

vi.mock("./db.js", () => ({ ddb: { send: (c: unknown) => send(c) }, TABLE_NAME: "test-table" }));
// `mock`-prefixed so Vitest's hoisted `vi.mock` factory is allowed to close over them.
const mockAppendChannelEvent = vi.fn(async () => "cursor");
const mockEmit = vi.fn(async () => {});
vi.mock("./events.js", () => ({ appendChannelEvent: mockAppendChannelEvent, emit: mockEmit }));

const { attachA2ui } = await import("./persist.js");

const run = {
  id: "run_1",
  workspaceId: "ws_1",
  channelId: "ch_1",
  agentId: "ag_1",
  channelName: "general",
} as unknown as Run;

const document = {
  catalogId: "perch.core",
  version: 1,
  root: "root",
  components: [{ id: "root", type: "Text", props: { text: "hello", tone: "default", weight: "regular" } }],
} as unknown as A2uiDocument;

const messagesInChannel = () =>
  [...store.values()].filter((v) => String(v.pk).startsWith("CHANNEL#") && String(v.sk).startsWith("MSG#"));

beforeEach(() => {
  store.clear();
  send.mockClear();
  mockAppendChannelEvent.mockClear();
  mockEmit.mockClear();
});

describe("attachA2ui", () => {
  it("creates one message and a pointer on first call", async () => {
    const msg = await attachA2ui({ run, renderKey: "tool_use_abc", document });

    expect(messagesInChannel()).toHaveLength(1);
    expect(msg.a2ui).toEqual(document);
    expect(store.get(`RUN#run_1|A2UI#tool_use_abc`)).toMatchObject({ messageId: msg.id });
    expect(mockAppendChannelEvent).toHaveBeenCalledWith("ch_1", expect.objectContaining({ type: "message.created" }));
  });

  it("is idempotent across a workflow replay — same renderKey updates in place, no second message", async () => {
    const first = await attachA2ui({ run, renderKey: "tool_use_abc", document });
    const replayed = await attachA2ui({ run, renderKey: "tool_use_abc", document });

    expect(replayed.id).toBe(first.id);
    expect(messagesInChannel()).toHaveLength(1);
    expect(mockAppendChannelEvent).toHaveBeenLastCalledWith("ch_1", expect.objectContaining({ type: "message.updated" }));
  });

  it("updates the stored card when the same call re-renders a revised document", async () => {
    const first = await attachA2ui({ run, renderKey: "tool_use_abc", document });
    const revised = {
      ...document,
      components: [{ id: "root", type: "Text", props: { text: "goodbye", tone: "default", weight: "regular" } }],
    } as unknown as A2uiDocument;

    const after = await attachA2ui({ run, renderKey: "tool_use_abc", document: revised });

    expect(after.id).toBe(first.id);
    expect(messagesInChannel()).toHaveLength(1);
    expect(messagesInChannel()[0]!.message).toMatchObject({ a2ui: revised });
  });

  it("posts distinct messages for distinct render calls in the same run", async () => {
    await attachA2ui({ run, renderKey: "tool_use_1", document });
    await attachA2ui({ run, renderKey: "tool_use_2", document });

    expect(messagesInChannel()).toHaveLength(2);
  });

  it("with an updateKey, a later run updates the same card in place (channel-scoped pointer)", async () => {
    const first = await attachA2ui({ run, renderKey: "tool_use_1", updateKey: "deploy-status", document });
    // A follow-up action is a NEW run — different runId, different toolUseId.
    const laterRun = { ...run, id: "run_2" } as unknown as Run;
    const revised = {
      ...document,
      components: [{ id: "root", type: "Text", props: { text: "done", tone: "default", weight: "regular" } }],
    } as unknown as A2uiDocument;

    const after = await attachA2ui({ run: laterRun, renderKey: "tool_use_9", updateKey: "deploy-status", document: revised });

    expect(after.id).toBe(first.id);
    expect(messagesInChannel()).toHaveLength(1);
    expect(messagesInChannel()[0]!.message).toMatchObject({ a2ui: revised });
    expect(store.get(`CHANNEL#ch_1|A2UIKEY#ag_1#deploy-status`)).toMatchObject({ messageId: first.id });
  });

  it("scopes updateKey cards per agent — a different agent's same key is a separate card", async () => {
    const a = await attachA2ui({ run, renderKey: "t1", updateKey: "status", document });
    const otherAgent = { ...run, id: "run_2", agentId: "ag_2" } as unknown as Run;
    const b = await attachA2ui({ run: otherAgent, renderKey: "t2", updateKey: "status", document });

    expect(b.id).not.toBe(a.id);
    expect(messagesInChannel()).toHaveLength(2);
  });
});

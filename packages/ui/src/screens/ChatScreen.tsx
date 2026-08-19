import { useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import EmojiPicker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import type { ArtifactRef, Channel, Member, Message } from "@fizz/core";
import { Avatar } from "../primitives/Avatar.js";
import { Button } from "../primitives/Button.js";
import { AgentBadge } from "../primitives/AgentBadge.js";
import { Markdown } from "../primitives/Markdown.js";
import { CodeBlock } from "../primitives/CodeBlock.js";
import { Dialog } from "../primitives/Dialog.js";
import { ConfirmDialog } from "../primitives/ConfirmDialog.js";
import { Spinner } from "../primitives/Spinner.js";
import { useResizable } from "../hooks/useResizable.js";
import {
  AlertIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  DocumentIcon,
  DotsIcon,
  EditIcon,
  HandoffIcon,
  LinkIcon,
  MenuIcon,
  PanelIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SmileIcon,
  TrashIcon,
} from "../icons.js";
import { color, font, radius } from "../tokens.js";
import { mentionTokenFor, monoFor, paletteFor, relativeTime } from "../utils.js";

export function ChatScreen({
  channel,
  messages,
  messagesLoading,
  hasMoreOlder,
  loadingOlder,
  onLoadOlder,
  membersById,
  draft,
  onDraftChange,
  onSend,
  onApprove,
  onDeny,
  onOpenRun,
  onAddMember,
  onBrowsePeople,
  agentMessageStyle,
  panelActive,
  onTogglePanel,
  onOpenMember,
  onDeleteChannel,
  onEditChannel,
  onRemoveMember,
  onAddExistingMember,
  channelMembers,
  isNarrow,
  onOpenSidebar,
  onToggleReaction,
  onEditMessage,
  onDeleteMessage,
  onRetryMessage,
  onDismissMessage,
  currentUserId,
  openArtifact,
  artifactContent,
  artifactLoading,
  artifactError,
  onOpenArtifact,
  onCloseArtifact,
}: {
  channel: Channel;
  messages: Message[];
  messagesLoading?: boolean;
  hasMoreOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  membersById: Record<string, Member>;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (mode?: "ask" | "edit") => void;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
  onOpenRun: (runId: string) => void;
  onAddMember: () => void;
  onBrowsePeople: () => void;
  /** "tinted": agent messages sit in a light card. "flat": rendered inline like a person's. */
  agentMessageStyle: "tinted" | "flat";
  /** Whether the right-hand profile rail is currently showing (drives the header toggle's look). */
  panelActive: boolean;
  onTogglePanel: () => void;
  onOpenMember: (memberId: string) => void;
  /** Delete this (group) channel — omit to hide the action. */
  onDeleteChannel?: (channelId: string) => void;
  /** Edit this (group) channel's name / goal — omit to hide the action. */
  onEditChannel?: (patch: { name?: string; topic?: string }) => void;
  /** Remove a member from this (group) channel — omit to hide the per-member remove action. */
  onRemoveMember?: (memberId: string) => void;
  /** Add an existing workspace member to this (group) channel — omit to hide the inline picker. */
  onAddExistingMember?: (memberId: string) => void;
  channelMembers: Member[];
  isNarrow: boolean;
  onOpenSidebar?: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onEditMessage: (messageId: string, text: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onRetryMessage: (messageId: string, text: string) => void;
  onDismissMessage: (messageId: string) => void;
  currentUserId: string;
  openArtifact?: ArtifactRef;
  artifactContent?: string;
  artifactLoading?: boolean;
  artifactError?: string;
  onOpenArtifact: (artifact: ArtifactRef) => void;
  onCloseArtifact: () => void;
}) {
  const isEmpty = !messagesLoading && messages.length === 0 && channel.kind === "group";
  const isEmptyDirect = !messagesLoading && messages.length === 0 && channel.kind === "direct";
  const groupFlags = useMemo(() => computeGroupFlags(messages), [messages]);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [confirmDeleteChannel, setConfirmDeleteChannel] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [editChannel, setEditChannel] = useState<{ name: string; topic: string } | null>(null);
  const artifactResize = useResizable({ storageKey: "ws-artifact-panel-width", defaultSize: 480, minSize: 320, maxSize: 720 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScroll = useRef({ channelId: channel.id, scrollHeight: 0, scrollTop: 0, clientHeight: 0, count: 0, firstId: undefined as string | undefined });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevScroll.current;

    if (prev.channelId !== channel.id) {
      el.scrollTop = el.scrollHeight;
    } else if (messages.length > prev.count && messages[0]?.id !== prev.firstId) {
      el.scrollTop = prev.scrollTop + (el.scrollHeight - prev.scrollHeight);
    } else if (messages.length > prev.count) {
      const wasNearBottom = prev.scrollHeight - prev.scrollTop - prev.clientHeight < 120;
      if (wasNearBottom) el.scrollTop = el.scrollHeight;
    }

    prevScroll.current = {
      channelId: channel.id,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      count: messages.length,
      firstId: messages[0]?.id,
    };
  });

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    prevScroll.current.scrollTop = el.scrollTop;
    if (el.scrollTop < 120 && hasMoreOlder && !loadingOlder) onLoadOlder?.();
  };

  const agentsInChannel = channelMembers.filter((m) => m.kind === "agent");
  const memberStack = channelMembers.slice(0, 3);
  const addableMembers = useMemo(() => {
    if (!onAddExistingMember) return [];
    const inChannel = new Set(channelMembers.map((m) => m.id));
    return Object.values(membersById)
      .filter((m) => !inChannel.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [onAddExistingMember, channelMembers, membersById]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header
        style={{
          height: 56,
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 18px",
          borderBottom: `1px solid ${color.borderLight}`,
        }}
      >
        {isNarrow ? (
          <button onClick={onOpenSidebar} className="ws-hoverable" style={iconBtn}>
            <MenuIcon />
          </button>
        ) : null}
        <div style={{ display: "flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 17, color: color.mutedLight }}>#</span>
          <h1 style={{ margin: 0, fontSize: 15.5, fontWeight: 600 }}>{channel.name}</h1>
        </div>
        {channel.topic ? (
          <>
            <span style={{ width: 1, height: 18, background: color.borderStrong, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: color.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channel.topic}</span>
          </>
        ) : null}
        <span style={{ flex: 1 }} />
        {!isNarrow && (
          <>
            {channelMembers.length > 0 && (
              <button
                onClick={() => (channel.kind === "group" ? setRosterOpen(true) : memberStack[0] && onOpenMember(memberStack[0].id))}
                title={channel.kind === "group" ? "Channel members" : undefined}
                style={{ ...metaChip, cursor: "pointer", paddingLeft: 5 }}
              >
                <span style={{ display: "flex" }}>
                  {memberStack.map((m, i) => {
                    const pal = paletteFor(m.id);
                    return (
                      <span key={m.id} style={{ marginLeft: i ? -7 : 0, borderRadius: radius.pill, border: `1.5px solid ${color.surface}` }}>
                        <Avatar mono={m.mono} bg={pal.bg} fg={pal.fg} size={20} square={m.kind === "agent"} />
                      </span>
                    );
                  })}
                </span>
                {channelMembers.length}
              </button>
            )}
            <button className="ws-hoverable" style={iconBtn} title="Search">
              <SearchIcon size={16} stroke={color.muted} />
            </button>
          </>
        )}
        {channel.kind === "group" && (onEditChannel || onDeleteChannel) && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setHeaderMenuOpen((v) => !v)} onBlur={() => setTimeout(() => setHeaderMenuOpen(false), 120)} className="ws-hoverable" style={iconBtn} title="Channel options">
              <DotsIcon size={16} stroke={color.muted} />
            </button>
            {headerMenuOpen && (
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, width: 180, background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.md, boxShadow: "0 8px 24px #00000026", padding: 4, zIndex: 20 }}>
                {onEditChannel && (
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setHeaderMenuOpen(false);
                      setEditChannel({ name: channel.name, topic: channel.topic ?? "" });
                    }}
                    className="ws-hoverable"
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 30, padding: "0 8px", background: "transparent", border: "none", borderRadius: radius.sm, cursor: "pointer", fontSize: 13, color: color.ink, textAlign: "left" }}
                  >
                    <EditIcon size={13} />
                    Edit channel
                  </button>
                )}
                {onDeleteChannel && (
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setHeaderMenuOpen(false);
                      setConfirmDeleteChannel(true);
                    }}
                    className="ws-hoverable"
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 30, padding: "0 8px", background: "transparent", border: "none", borderRadius: radius.sm, cursor: "pointer", fontSize: 13, color: color.statusDeclinedFg, textAlign: "left" }}
                  >
                    <TrashIcon size={13} stroke={color.statusDeclinedFg} />
                    Delete channel
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <button
          onClick={onTogglePanel}
          className="ws-hoverable"
          title="Toggle panel"
          style={{ ...iconBtn, color: panelActive ? color.accentText : color.muted, background: panelActive ? color.accentTint : "transparent" }}
        >
          <PanelIcon stroke={panelActive ? color.accentText : color.muted} />
        </button>
      </header>

      {onDeleteChannel && (
        <ConfirmDialog
          open={confirmDeleteChannel}
          title={`Delete #${channel.name}?`}
          message="Its messages are removed too. This can't be undone."
          confirmLabel="Delete channel"
          onConfirm={() => onDeleteChannel(channel.id)}
          onClose={() => setConfirmDeleteChannel(false)}
        />
      )}

      <Dialog open={rosterOpen} onClose={() => setRosterOpen(false)} title={`Members · #${channel.name}`} width={420}>
        <div style={{ padding: 8 }}>
          {channelMembers.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: color.mutedLight }}>No one's in this channel yet.</div>
          )}
          {channelMembers.map((m) => {
            const pal = paletteFor(m.id);
            const canRemove = onRemoveMember && m.id !== currentUserId;
            return (
              <div key={m.id} className="ws-hoverable" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px", borderRadius: radius.md }}>
                <button
                  onClick={() => {
                    setRosterOpen(false);
                    onOpenMember(m.id);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <Avatar mono={m.mono} bg={pal.bg} fg={pal.fg} size={26} square={m.kind === "agent"} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                      {m.kind === "agent" && <AgentBadge />}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {m.kind === "agent" ? m.roleDescription : m.email}
                    </span>
                  </span>
                </button>
                {canRemove && (
                  <button
                    onClick={() => onRemoveMember!(m.id)}
                    className="ws-hoverable"
                    title={`Remove ${m.name} from #${channel.name}`}
                    style={{ flex: "none", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: 6, cursor: "pointer" }}
                  >
                    <CloseIcon size={13} stroke={color.mutedLight} />
                  </button>
                )}
              </div>
            );
          })}
          {addableMembers.length > 0 && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${color.borderLight}` }}>
              <div style={{ font: `600 11px ${font.sans}`, letterSpacing: "0.04em", textTransform: "uppercase", color: color.mutedLight, padding: "4px 8px" }}>
                Not in this channel
              </div>
              {addableMembers.map((m) => {
                const pal = paletteFor(m.id);
                return (
                  <div key={m.id} className="ws-hoverable" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px", borderRadius: radius.md }}>
                    <Avatar mono={m.mono} bg={pal.bg} fg={pal.fg} size={26} square={m.kind === "agent"} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                        {m.kind === "agent" && <AgentBadge />}
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {m.kind === "agent" ? m.roleDescription : m.email}
                      </span>
                    </span>
                    <button
                      onClick={() => onAddExistingMember!(m.id)}
                      className="ws-hoverable"
                      style={{ flex: "none", height: 26, padding: "0 10px", background: color.accentTint, color: color.accentText, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                    >
                      Add
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <button
            onClick={() => {
              setRosterOpen(false);
              onAddMember();
            }}
            className="ws-hoverable"
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 4, padding: "9px 8px", background: "none", border: "none", borderRadius: radius.md, cursor: "pointer", fontSize: 13, fontWeight: 500, color: color.accentText, textAlign: "left" }}
          >
            <PlusIcon size={14} stroke={color.accentText} />
            Invite someone new
          </button>
        </div>
      </Dialog>

      {onEditChannel && editChannel && (
        <Dialog open onClose={() => setEditChannel(null)} title={`Edit #${channel.name}`} width={440}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = editChannel.name.trim();
              if (!name) return;
              onEditChannel({ name, topic: editChannel.topic.trim() });
              setEditChannel(null);
            }}
            style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ font: `500 12px ${font.sans}`, color: color.mutedDark }}>Name</span>
              <input
                value={editChannel.name}
                onChange={(e) => setEditChannel((s) => (s ? { ...s, name: e.target.value } : s))}
                autoFocus
                style={{ height: 34, padding: "0 10px", borderRadius: radius.md, border: `1px solid ${color.borderStrong}`, font: `400 13.5px ${font.sans}`, color: color.ink, outline: "none" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ font: `500 12px ${font.sans}`, color: color.mutedDark }}>Goal</span>
              <textarea
                value={editChannel.topic}
                onChange={(e) => setEditChannel((s) => (s ? { ...s, topic: e.target.value } : s))}
                rows={3}
                placeholder="What this channel is for — agents in it are told this."
                style={{ padding: "8px 10px", borderRadius: radius.md, border: `1px solid ${color.borderStrong}`, font: `400 13.5px ${font.sans}`, color: color.ink, outline: "none", resize: "vertical" }}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setEditChannel(null)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                Save
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {messagesLoading ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Spinner size={18} />
            </div>
          ) : isEmpty ? (
            <EmptyChannel name={channel.name} onAddMember={onAddMember} onBrowsePeople={onBrowsePeople} />
          ) : isEmptyDirect ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 40 }}>
              <Avatar mono={monoFor(channel.name)} bg={color.avatarNeutralBg} fg={color.avatarNeutralFg} size={40} />
              <div style={{ fontSize: 15, fontWeight: 600, marginTop: 6 }}>{channel.name}</div>
              <div style={{ fontSize: 13, color: color.mutedDark, textAlign: "center", maxWidth: 380, lineHeight: 1.5 }}>This is the start of your conversation.</div>
            </div>
          ) : (
            <div ref={scrollRef} onScroll={handleScroll} className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 0 8px" }}>
              {loadingOlder ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 16px" }}>
                  <Spinner size={14} />
                </div>
              ) : null}
              <div style={{ maxWidth: 820, padding: "0 26px" }}>
                {messages.map((m, i) => (
                  <MessageRow
                    key={m.id}
                    message={m}
                    author={m.authorId ? membersById[m.authorId] : undefined}
                    channelMembers={channelMembers}
                    agentMessageStyle={agentMessageStyle}
                    onApprove={onApprove}
                    onDeny={onDeny}
                    onOpenRun={onOpenRun}
                    onOpenMember={onOpenMember}
                    onToggleReaction={onToggleReaction}
                    onEditMessage={onEditMessage}
                    onDeleteMessage={onDeleteMessage}
                    onRetryMessage={onRetryMessage}
                    onDismissMessage={onDismissMessage}
                    onOpenArtifact={onOpenArtifact}
                    isOwn={m.authorId === currentUserId}
                    isGroupStart={groupFlags[i]!.isGroupStart}
                    isGroupEnd={groupFlags[i]!.isGroupEnd}
                  />
                ))}
              </div>
            </div>
          )}

          <Composer draft={draft} onDraftChange={onDraftChange} onSend={onSend} channelMembers={channelMembers} hasAgents={agentsInChannel.length > 0} />
        </div>

        {openArtifact && !isNarrow ? (
          <>
            <div onMouseDown={artifactResize.onMouseDownResize} style={{ width: 5, flex: "none", cursor: "col-resize", background: "transparent" }} />
            <div style={{ width: artifactResize.size, flex: "none", height: "100%", borderLeft: `1px solid ${color.border}` }}>
              <ArtifactPanel artifact={openArtifact} content={artifactContent} loading={artifactLoading} error={artifactError} onClose={onCloseArtifact} />
            </div>
          </>
        ) : null}
      </div>

      {isNarrow && (
        <Dialog open={!!openArtifact} onClose={onCloseArtifact} title={openArtifact?.name} width={640}>
          {openArtifact && <ArtifactPanel artifact={openArtifact} content={artifactContent} loading={artifactLoading} error={artifactError} onClose={onCloseArtifact} bare />}
        </Dialog>
      )}
    </div>
  );
}

function EmptyChannel({ name, onAddMember, onBrowsePeople }: { name: string; onAddMember: () => void; onBrowsePeople: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 40 }}>
      <div style={{ width: 52, height: 52, borderRadius: radius.xl, background: color.surfaceMuted, border: `1px solid ${color.border}`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, color: color.muted }}>
        <BotIcon size={22} stroke={color.muted} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 600 }}>No one is in #{name} yet</div>
      <div style={{ fontSize: 14, color: color.mutedDark, textAlign: "center", maxWidth: 380, lineHeight: 1.5 }}>
        Add an agent to give this channel a job. Agents post here on a schedule, on a trigger, or when you @mention them.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Button variant="primary" onClick={onAddMember}>Add a member</Button>
        <Button variant="secondary" onClick={onBrowsePeople}>Browse people</Button>
      </div>
    </div>
  );
}

function ArtifactPanel({
  artifact,
  content,
  loading,
  error,
  onClose,
  bare,
}: {
  artifact: ArtifactRef;
  content?: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  bare?: boolean;
}) {
  const isMarkdown = ["md", "markdown", "txt"].includes(artifact.ext.toLowerCase());
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: color.surface }}>
      {!bare && (
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, height: 48, padding: "0 14px", borderBottom: `1px solid ${color.border}` }}>
          <DocumentIcon size={15} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{artifact.name}</div>
            <div style={{ fontSize: 11, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{artifact.meta}</div>
          </div>
          <button onClick={onClose} className="ws-hoverable" title="Close" style={{ width: 26, height: 26, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: radius.md, cursor: "pointer" }}>
            <CloseIcon />
          </button>
        </div>
      )}
      <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: color.mutedLight, fontSize: 13 }}>
            <Spinner size={12} /> Loading…
          </div>
        ) : error ? (
          <div style={{ fontSize: 13, color: color.statusDeclinedFg }}>{error}</div>
        ) : content == null ? null : isMarkdown ? (
          <Markdown>{content}</Markdown>
        ) : (
          <CodeBlock code={content} lang={artifact.ext} />
        )}
      </div>
    </div>
  );
}

function ReactionGlyph({ emoji, size = 14 }: { emoji: string; size?: number }) {
  // Reactions are stored as their native unicode character (from the emoji-mart picker), so this
  // is just a sized text span — the wrapper stays so call sites don't have to special-case
  // line-height/rendering of a bare emoji.
  return <span style={{ fontSize: size, lineHeight: 1 }}>{emoji}</span>;
}

function SourcesBubble({ citations }: { citations: Message["citations"] }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ marginTop: 8, position: "relative", display: "inline-block" }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 24,
          padding: "0 10px",
          border: `1px solid ${color.border}`,
          borderRadius: radius.pill,
          background: color.surface,
          fontSize: 12,
          fontWeight: 600,
          color: color.mutedDark,
          cursor: "default",
        }}
      >
        {citations.length === 1 ? "1 source" : `${citations.length} sources`}
      </span>
      {hovered && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 10, minWidth: 240, maxWidth: 360, border: `1px solid ${color.border}`, borderRadius: radius.lg, background: color.surface, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", padding: 6 }}>
          {citations.map((c) => (
            <a key={c.n} href={c.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 8px", borderRadius: radius.md, textDecoration: "none", color: "inherit" }} className="ws-hoverable">
              <span style={{ flex: "none", width: 15, height: 15, marginTop: 1, borderRadius: radius.pill, background: color.surfaceMuted, display: "flex", alignItems: "center", justifyContent: "center", font: `600 10px ${font.mono}`, color: color.mutedDark }}>{c.n}</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: color.ink }}>{c.label}</div>
                {c.url && <div style={{ fontSize: 11, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.url}</div>}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function computeGroupFlags(messages: Message[]): { isGroupStart: boolean; isGroupEnd: boolean }[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const groupsWith = (a?: Message, b?: Message) =>
      a != null && b != null && !a.isSystem && !b.isSystem && a.authorId === b.authorId && Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) <= GROUP_WINDOW_MS;
    return {
      isGroupStart: m.isSystem || !groupsWith(prev, m),
      isGroupEnd: m.isSystem || !groupsWith(m, next),
    };
  });
}

function MessageRow({
  message: m,
  author,
  channelMembers,
  agentMessageStyle,
  onApprove,
  onDeny,
  onOpenRun,
  onOpenMember,
  onToggleReaction,
  onEditMessage,
  onDeleteMessage,
  onRetryMessage,
  onDismissMessage,
  onOpenArtifact,
  isOwn,
  isGroupStart,
  isGroupEnd,
}: {
  message: Message;
  author?: Member;
  channelMembers: Member[];
  agentMessageStyle: "tinted" | "flat";
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onOpenRun: (id: string) => void;
  onOpenMember: (id: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onEditMessage: (messageId: string, text: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onRetryMessage: (messageId: string, text: string) => void;
  onDismissMessage: (messageId: string) => void;
  onOpenArtifact: (artifact: ArtifactRef) => void;
  isOwn: boolean;
  isGroupStart: boolean;
  isGroupEnd: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(m.text ?? "");

  if (m.isSystem) {
    const isHandoff = /hand(ed)? ?off/i.test(m.text ?? "");
    if (isHandoff) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0 18px 46px" }}>
          <HandoffIcon size={15} />
          <span style={{ fontSize: 12.5, color: color.muted }}>{m.text}</span>
          <span style={{ font: `400 11.5px ${font.mono}`, color: color.mutedLight }}>{relativeTime(m.createdAt)}</span>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0 20px" }}>
        <div style={{ flex: 1, height: 1, background: color.borderLight }} />
        <span style={{ fontSize: 11.5, fontWeight: 500, color: color.mutedLight, padding: "3px 10px", border: `1px solid ${color.border}`, borderRadius: 20, whiteSpace: "nowrap" }}>{m.text}</span>
        <div style={{ flex: 1, height: 1, background: color.borderLight }} />
      </div>
    );
  }

  const pal = author ? paletteFor(author.id) : paletteFor("unknown");
  const isAgent = author?.kind === "agent";
  const isPending = m.id.startsWith("optimistic-");
  const isFailed = m.id.startsWith("failed-");
  const tinted = isAgent && agentMessageStyle === "tinted";

  function startEdit() {
    setEditDraft(m.text ?? "");
    setEditing(true);
  }
  function commitEdit() {
    const text = editDraft.trim();
    setEditing(false);
    if (text && text !== m.text) onEditMessage(m.id, text);
  }

  const body = m.text
    ? isAgent
      ? <Markdown>{m.text}</Markdown>
      : <div style={{ fontSize: 14, lineHeight: 1.55, color: color.ink, whiteSpace: "pre-wrap" }}>{renderMessageText(m.text, channelMembers)}</div>
    : null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPickerOpen(false);
      }}
      style={{ display: "flex", gap: 12, padding: `${isGroupStart ? 8 : 2}px 0 ${isGroupEnd ? 12 : 2}px`, position: "relative", opacity: isPending ? 0.6 : 1 }}
    >
      {isGroupStart ? (
        <button onClick={() => author && onOpenMember(author.id)} style={{ flex: "0 0 34px", height: 34, padding: 0, border: "none", background: "none", cursor: author ? "pointer" : "default" }}>
          <Avatar mono={author ? author.mono : "?"} bg={pal.bg} fg={pal.fg} size={34} square={isAgent} />
        </button>
      ) : (
        <span style={{ width: 34, flex: "none" }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {isGroupStart && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <button onClick={() => author && onOpenMember(author.id)} className="ws-hoverable" style={{ fontSize: 14, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: author ? "pointer" : "default", borderRadius: 3 }}>
              {author?.name ?? "Unknown"}
            </button>
            {isAgent && <AgentBadge />}
            {isPending ? (
              <span style={{ fontSize: 12, color: color.mutedLight, display: "flex", alignItems: "center", gap: 4 }}>
                <Spinner size={8} /> Sending…
              </span>
            ) : (
              <span style={{ font: `400 11.5px ${font.mono}`, color: color.mutedLight }}>{relativeTime(m.createdAt)}</span>
            )}
            {m.editedAt && <span style={{ font: `400 11.5px ${font.mono}`, color: color.mutedLight }}>(edited)</span>}
          </div>
        )}

        {isFailed && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: color.statusDeclinedFg, display: "flex", alignItems: "center", gap: 4 }}>
              <AlertIcon size={11} stroke={color.statusDeclinedFg} /> Failed to send
            </span>
            <button onClick={() => onRetryMessage(m.id, m.text ?? "")} style={linkBtn}>Retry</button>
            <button onClick={() => onDismissMessage(m.id)} style={{ ...linkBtn, color: color.mutedLight }}>Dismiss</button>
          </div>
        )}

        {m.deletedAt ? (
          <div style={{ fontSize: 14, lineHeight: 1.55, color: color.mutedLight, fontStyle: "italic" }}>Message deleted</div>
        ) : editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={commitEdit}
              style={{ width: "100%", height: 32, border: `1px solid ${color.borderStrong}`, borderRadius: radius.md, padding: "0 10px", font: `400 14px ${font.sans}`, color: color.ink, background: color.surface, outline: "none" }}
            />
            <span style={{ fontSize: 11, color: color.mutedLight }}>Enter to save, Escape to cancel</span>
          </div>
        ) : tinted && body ? (
          <div style={{ background: color.tint, border: `1px solid #EEEBF9`, borderRadius: 9, padding: "9px 12px" }}>{body}</div>
        ) : (
          body
        )}

        {m.reactions.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {groupReactions(m.reactions).map(([emoji, count]) => (
              <button key={emoji} onClick={() => onToggleReaction(m.id, emoji)} className="ws-hoverable" style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 8px", background: color.surfaceMuted, border: `1px solid ${color.border}`, borderRadius: radius.pill, fontSize: 12, cursor: "pointer" }}>
                <ReactionGlyph emoji={emoji} size={12} />
                <span style={{ fontWeight: 600, color: color.mutedDark }}>{count}</span>
              </button>
            ))}
          </div>
        )}

        {m.tools.length > 0 && <AutonomousRunCard tools={m.tools} />}

        {m.artifact && (
          <button onClick={() => onOpenArtifact(m.artifact!)} className="ws-hoverable" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, width: "100%", border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: 12, background: color.surface, cursor: "pointer", textAlign: "left" }}>
            <div style={{ width: 32, height: 32, flex: "none", borderRadius: radius.md, background: color.surfaceMuted, display: "flex", alignItems: "center", justifyContent: "center", font: `600 10px ${font.mono}`, color: color.mutedDark }}>{m.artifact.ext}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.artifact.name}</div>
              <div style={{ fontSize: 12, color: color.muted }}>{m.artifact.meta}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: color.mutedDark }}>Open</span>
          </button>
        )}

        {m.approval && <PermissionCard approval={m.approval} onApprove={onApprove} onDeny={onDeny} />}

        {m.citations.length > 0 && <SourcesBubble citations={m.citations} />}

        {m.runId && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => onOpenRun(m.runId!)} style={linkBtn}>View run</button>
          </div>
        )}
      </div>

      {hovered && !m.deletedAt && !editing && !isPending && !isFailed && (
        <div style={{ position: "absolute", top: 0, right: 0, display: "flex", alignItems: "center", background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.md, boxShadow: "0 2px 8px #00000014" }}>
          <div style={{ position: "relative" }}>
            <button onClick={() => setPickerOpen((v) => !v)} className="ws-hoverable" style={rowIconBtn} title="Add reaction">
              <SmileIcon />
            </button>
            {pickerOpen && (
              <>
                <div onClick={() => setPickerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
                <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 11 }}>
                  <EmojiPicker
                    data={emojiData}
                    onEmojiSelect={(emoji: { native?: string }) => {
                      if (emoji.native) onToggleReaction(m.id, emoji.native);
                      setPickerOpen(false);
                    }}
                    theme="light"
                    previewPosition="none"
                    skinTonePosition="none"
                    maxFrequentRows={2}
                    navPosition="bottom"
                  />
                </div>
              </>
            )}
          </div>
          {isOwn && (
            <>
              <button onClick={startEdit} className="ws-hoverable" style={rowIconBtn} title="Edit message">
                <EditIcon />
              </button>
              <button onClick={() => setConfirmDelete(true)} className="ws-hoverable" style={rowIconBtn} title="Delete message">
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this message?"
        message="This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => onDeleteMessage(m.id)}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function AutonomousRunCard({ tools }: { tools: Message["tools"] }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginTop: 10, border: `1px solid #E9E7EF`, borderRadius: radius.lg, overflow: "hidden" }}>
      <button onClick={() => setOpen((v) => !v)} className="ws-hoverable" style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: color.surfaceMuted, border: "none", borderBottom: open ? `1px solid ${color.borderLight}` : "none", cursor: "pointer", textAlign: "left" }}>
        <CheckIcon size={12} stroke={color.live} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>Ran {tools.length} tool{tools.length > 1 ? "s" : ""}</span>
        <span style={{ font: `400 11px ${font.mono}`, color: color.mutedLight }}>auto-approved</span>
        <ChevronDownIcon size={12} style={{ transform: open ? undefined : "rotate(-90deg)", transition: "transform .1s" }} />
      </button>
      {open && (
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {tools.map((t, i) => (
              <span key={i} style={{ font: `400 11.5px ${font.mono}`, color: color.mutedDark, background: color.surfaceMuted, border: `1px solid ${color.border}`, padding: "3px 7px", borderRadius: 6 }}>
                {t.name}
              </span>
            ))}
          </div>
          {tools.some((t) => t.arg) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {tools.filter((t) => t.arg).map((t, i) => (
                <div key={i} style={{ font: `400 11.5px ${font.mono}`, color: color.mutedLight, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.name} · {t.arg} · {t.ms}ms
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PermissionCard({
  approval,
  onApprove,
  onDeny,
}: {
  approval: NonNullable<Message["approval"]>;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [alwaysAllowed, setAlwaysAllowed] = useState(false);
  const toolName = deriveToolName(approval.title);

  return (
    <div style={{ marginTop: 10, border: `1px solid ${color.approvalBorder}`, borderRadius: radius.lg, overflow: "hidden", boxShadow: "0 1px 2px rgba(23,20,42,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", background: color.approvalBg, flexWrap: "wrap" }}>
        <LinkIcon size={15} stroke={color.approvalFg} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>Permission requested</span>
        {toolName && <span style={{ font: `400 12px ${font.mono}`, color: color.approvalFg, background: color.agentTagBg, border: `1px solid ${color.agentTagBorder}`, padding: "2px 6px", borderRadius: 5 }}>{toolName}</span>}
      </div>
      <div style={{ padding: "0 13px 12px", fontSize: 13, color: color.mutedDark, lineHeight: 1.55 }}>{approval.detail}</div>

      {approval.detail.length > 80 && (
        <div style={{ padding: "0 13px 12px" }}>
          <button onClick={() => setPayloadOpen((v) => !v)} className="ws-hoverable" style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", border: `1px solid ${color.border}`, borderRadius: 7, cursor: "pointer", fontSize: 12.5, color: color.mutedDark, background: color.surface }}>
            <ChevronDownIcon size={12} style={{ transform: payloadOpen ? "rotate(180deg)" : undefined }} />
            {payloadOpen ? "Hide details" : "Show details"}
          </button>
        </div>
      )}
      {payloadOpen && (
        <pre style={{ margin: "0 13px 12px", padding: "11px 12px", background: color.surfaceMuted, border: `1px solid ${color.borderLight}`, borderRadius: 9, font: `400 12px/1.6 ${font.mono}`, color: color.mutedDark, whiteSpace: "pre-wrap", overflowX: "auto" }}>
          {approval.detail}
        </pre>
      )}

      {approval.status === "pending" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", borderTop: `1px solid ${color.borderLight}`, background: color.approvalBg, flexWrap: "wrap" }}>
          <Button variant="primary" onClick={() => onApprove(approval.approvalId)}>Approve once</Button>
          <Button variant="secondary" onClick={() => { setAlwaysAllowed(true); onApprove(approval.approvalId); }}>Always allow in this channel</Button>
          <span style={{ flex: 1 }} />
          <button onClick={() => onDeny(approval.approvalId)} className="ws-hoverable" style={{ height: 32, padding: "0 12px", borderRadius: radius.md, border: "none", background: "transparent", color: color.muted, fontSize: 13, cursor: "pointer" }}>
            Deny
          </button>
        </div>
      ) : approval.status === "approved" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px", borderTop: `1px solid ${color.borderLight}`, background: color.statusDoneBg }}>
          <CheckIcon size={13} stroke={color.statusDoneFg} />
          <span style={{ fontSize: 12.5, color: color.statusDoneFg, fontWeight: 500 }}>
            {alwaysAllowed && toolName ? `Approved — ${toolName} is now allowed in this channel` : "Approved by you"}
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", borderTop: `1px solid ${color.borderLight}`, background: color.statusDeclinedBg }}>
          <CloseIcon size={12} stroke={color.statusDeclinedFg} />
          <span style={{ fontSize: 12.5, color: color.statusDeclinedFg }}>Denied by you.</span>
        </div>
      )}
    </div>
  );
}

/** The approval summary carries a human `title` but not the raw tool name — pull a `word.word`
 * looking token out of it if there is one, else nothing. */
function deriveToolName(title: string): string | undefined {
  return /\b([a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*)\b/.exec(title)?.[1];
}

function groupReactions(reactions: Message["reactions"]): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  return [...counts.entries()];
}

function renderMessageText(text: string, channelMembers: Member[]) {
  const tokens = new Set(channelMembers.map((m) => mentionTokenFor(m).toLowerCase()));
  if (tokens.size === 0) return text;
  return text.split(/(@[\w-]+)/g).map((part, i) =>
    part.startsWith("@") && tokens.has(part.slice(1).toLowerCase()) ? (
      <strong key={i} style={{ color: color.accentText, background: color.accentTint, borderRadius: 4, padding: "0 4px", fontWeight: 500 }}>
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

type MentionState = { start: number; query: string; index: number };

export function detectMention(value: string, cursor: number): { start: number; query: string } | null {
  const upto = value.slice(0, cursor);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

const COMPOSER_MODES: { value: "ask" | "edit"; label: string; placeholder: string }[] = [
  { value: "ask", label: "Ask", placeholder: "Message the channel — @mention an agent to give it work" },
  { value: "edit", label: "Edit", placeholder: "Describe the change to make — @ mentions still work" },
];

function Composer({
  draft,
  onDraftChange,
  onSend,
  channelMembers,
  hasAgents,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (mode?: "ask" | "edit") => void;
  channelMembers: Member[];
  hasAgents: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingCursorRef = useRef<number | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [mode, setMode] = useState<"ask" | "edit">("ask");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const activeMode = COMPOSER_MODES.find((m) => m.value === mode)!;

  useLayoutEffect(() => {
    if (pendingCursorRef.current != null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current);
      pendingCursorRef.current = null;
    }
  }, [draft]);

  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    if (!q) return channelMembers.slice(0, 6);
    return channelMembers.filter((m) => m.name.toLowerCase().includes(q) || mentionTokenFor(m).toLowerCase().includes(q)).slice(0, 6);
  }, [mention, channelMembers]);

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    onDraftChange(value);
    const detected = detectMention(value, e.target.selectionStart ?? value.length);
    setMention(detected ? { ...detected, index: 0 } : null);
  }

  function insertMention(member: Member) {
    if (!mention) return;
    const token = mentionTokenFor(member);
    const cursor = inputRef.current?.selectionStart ?? draft.length;
    const next = `${draft.slice(0, mention.start)}@${token} ${draft.slice(cursor)}`;
    pendingCursorRef.current = mention.start + token.length + 2;
    onDraftChange(next);
    setMention(null);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && candidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention((m) => m && { ...m, index: (m.index + 1) % candidates.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention((m) => m && { ...m, index: (m.index - 1 + candidates.length) % candidates.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(candidates[mention.index]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && draft.trim()) {
      e.preventDefault();
      onSend(mode);
    }
  }

  return (
    <div style={{ flex: "none", padding: "0 26px 20px", position: "relative" }}>
      {mention && candidates.length > 0 && (
        <div className="ws-sb" style={{ position: "absolute", bottom: "100%", left: 26, marginBottom: 6, width: 260, maxHeight: 220, overflowY: "auto", background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, boxShadow: "0 8px 24px #00000026", padding: 4, zIndex: 10 }}>
          {candidates.map((m, i) => {
            const pal = paletteFor(m.id);
            return (
              <button key={m.id} onMouseDown={(e) => { e.preventDefault(); insertMention(m); }} className="ws-hoverable" style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 32, padding: "0 8px", borderRadius: radius.md, background: i === mention.index ? color.surfaceMuted : "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                <Avatar mono={m.mono} bg={pal.bg} fg={pal.fg} size={20} square={m.kind === "agent"} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                <span style={{ flex: "none", fontSize: 11, color: color.muted, fontFamily: font.mono }}>@{mentionTokenFor(m)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ maxWidth: 820, border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, background: color.surface, overflow: "hidden", boxShadow: "0 1px 2px rgba(23,20,42,0.04)" }}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={activeMode.placeholder}
          rows={2}
          style={{ width: "100%", border: "none", outline: "none", resize: "none", padding: "12px 13px 6px", font: `400 14px/1.55 ${font.sans}`, color: color.ink, background: "transparent", height: 60 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "6px 8px 8px" }}>
          <button className="ws-hoverable" style={composerIconBtn} title="Attach">
            <PlusIcon size={16} stroke={color.muted} />
          </button>
          <button className="ws-hoverable" style={composerIconBtn} title="Link">
            <LinkIcon size={16} stroke={color.muted} />
          </button>
          {hasAgents && (
            <>
              <span style={{ width: 1, height: 18, background: color.border, margin: "0 6px" }} />
              <span style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 9px", borderRadius: 7, color: color.mutedDark, fontSize: 12.5 }}>
                <BotIcon size={14} stroke={color.mutedDark} /> Ask an agent
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <div style={{ position: "relative" }}>
            <button onClick={() => setModeMenuOpen((v) => !v)} onBlur={() => setTimeout(() => setModeMenuOpen(false), 120)} className="ws-hoverable" style={{ display: "flex", alignItems: "center", gap: 4, height: 28, padding: "0 8px", background: "transparent", border: "none", borderRadius: radius.md, cursor: "pointer", font: `500 12.5px ${font.sans}`, color: color.mutedDark }}>
              {activeMode.label}
              <ChevronDownIcon size={11} style={{ transform: modeMenuOpen ? "rotate(180deg)" : undefined }} />
            </button>
            {modeMenuOpen && (
              <div style={{ position: "absolute", bottom: "100%", right: 0, marginBottom: 4, width: 140, background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.md, boxShadow: "0 8px 24px #00000026", padding: 4, zIndex: 10 }}>
                {COMPOSER_MODES.map((m) => (
                  <button key={m.value} onMouseDown={(e) => { e.preventDefault(); setMode(m.value); setModeMenuOpen(false); }} className="ws-hoverable" style={{ display: "block", width: "100%", height: 28, padding: "0 8px", background: m.value === mode ? color.surfaceMuted : "transparent", border: "none", borderRadius: radius.sm, cursor: "pointer", textAlign: "left", fontSize: 12.5, fontWeight: 500, color: color.ink }}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => onSend(mode)} disabled={!draft.trim()} className="ws-hoverable-dark" style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: radius.md, border: "none", background: draft.trim() ? color.dark : color.borderStrong, color: "#fff", cursor: draft.trim() ? "pointer" : "default" }}>
            <SendIcon size={15} stroke="#fff" />
          </button>
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  borderRadius: radius.md,
  cursor: "pointer",
};

const composerIconBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  borderRadius: 7,
  cursor: "pointer",
};

const rowIconBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  cursor: "pointer",
};

const metaChip: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 9px",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  color: color.mutedDark,
  fontSize: 12.5,
  background: "transparent",
};

const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: `500 12px ${font.sans}`,
  color: color.mutedDark,
  cursor: "pointer",
  textDecoration: "underline",
};

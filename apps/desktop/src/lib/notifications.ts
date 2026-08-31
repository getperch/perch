import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { mentions as mentionsContract } from "@perch/api-contract";

type Mention = mentionsContract.Mention;

const SEEN_KEY = "perch.mentionNotifications.seen";
const SEEN_CAP = 300;

/** messageIds we've already notified about, persisted so a restart doesn't either (a) re-notify
 * for the same mention or (b) silently swallow a mention that landed while the app was closed —
 * the old in-memory-only seed did the latter, which is why a scheduled run finishing while you
 * weren't looking never produced a notification. */
function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_CAP)));
  } catch {
    /* private mode / quota — notifications just fall back to in-memory de-dup for this session */
  }
}

/**
 * Fires a native OS notification (via the Tauri notification plugin) for each new @mention of the
 * current user in the cross-channel mentions feed. The feed is derived server-side from message
 * text (see services/api/src/routers/mentions.ts) and already excludes your own messages, so "an
 * agent tagged you" (e.g. a scheduled run posting its result) and "a teammate tagged you" both
 * land here.
 *
 * The seen-set is persisted (localStorage), so:
 *  - a mention that arrived while the app was closed still notifies on next launch (if still
 *    `unread`, i.e. < 24h old) — it's not in the persisted set;
 *  - a restart doesn't replay mentions already notified.
 * On a genuinely fresh install (no persisted set) the first load seeds silently rather than
 * blasting a day of backlog.
 *
 * Only fires while the app process is running. There's no server push, so a fully-closed app —
 * desktop or mobile — won't notify until it's next opened and polls.
 */
export function useMentionNotifications(mentions: Mention[] | undefined) {
  const seen = useRef<Set<string> | null>(null);
  const seededSilently = useRef(false);
  const permission = useRef<"unknown" | "granted" | "denied">("unknown");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (!cancelled) permission.current = granted ? "granted" : "denied";
    })().catch(() => {
      permission.current = "denied";
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mentions) return;

    if (seen.current === null) {
      seen.current = loadSeen();
      // Fresh install: nothing remembered yet — seed from the current feed without notifying so
      // we don't replay up to 24h of existing mentions on first ever launch.
      if (seen.current.size === 0) {
        seen.current = new Set(mentions.map((m) => m.messageId));
        seededSilently.current = true;
        saveSeen(seen.current);
        return;
      }
    }

    const fresh = mentions.filter((m) => m.unread && !seen.current!.has(m.messageId));
    for (const m of mentions) seen.current.add(m.messageId);
    saveSeen(seen.current);
    if (fresh.length === 0 || permission.current !== "granted") return;

    if (fresh.length === 1) {
      const m = fresh[0]!;
      sendNotification({
        title: `${m.authorName} mentioned you in #${m.channelName}`,
        body: m.text.length > 180 ? `${m.text.slice(0, 179)}…` : m.text,
      });
    } else {
      sendNotification({
        title: `${fresh.length} new mentions`,
        body: `In ${[...new Set(fresh.map((m) => `#${m.channelName}`))].join(", ")}`,
      });
    }
  }, [mentions]);
}

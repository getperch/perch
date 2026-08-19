import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { mentions as mentionsContract } from "@perch/api-contract";

type Mention = mentionsContract.Mention;

/**
 * Fires a native OS notification (via the Tauri notification plugin) the first time we see a new
 * @mention of the current user in the cross-channel mentions feed. The feed is derived server-side
 * from message text (see services/api/src/routers/mentions.ts) and already excludes the user's own
 * messages, so "an agent tagged you" and "a teammate tagged you" both land here.
 *
 * The first successful load only *seeds* the seen-set — we don't replay the existing backlog as a
 * burst of notifications on launch. After that, any mention id we haven't seen and that's flagged
 * `unread` (posted in the last 24h) gets a single notification.
 *
 * Desktop notification clicks don't reliably surface a JS callback across platforms, so clicking
 * one doesn't deep-link; the in-app Notifications screen is the place to click through.
 */
export function useMentionNotifications(mentions: Mention[] | undefined) {
  const seen = useRef<Set<string> | null>(null);
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

    // First load: remember everything, notify for nothing.
    if (seen.current === null) {
      seen.current = new Set(mentions.map((m) => m.messageId));
      return;
    }

    const fresh = mentions.filter((m) => m.unread && !seen.current!.has(m.messageId));
    for (const m of mentions) seen.current.add(m.messageId);
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

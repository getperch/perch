import { useEffect, useRef } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { channelStreamEvent, type ChannelStreamEvent } from "@perch/api-contract";

/**
 * Subscribes to channel events via Rust's `subscribe_channel_events` command (see
 * `src-tauri/src/stream.rs`) — Rust owns the polling/reconnect loop against
 * `GET /api/channels/{id}/events` and pushes each event to this `Channel`, so the webview never
 * makes the HTTP calls itself.
 */
export function useChannelStream(channelId: string | undefined, onEvent: (event: ChannelStreamEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!channelId) return;
    let subscriptionId: string | undefined;
    let cancelled = false;

    const channel = new Channel<unknown>();
    channel.onmessage = (message) => {
      const parsed = channelStreamEvent.safeParse(message);
      if (parsed.success) {
        onEventRef.current(parsed.data);
      } else {
        console.error("[channel stream]", channelId, "received event that failed schema validation, dropping:", parsed.error, message);
      }
    };

    console.debug("[channel stream]", channelId, "subscribing");
    invoke<string>("subscribe_channel_events", { channelId, onEvent: channel }).then((id) => {
      if (cancelled) {
        invoke("unsubscribe_channel_events", { id });
      } else {
        console.debug("[channel stream]", channelId, "subscribed, id:", id);
        subscriptionId = id;
      }
    }).catch((err) => {
      console.error("[channel stream]", channelId, "subscribe_channel_events invoke failed:", err);
    });

    return () => {
      cancelled = true;
      if (subscriptionId) invoke("unsubscribe_channel_events", { id: subscriptionId });
    };
  }, [channelId]);
}

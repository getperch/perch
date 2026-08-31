import { useCallback, useState } from "react";

const READ_KEY = "perch.mentionReads";
const CAP = 400;

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function save(ids: Set<string>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids].slice(-CAP)));
  } catch {
    /* private mode / quota — read state just won't persist across launches this session */
  }
}

/**
 * Per-device record of which @mention messages the user has opened. The server's mentions feed has
 * no read cursor — `unread` there is only a "posted in the last 24h" heuristic — so this is what
 * lets the Notifications badge go down when you click through to a mention, instead of it sitting
 * at its count until the message ages out.
 */
export function useMentionReads() {
  const [readIds, setReadIds] = useState<Set<string>>(load);

  const markRead = useCallback((ids: string[]) => {
    setReadIds((prev) => {
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      save(next);
      return next;
    });
  }, []);

  return { readIds, markRead };
}

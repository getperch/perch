import { useEffect, useRef, useState } from "react";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readStoredSize(key: string, defaultSize: number, minSize: number, maxSize: number) {
  if (typeof window === "undefined") return defaultSize;
  const raw = window.localStorage.getItem(key);
  const parsed = raw != null ? Number(raw) : NaN;
  return clamp(Number.isFinite(parsed) ? parsed : defaultSize, minSize, maxSize);
}

/** Drag-to-resize sizing for a horizontal side panel, persisted to localStorage under `key`.
 * Widening drags to the left (dragging the handle left grows a right-hand panel). */
export function useResizable({
  storageKey,
  defaultSize,
  minSize,
  maxSize,
}: {
  storageKey: string;
  defaultSize: number;
  minSize: number;
  maxSize: number;
}) {
  const [size, setSize] = useState(() => readStoredSize(storageKey, defaultSize, minSize, maxSize));
  const dragState = useRef<{ startX: number; startSize: number } | null>(null);

  useEffect(() => {
    setSize((s) => clamp(s, minSize, maxSize));
  }, [minSize, maxSize]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragState.current) return;
      const delta = dragState.current.startX - e.clientX;
      setSize(clamp(dragState.current.startSize + delta, minSize, maxSize));
    }
    function onMouseUp() {
      if (!dragState.current) return;
      dragState.current = null;
      setSize((s) => {
        window.localStorage.setItem(storageKey, String(s));
        return s;
      });
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [minSize, maxSize, storageKey]);

  function onMouseDownResize(e: React.MouseEvent) {
    dragState.current = { startX: e.clientX, startSize: size };
  }

  return { size, onMouseDownResize };
}

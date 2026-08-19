import { useEffect, useState } from "react";

export function useIsNarrow(breakpointPx: number) {
  const [isNarrow, setIsNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpointPx : false,
  );

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < breakpointPx);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpointPx]);

  return isNarrow;
}

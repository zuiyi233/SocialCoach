"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { probeLoveStudio, type LoveStudioProbe } from "@/lib/love-studio-link";

/** 探测中：首帧与重新检查期间都显示它，不把「还没答」画成「没开」。 */
export type LoveStudioProbeState = { kind: "checking" } | LoveStudioProbe;

/**
 * 挂载后再探测：首帧不触网，SSR 与客户端一致；本地端口秒回，不需要骨架屏之外的等待。
 * 探测只影响提示文案与按钮目标，失败也不影响恋爱剧情模式。
 */
export function useLoveStudioProbe(): { state: LoveStudioProbeState; recheck: () => void } {
  const [state, setState] = useState<LoveStudioProbeState>({ kind: "checking" });
  const alive = useRef(true);
  const recheck = useCallback(() => {
    setState({ kind: "checking" });
    void probeLoveStudio().then((probe) => {
      if (alive.current) setState(probe);
    });
  }, []);
  useEffect(() => {
    alive.current = true;
    const timer = window.setTimeout(recheck, 0);
    return () => {
      alive.current = false;
      window.clearTimeout(timer);
    };
  }, [recheck]);
  return { state, recheck };
}
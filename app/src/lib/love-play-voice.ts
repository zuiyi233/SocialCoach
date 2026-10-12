import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/data/taxonomy";
import { idleSpeech, SpeechSession, type SpeechState } from "@/features/dinner/lib/speech";

/**
 * Love-play 语音输入：直接包住 dinner 的 `SpeechSession`（带代际守卫、启动超时、
 * 停止兜底那套），不复用 `useSpeechInput` —— 它调 `muteForSpeech`，会把 3D 房间
 * 环境音状态拖进这个没有环境音的模块。
 */
export function useLoveVoice(lang: Lang, enabled: boolean, writeDraft: (draft: string) => void) {
  const [state, setState] = useState<SpeechState>(idleSpeech);
  const session = useRef<SpeechSession | null>(null);
  // writeDraft 每帧都是新闭包；用 ref 兜住，避免重建 session 丢掉在途识别。
  const writeRef = useRef(writeDraft);
  useEffect(() => {
    writeRef.current = writeDraft;
  });
  useEffect(() => {
    const current = new SpeechSession(setState, (draft) => writeRef.current(draft));
    session.current = current;
    const leave = () => { if (document.hidden) current.cancel(); };
    const unload = () => current.cancel(true);
    document.addEventListener("visibilitychange", leave);
    window.addEventListener("pagehide", unload);
    return () => {
      current.dispose();
      session.current = null;
      document.removeEventListener("visibilitychange", leave);
      window.removeEventListener("pagehide", unload);
    };
  }, []);
  useEffect(() => { if (!enabled) session.current?.cancel(true); }, [enabled, lang]);
  return {
    ...state,
    active: state.phase !== "idle",
    start: (base: string) => { if (enabled) session.current?.start(base, lang); },
    stop: () => session.current?.stop(),
    cancel: (silent = false) => session.current?.cancel(silent),
    edit: () => session.current?.edit(),
    discardInterim: () => session.current?.cancel(),
  };
}

/** 收音中把未定稿词拼到草稿尾部预览；定稿由 SpeechSession 经 writeDraft 落到 input。 */
export function withInterim(base: string, interim: string, lang: Lang): string {
  if (!interim) return base;
  const sep = base && lang === "en" && !/\s$/.test(base) ? " " : "";
  return base + sep + interim;
}

import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/data/taxonomy";
import { idleSpeech, SpeechSession, type SpeechState } from "@/features/dinner/lib/speech";
import { speechBusy } from "@/lib/speech";

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

/**
 * 当前这句 NPC 台词的朗读是否还在进行（`speech.ts` 的队列 + 在途朗读）。
 *
 * 这是 TTS ducking 与限时选择共用的信号源：
 * - 变 true → BGM 压低音量（ducking）；
 * - 变回 false → 解除 ducking，且「台词打字 + 朗读都完成」的限时选择才允许起表。
 *
 * 纪律：朗读由 PlayScene 的朗读 effect 入队（`speak()` 同步进队列）。实现上以
 * 「已读完的台词 key」为状态：当前 key 还没被标记读完就视为正在读——换台词的
 * 第一拍就反应，无需在 effect 体内同步 setState。TTS 关闭、没有台词、或浏览器
 * 根本不支持朗读（`speechBusy()` 恒为 false）都会在第一个轮询拍稳定为 false，
 * 不会卡住计时。
 */
export function useLoveSpeechActivity(lineKey: string | null, ttsEnabled: boolean): boolean {
  // 最近一句确认读完的台词；null = 还没有任何一句读完。
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    if (!ttsEnabled || !lineKey) return;
    let alive = true;
    let timer = 0;
    const tick = () => {
      if (!alive) return;
      if (!speechBusy()) {
        setSettledKey(lineKey);
        return;
      }
      timer = window.setTimeout(tick, 200);
    };
    timer = window.setTimeout(tick, 200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [lineKey, ttsEnabled]);
  return !!ttsEnabled && !!lineKey && settledKey !== lineKey;
}

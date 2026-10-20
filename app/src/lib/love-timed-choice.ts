import type { ChatMessage } from "./types";
import { uid } from "./format";
import { LOVE_TIMED_CHOICE_SCENES } from "./love-chapter-card";

/**
 * 限时选择状态机（spec-love-interactive-story §4.5 / 拍板 Q6）。
 *
 * 产品口径（硬约束）：
 * - **默认关闭**：阅读设置里默认关；关闭时任何场景都不计时（`loveTimedChoiceEnabled`）。
 * - **只用于高潮幕**：场景级常量 `LOVE_TIMED_CHOICE_SCENES` 登记（当前只有 Rio 第 6 幕）。
 * - **计时起点 = 台词打字完成 + TTS 朗读完成**：两条都满足才发 `arm`；
 *   在途请求、收束、打开任何面板、换台词都发 `cancel`。
 * - **超时 = 沉默分支，不失败、不扣分、不替玩家选**：`tick` 越线时置 `lapsed`
 *   并只回报一次 `lapsed: true`；上层以此触发「本地沉默旁白 + 请求下一回合」。
 */

/** 倒计时长（秒）：足够读完选项、想一下，又不至于形同虚设。 */
export const LOVE_TIMED_CHOICE_SECONDS = 12;
export const LOVE_TIMED_CHOICE_MS = LOVE_TIMED_CHOICE_SECONDS * 1000;

/** 开关 + 场景双闸：设置关、或场景不是高潮幕，都永远不启用。 */
export function loveTimedChoiceEnabled(settings: { timedChoice: boolean }, sceneId: string): boolean {
  return settings.timedChoice === true && LOVE_TIMED_CHOICE_SCENES.has(sceneId);
}

export function loveTimedChoiceEndsAt(now: number): number {
  return now + LOVE_TIMED_CHOICE_MS;
}

/** 剩余毫秒，下限 0；用于进度条与秒数显示。 */
export function loveTimedChoiceRemainingMs(endsAt: number, now: number): number {
  return Math.max(0, endsAt - now);
}

export function loveTimedChoiceLapsed(endsAt: number, now: number): boolean {
  return now >= endsAt;
}

export interface LoveTimedChoiceState {
  phase: "idle" | "counting" | "lapsed";
  /** 计时归属的台词 key；换台词/取消即回到 idle，防止旧计时污染新台词。 */
  key: string | null;
  endsAt: number | null;
}

export type LoveTimedChoiceEvent =
  | { type: "arm"; key: string; now: number }
  | { type: "cancel" }
  | { type: "tick"; now: number };

export function idleLoveTimedChoice(): LoveTimedChoiceState {
  return { phase: "idle", key: null, endsAt: null };
}

/**
 * 纯归约：`lapsed: true` 只在 counting → lapsed 的那一次出现；
 * 之后重复 `tick` 不再回报，调用方保证沉默分支只走一次。
 */
export function reduceLoveTimedChoice(
  state: LoveTimedChoiceState,
  event: LoveTimedChoiceEvent,
): { state: LoveTimedChoiceState; lapsed: boolean } {
  switch (event.type) {
    case "arm": {
      if (state.phase === "counting" && state.key === event.key) {
        // 同一句重复 arm（重渲染）：不重置，不吃掉已流逝的时间。
        return { state, lapsed: false };
      }
      return { state: { phase: "counting", key: event.key, endsAt: loveTimedChoiceEndsAt(event.now) }, lapsed: false };
    }
    case "cancel":
      return state.phase === "idle" ? { state, lapsed: false } : { state: idleLoveTimedChoice(), lapsed: false };
    case "tick": {
      if (state.phase !== "counting" || state.endsAt === null) return { state, lapsed: false };
      if (!loveTimedChoiceLapsed(state.endsAt, event.now)) return { state, lapsed: false };
      return { state: { phase: "lapsed", key: state.key, endsAt: state.endsAt }, lapsed: true };
    }
  }
}

/**
 * 超时后的「沉默」本地事件：作为一条 `event` 旁白进 history（role=event 不是任何人的台词，
 * 不会被引用成学习者原话），并随请求发给模型让它接住这次沉默。
 * 注意：story slot 的 save schema 只持久化 npc/learner 两类行，这条旁白只在
 * 请求与当回合可见，不会进存档——这是设计内行为，不是丢数据。
 */
export function loveSilenceEvent(input: { seconds: number; text: string; now?: number }): ChatMessage {
  return {
    id: uid(),
    role: "event",
    kind: "silence",
    seconds: input.seconds,
    text: input.text,
    ts: input.now ?? Date.now(),
  };
}

import type { LovePlayEmotion } from "./love-play-client";

/**
 * 呈现层的「镜头语言」纯函数（spec-love-interactive-story §4.5）：
 * 景别（近/中/远景）与左右站位，供 AvatarStand 与 PlayScene 消费。
 *
 * 纪律：只做**有动机**的切换——开场定场用远景，hidden 揭示与结局推近，
 * 其余时刻中景；没有动机就保持中景，不做无意义的常动。
 * 左右站位按「场景 + 角色」确定性推导（SSR 与客户端同值，无 hydration 风险），
 * 一幕之内不换位——换人换幕才有新构图。
 */

export type LoveShot = "far" | "mid" | "near";
export type LoveSide = "left" | "right";

/** 景别对应的立绘缩放（1 = 现有基准尺寸 AvatarStand.size）。 */
export const LOVE_SHOT_SCALE: Record<LoveShot, number> = { far: 0.8, mid: 1, near: 1.14 };

/** 左右站位相对舞台中线的水平位移（px）。 */
export const LOVE_SIDE_OFFSET_PX = 34;

/** 轻震的横移关键帧（px）：只碰 x 轴，幅度小、单次播放，不循环。 */
export const LOVE_SHAKE_X: number[] = [0, -4, 4, -3, 3, -1, 0];
/** 轻震时长（秒）。 */
export const LOVE_SHAKE_SECONDS = 0.42;

export interface LoveShotMoment {
  /** 幕的开场白还在台上（对方尚未第一次回应）：远景定场。 */
  opening: boolean;
  /** 本回合是 hidden 揭示：推近。 */
  reveal: boolean;
  /** 已经收束（结局时刻）：推近。 */
  ending: boolean;
  /** 重情绪（teary）：推近。tight/neutral 不推。 */
  heavyEmotion: boolean;
}

/** 拍点/结局时刻推近，开场远景，其余中景。没有动机一律 mid。 */
export function loveShotForMoment(input: LoveShotMoment): LoveShot {
  if (input.ending || input.reveal) return "near";
  if (input.opening) return "far";
  if (input.heavyEmotion) return "near";
  return "mid";
}

/** 「说话的那位」才随景别走；同台的其余角色保持中景。 */
export function loveShotForSpeaker(input: LoveShotMoment, isSpeaker: boolean): LoveShot {
  return isSpeaker ? loveShotForMoment(input) : "mid";
}

/** 重情绪表：teary 推近；其余表情不改变景别。 */
export function isHeavyLoveEmotion(emotion: LovePlayEmotion): boolean {
  return emotion === "teary";
}

/**
 * 左右站位：按 `sceneId:characterId` 的确定性散列取边。
 * 同一幕同一角色永远同一边（存档/恢复/StrictMode 都稳定），跨幕跨角色才有变化。
 */
export function loveSideFor(sceneId: string, characterId: string): LoveSide {
  const key = `${sceneId}:${characterId}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 2 === 0 ? "left" : "right";
}

/** 系统级减少动态；阅读设置里的 reduceMotion 之外的第二道闸（spec §4.5）。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

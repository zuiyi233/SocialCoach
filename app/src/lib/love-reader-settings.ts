import { LOVE_PLAY_PREFIX } from "./love-carry-store";
import { notifyLoveSlotsChanged } from "./love-slot-events";

/** 恋爱阅读偏好：设备端、与情商设置分开，避免动 persist 版本。 */
export const LOVE_READER_KEY = `${LOVE_PLAY_PREFIX}reader`;

export type LoveTextSize = "sm" | "md" | "lg";
export type LoveTextSpeed = "slow" | "normal" | "fast";

export interface LoveReaderSettings {
  v: 1;
  textSize: LoveTextSize;
  speed: LoveTextSpeed;
  /** 自动显示全文并朗读；到选项为止，不替玩家做选择。 */
  auto: boolean;
  /** 只对逐字已见的文本生效。 */
  skipRead: boolean;
  reduceMotion: boolean;
  /** 限时选择：默认关；开了也只在高潮幕生效（spec §4.5，拍板 Q6）。 */
  timedChoice: boolean;
  /** 角色主动关心：熟络后开场/回访的关心卡；默认开，旧档缺字段按开处理（spec-love-semi-coach §3.3）。 */
  care: boolean;
}

export const DEFAULT_LOVE_READER: LoveReaderSettings = {
  v: 1,
  textSize: "md",
  speed: "normal",
  auto: false,
  skipRead: false,
  reduceMotion: false,
  timedChoice: false,
  care: true,
};

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls && typeof ls.getItem === "function" && typeof ls.setItem === "function" ? ls : null;
  } catch {
    return null;
  }
}

export function readLoveReaderSettings(): LoveReaderSettings {
  const ls = storage();
  if (!ls) return DEFAULT_LOVE_READER;
  try {
    const raw = ls.getItem(LOVE_READER_KEY);
    if (!raw) return DEFAULT_LOVE_READER;
    const value = JSON.parse(raw) as Partial<LoveReaderSettings> | null;
    if (!value || typeof value !== "object") return DEFAULT_LOVE_READER;
    return {
      v: 1,
      textSize: value.textSize === "sm" || value.textSize === "lg" ? value.textSize : "md",
      speed: value.speed === "slow" || value.speed === "fast" ? value.speed : "normal",
      auto: value.auto === true,
      skipRead: value.skipRead === true,
      reduceMotion: value.reduceMotion === true,
      // 旧档没有这个字段：默认关。识别不出的值也按关处理，绝不猜成开。
      timedChoice: value.timedChoice === true,
      // 主动关心默认开：只有显式关掉才不出现；旧档缺字段与识别不出的值都按开。
      care: value.care !== false,
    };
  } catch {
    return DEFAULT_LOVE_READER;
  }
}

export function writeLoveReaderSettings(next: LoveReaderSettings): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(LOVE_READER_KEY, JSON.stringify({ ...next, v: 1 }));
  } catch {
    return false;
  }
  notifyLoveSlotsChanged(LOVE_READER_KEY);
  return true;
}

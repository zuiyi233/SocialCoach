import type { L, Lang } from "@/data/taxonomy";
import type { Scenario } from "@/data/corpus/types";
import type { ChatMessage } from "./types";
import { readModelFailure } from "./model-status";
import { ApiError } from "./client-api";

/** 恋爱 Galgame 一回合的输出契约（与后端 LovePlayOutput 字段一致）。 */
export type LovePlayEmotion = "neutral" | "smile" | "tight" | "teary";
export type LovePlayOutcome = "success" | "partial" | "failure";

export interface LovePlayTurn {
  line: L;
  options: L[];
  emotion: LovePlayEmotion;
  /** 0-100，对方立场（不是给学习者的评分）。 */
  stance: number;
  revealed: boolean;
  terminal: LovePlayOutcome | null;
  ended: boolean;
}

export interface LovePlayTurnInput {
  scenario: Scenario;
  learnerCharacterId: string;
  /** 后端契约字段名就是 language（不是 lang）。 */
  language: Lang;
  learnerName?: string;
  /** 历史消息：role/characterId?/text/ts 与现有 ChatMessage 兼容。 */
  messages: ChatMessage[];
  turnLimit?: number;
}

/** 与 client-api 同口径的断网提示（用户可读、双语）。 */
const OFFLINE_MSG: L = { zh: "看起来断网了，连上网络后再试。", en: "You seem to be offline. Reconnect and try again." };

/**
 * 一次 /api/love-play 请求：非流式 JSON，返回双语台词 + 2-4 个选项 + 表情 +
 * 立场 + 结局判定。网络失败/非 2xx 抛 ApiError，错误信息交给界面展示与重试。
 */
export async function lovePlayTurn(input: LovePlayTurnInput, signal?: AbortSignal): Promise<LovePlayTurn> {
  const lang = input.language;
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new ApiError(OFFLINE_MSG[lang], 0, "network");
  let res: Response;
  try {
    res = await fetch("/api/love-play", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": input.language },
      body: JSON.stringify(input),
      signal,
    });
  } catch (e) {
    // 主动取消（离开页面/重开一局）不是错误，原样抛给调用方判断。
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(OFFLINE_MSG[lang], 0, "network");
  }
  if (!res.ok) {
    // 后端失败体符合 model-status 的 {error, status} 口径；解析不到就用状态文本。
    let msg = res.statusText;
    try {
      const failure = readModelFailure(JSON.stringify(await res.json()));
      msg = failure.error || msg;
    } catch {}
    throw new ApiError(msg, res.status, "http");
  }
  return (await res.json()) as LovePlayTurn;
}

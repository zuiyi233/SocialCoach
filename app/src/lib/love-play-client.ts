import { z } from "zod";
import type { L, Lang } from "@/data/taxonomy";
import type { Scenario } from "@/data/corpus/types";
import type { ChatMessage } from "./types";
import { readModelFailure, type ModelIssue } from "./model-status";
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

/** 响应体不是合法回合时的用户可读文案（本地双语常量，与 OFFLINE_MSG 同一先例，不进 i18n）。 */
const BAD_RESPONSE_MSG: L = {
  zh: "这一回合的回复格式不对，你的话已保留，请重试。",
  en: "The reply for this turn came back malformed. Your words are saved; please retry.",
};

/**
 * G18：/api/love-play 的成功响应按与后端 lovePlayOutputSchema 同口径的 zod 契约校验。
 * 此前响应被直接 `as LovePlayTurn` 透传，坏对象会一路渲染到屏幕上崩掉；现在非法响应
 * 抛带结构的 ApiError（kind/status/message），交给界面现有的重试路径（失败的那半回合
 * 保留在调用方的 pending 命令里原样重发）。未知多余键被剥掉，前向兼容。
 */
const localizedLine = z.object({ zh: z.string().trim().min(1), en: z.string().trim().min(1) });
const lovePlayTurnSchema: z.ZodType<LovePlayTurn> = z.object({
  line: localizedLine,
  options: z.array(localizedLine).min(2).max(4),
  emotion: z.enum(["neutral", "smile", "tight", "teary"]),
  stance: z.number().int().min(0).max(100),
  revealed: z.boolean(),
  terminal: z.enum(["success", "partial", "failure"]).nullable(),
  ended: z.boolean(),
});

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
    // 后端失败体符合 model-status 的 {error, status, modelIssue?, retryAt?} 口径；解析不到就用状态文本。
    // G18：modelIssue 与 retryAt 不再被丢掉——限流/共享池的 retryAt 随 ApiError 原样透传给调用方。
    let msg = res.statusText;
    let issue: ModelIssue | null | undefined;
    let retryAt: number | undefined;
    try {
      const failure = readModelFailure(JSON.stringify(await res.json()));
      msg = failure.error || msg;
      issue = failure.modelIssue;
      retryAt = failure.retryAt;
    } catch {}
    throw new ApiError(msg, res.status, "http", issue, retryAt);
  }
  // 成功体也要过契约：解析不出 JSON 或 zod 不过都按「上游给了一条坏回合」处理（502），
  // 错误信息与后端契约失败同一口径，UI 现有的 catch + 重试路径直接可用。
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(BAD_RESPONSE_MSG[lang], 502, "http");
  }
  const parsed = lovePlayTurnSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(BAD_RESPONSE_MSG[lang], 502, "http");
  return parsed.data;
}

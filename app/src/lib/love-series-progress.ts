import type { LovePlayOutcome } from "./love-play-client";
import { LOVE_STORY_KEY } from "./love-story";
import { notifyLoveSlotsChanged } from "./love-slot-events";

/**
 * 剧情线进度（设备端 localStorage 独立管理，不进 store，避免 persist 版本迁移）。
 *
 * v2（G10）：加 `v` 与 `lastAct`。v1 没有版本号，读取时按 v2 形状在内存里承载（lazy migrate），
 * 下一次写入才落盘成 v2——读路径不产生副作用，和承接的 `peek` 同一口径。
 * `endingId` 不在这里：它属于 `LovePlaySave`/`LovePlayRecord`（spec-love-galgame-foundation §6 G10）。
 * `lastAct` 可缺省：v1 档、以及不知道幕号的调用方都读不出幕号，缺省比猜一个更诚实。
 */
export interface LoveSeriesProgress {
  v: 2;
  completed: string[];
  /** 最近完成的一场（v1 兼容字段；「继续」的落点由调用方按 completed 算首个未完成幕）。 */
  lastScene: string;
  outcome: Record<string, LovePlayOutcome>;
  /**
   * 已完成场景里的最大幕号（1 起）。只有调用方给了 `act` 才知道；v1 档与未知幕号缺省。
   * 0 / 负数视为「没给」，小数向下取整：不做 0 起下标的猜测——`PlayScene` 传的是 actIndex + 1。
   */
  lastAct?: number;
}

export const loveSeriesProgressKey = (seriesId: string) => `socialcoach.love-play.series.${seriesId}`;

/** 每次读空都发一份新的：调用方拿到的空档不该和下一次读取共享同一个可变对象。 */
const empty = (): LoveSeriesProgress => ({ v: 2, completed: [], lastScene: "", outcome: {} });

/** 读取结果。`corrupt` 时 `raw` 是原始字节；`progress` 仍是尽力解析出的部分。 */
export interface LoveSeriesProgressRead {
  status: "ok" | "empty" | "corrupt" | "unavailable";
  progress: LoveSeriesProgress;
  raw?: string;
}

/**
 * 写入结果。旧调用方都忽略返回值，所以 `progress` 永远给（会话内进度仍可继续），
 * `ok:false` 表示没有落盘、也没有通知订阅者。
 */
export type LoveSeriesProgressWrite =
  | { ok: true; progress: LoveSeriesProgress }
  | { ok: false; progress: LoveSeriesProgress; issue: "corrupt" | "unavailable" };

function parse(raw: string): { progress: LoveSeriesProgress; corrupt: boolean } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { progress: empty(), corrupt: true };
    }
    const p = parsed as Record<string, unknown>;
    // v1 没有 v；显式 v:1 也按 v1 迁移。其他版本号是未来/损坏数据：读空，不猜它长什么样。
    if (p.v !== undefined && p.v !== 1 && p.v !== 2) return { progress: empty(), corrupt: true };
    // 坏字段仍按旧口径退回安全值；但任何一处退回都记 corrupt——写回会把原来的字节改掉。
    let corrupt = false;
    const completed: string[] = [];
    if (Array.isArray(p.completed)) {
      for (const x of p.completed) {
        if (typeof x === "string" && x.length > 0) completed.push(x);
        else corrupt = true;
      }
    } else if (p.completed !== undefined) {
      corrupt = true;
    }
    const outcome: Record<string, LovePlayOutcome> = {};
    if (p.outcome && typeof p.outcome === "object" && !Array.isArray(p.outcome)) {
      for (const [k, v] of Object.entries(p.outcome)) {
        if (k && (v === "success" || v === "partial" || v === "failure")) outcome[k] = v;
        else corrupt = true;
      }
    } else if (p.outcome !== undefined) {
      corrupt = true;
    }
    const lastScene = typeof p.lastScene === "string" ? p.lastScene : "";
    if (p.lastScene !== undefined && typeof p.lastScene !== "string") corrupt = true;
    const next: LoveSeriesProgress = { v: 2, completed, lastScene, outcome };
    // 幕号只认正整数；坏值当作「不知道」，不让它把 max 抬到不可能的数上。
    if (typeof p.lastAct === "number" && Number.isFinite(p.lastAct) && p.lastAct >= 1) {
      next.lastAct = Math.trunc(p.lastAct);
    } else if (p.lastAct !== undefined) {
      corrupt = true;
    }
    return { progress: next, corrupt };
  } catch {
    return { progress: empty(), corrupt: true };
  }
}

/** 读取某条剧情线的设备端进度与字节状态；读取失败/未记录时进度为空，不抛错。 */
export function readLoveSeriesProgressState(seriesId: string): LoveSeriesProgressRead {
  if (typeof window === "undefined") return { status: "unavailable", progress: empty() };
  let raw: string | null;
  try {
    raw = localStorage.getItem(loveSeriesProgressKey(seriesId));
  } catch {
    return { status: "unavailable", progress: empty() };
  }
  if (raw == null) return { status: "empty", progress: empty() };
  const parsed = parse(raw);
  if (parsed.corrupt) return { status: "corrupt", progress: parsed.progress, raw };
  return { status: "ok", progress: parsed.progress, raw };
}

/** 兼容签名：只返回进度；坏档仍按旧口径给空/尽力解析结果。v1 档在这里升成 v2 形状。 */
export function readLoveSeriesProgress(seriesId: string): LoveSeriesProgress {
  return readLoveSeriesProgressState(seriesId).progress;
}

/**
 * 记录一场场景的完成（completed + lastScene + outcome），写 v2。
 * `act` 是这一幕的幕号（1 起）：给了就取「已完成里的最大幕号」，重玩靠前的一幕不会把进度倒退；
 * 不给就沿用旧值（v1 档因此保持 `lastAct` 缺省）。
 * 现有 slot 坏掉/读不了时**不写**：那会把恢复线索覆盖成一份看起来正常的 v2。
 */
export function writeLoveSeriesProgress(
  seriesId: string,
  sceneId: string,
  outcome: LovePlayOutcome,
  act?: number,
): LoveSeriesProgressWrite {
  const state = readLoveSeriesProgressState(seriesId);
  const cur = state.progress;
  const completed = cur.completed.includes(sceneId) ? cur.completed : [...cur.completed, sceneId];
  const actN = typeof act === "number" && Number.isFinite(act) && act >= 1 ? Math.trunc(act) : undefined;
  const lastAct = actN === undefined ? cur.lastAct : Math.max(cur.lastAct ?? 0, actN);
  const next: LoveSeriesProgress = { v: 2, completed, lastScene: sceneId, outcome: { ...cur.outcome, [sceneId]: outcome } };
  if (lastAct !== undefined) next.lastAct = lastAct;
  if (state.status === "corrupt") return { ok: false, progress: next, issue: "corrupt" };
  if (state.status === "unavailable") return { ok: false, progress: next, issue: "unavailable" };
  try {
    localStorage.setItem(loveSeriesProgressKey(seriesId), JSON.stringify(next));
  } catch {
    // 存储不可用：本次进度仍返回给调用方，界面可继续工作；但没有落盘就不通知。
    return { ok: false, progress: next, issue: "unavailable" };
  }
  notifyLoveSlotsChanged(loveSeriesProgressKey(seriesId));
  return { ok: true, progress: next };
}

/**
 * 显式恢复入口：只给用户在恢复 UI 里主动确认后调用，不在读失败时自动清。
 * 删除成功后通知订阅者（与其他 slot 的 clear 同一口径）。
 */
export function clearLoveSeriesProgressSlot(seriesId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(loveSeriesProgressKey(seriesId));
  } catch {
    return;
  }
  notifyLoveSlotsChanged(loveSeriesProgressKey(seriesId));
}

/**
 * 系列页的刷新判定（纯函数，组件与测试共用）：clear（key === null）、本线进度、
 * 或 story slot（进行中存档/记录）变化都值得重读；别的线、carry 与主档一律忽略。
 */
export function shouldRefreshLoveSlots(key: string | null, seriesId: string): boolean {
  if (key === null) return true;
  return key === LOVE_STORY_KEY || key === loveSeriesProgressKey(seriesId);
}

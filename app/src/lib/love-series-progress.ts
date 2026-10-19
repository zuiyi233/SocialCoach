import type { LovePlayOutcome } from "./love-play-client";

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
   * 0 / 负数 / 小数一律视为「没给」，不做 0 起下标的猜测——`PlayScene` 传的是 actIndex + 1。
   */
  lastAct?: number;
}

const storageKey = (seriesId: string) => `socialcoach.love-play.series.${seriesId}`;

/** 每次读空都发一份新的：调用方拿到的空档不该和下一次读取共享同一个可变对象。 */
const empty = (): LoveSeriesProgress => ({ v: 2, completed: [], lastScene: "", outcome: {} });

function parse(raw: string | null): LoveSeriesProgress {
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty();
    const p = parsed as Record<string, unknown>;
    // v1 没有 v；显式 v:1 也按 v1 迁移。其他版本号是未来/损坏数据：读空，不猜它长什么样。
    if (p.v !== undefined && p.v !== 1 && p.v !== 2) return empty();
    const completed = Array.isArray(p.completed)
      ? p.completed.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const outcome: Record<string, LovePlayOutcome> = {};
    if (p.outcome && typeof p.outcome === "object" && !Array.isArray(p.outcome)) {
      for (const [k, v] of Object.entries(p.outcome)) {
        if (k && (v === "success" || v === "partial" || v === "failure")) outcome[k] = v;
      }
    }
    const next: LoveSeriesProgress = {
      v: 2,
      completed,
      lastScene: typeof p.lastScene === "string" ? p.lastScene : "",
      outcome,
    };
    // 幕号只认正整数；坏值当作「不知道」，不让它把 max 抬到不可能的数上。
    if (typeof p.lastAct === "number" && Number.isFinite(p.lastAct) && p.lastAct >= 1) {
      next.lastAct = Math.trunc(p.lastAct);
    }
    return next;
  } catch {
    return empty();
  }
}

/** 读取某条剧情线的设备端进度；读取失败/未记录时返回空进度，不抛错。v1 档在这里升成 v2 形状。 */
export function readLoveSeriesProgress(seriesId: string): LoveSeriesProgress {
  if (typeof window === "undefined") return empty();
  try {
    return parse(localStorage.getItem(storageKey(seriesId)));
  } catch {
    return empty();
  }
}

/**
 * 记录一场场景的完成（completed + lastScene + outcome），写 v2。
 * `act` 是这一幕的幕号（1 起）：给了就取「已完成里的最大幕号」，重玩靠前的一幕不会把进度倒退；
 * 不给就沿用旧值（v1 档因此保持 `lastAct` 缺省）。写入失败时静默保留会话内进度。
 */
export function writeLoveSeriesProgress(
  seriesId: string,
  sceneId: string,
  outcome: LovePlayOutcome,
  act?: number,
): LoveSeriesProgress {
  const cur = readLoveSeriesProgress(seriesId);
  const completed = cur.completed.includes(sceneId) ? cur.completed : [...cur.completed, sceneId];
  const actN = typeof act === "number" && Number.isFinite(act) && act >= 1 ? Math.trunc(act) : undefined;
  const lastAct = actN === undefined ? cur.lastAct : Math.max(cur.lastAct ?? 0, actN);
  const next: LoveSeriesProgress = { v: 2, completed, lastScene: sceneId, outcome: { ...cur.outcome, [sceneId]: outcome } };
  if (lastAct !== undefined) next.lastAct = lastAct;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(storageKey(seriesId), JSON.stringify(next));
    } catch {
      // 存储不可用：本次进度仍返回给调用方，界面可继续工作。
    }
  }
  return next;
}

import type { LovePlayOutcome } from "./love-play-client";

/** 剧情线进度（设备端 localStorage 独立管理，不进 store，避免 persist 版本迁移）。 */
export interface LoveSeriesProgress {
  completed: string[];
  lastScene: string;
  outcome: Record<string, LovePlayOutcome>;
}

const EMPTY: LoveSeriesProgress = { completed: [], lastScene: "", outcome: {} };
const storageKey = (seriesId: string) => `socialcoach.love-play.series.${seriesId}`;

function parse(raw: string | null): LoveSeriesProgress {
  if (!raw) return EMPTY;
  try {
    const p = JSON.parse(raw) as Partial<LoveSeriesProgress>;
    const completed = Array.isArray(p.completed) ? p.completed.filter((x): x is string => typeof x === "string") : [];
    const outcome: Record<string, LovePlayOutcome> = {};
    if (p.outcome && typeof p.outcome === "object") {
      for (const [k, v] of Object.entries(p.outcome)) {
        if (k && (v === "success" || v === "partial" || v === "failure")) outcome[k] = v;
      }
    }
    return { completed, lastScene: typeof p.lastScene === "string" ? p.lastScene : "", outcome };
  } catch {
    return EMPTY;
  }
}

/** 读取某条剧情线的设备端进度；读取失败/未记录时返回空进度，不抛错。 */
export function readLoveSeriesProgress(seriesId: string): LoveSeriesProgress {
  if (typeof window === "undefined") return EMPTY;
  try {
    return parse(localStorage.getItem(storageKey(seriesId)));
  } catch {
    return EMPTY;
  }
}

/** 记录一场场景的完成（completed + lastScene + outcome）；写入失败时静默保留会话内进度。 */
export function writeLoveSeriesProgress(seriesId: string, sceneId: string, outcome: LovePlayOutcome): LoveSeriesProgress {
  const cur = readLoveSeriesProgress(seriesId);
  const completed = cur.completed.includes(sceneId) ? cur.completed : [...cur.completed, sceneId];
  const next: LoveSeriesProgress = { completed, lastScene: sceneId, outcome: { ...cur.outcome, [sceneId]: outcome } };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(storageKey(seriesId), JSON.stringify(next));
    } catch {
      // 存储不可用：本次进度仍返回给调用方，界面可继续工作。
    }
  }
  return next;
}

import { L, type Lang } from "@/data/taxonomy";
import type { LovePlayOutcome } from "./love-play-client";
import type { LovePlayRecord } from "./love-story";

/**
 * 结局图鉴的纯投影：只从已经落盘的 `LovePlayRecord` 里读，
 * 不猜没走到过的分支，也不把选项、台词或未解锁内容带进列表。
 *
 * 同一场 + 同一个结局只占一格：收集次数与最近一次时间会累加，
 * 但不会因为重玩十次就出现十条同名结局。
 */
export interface LoveGalleryEntry {
  /** scenarioId + endingId/outcome，稳定且可用于 React key。 */
  key: string;
  scenarioId: string;
  endingId: string | null;
  outcome: LovePlayOutcome;
  firstAt: number;
  lastAt: number;
  count: number;
}

/** 命名结局的静态元数据；未登记的名字只是还没写文案，不伪造标题。 */
export interface LoveNamedEnding {
  scenarioId: string;
  seriesId: string;
  title: L;
  /** 图鉴里的一句提示，不剧透达成条件。 */
  hint: L;
}

export const LOVE_NAMED_ENDINGS: Record<string, LoveNamedEnding> = {
  "said-it-plain": {
    scenarioId: "love-rio-deadline-night",
    seriesId: "love-arc-rio-clarify",
    title: L("把话说清", "Said it plain"),
    hint: L("答复、关系和下一步，都在同一个晚上说了清楚。", "The answer, the relationship and the next step — all said plainly in one night."),
  },
  "clean-parting": {
    scenarioId: "love-rio-deadline-night",
    seriesId: "love-arc-rio-clarify",
    title: L("好好告别", "A clean parting"),
    hint: L("没有谁欠谁。这段关系停在了有句号的地方。", "Nobody owes anybody. This story stopped where the period was."),
  },
};

export function buildLoveEndingGallery(records: readonly LovePlayRecord[]): LoveGalleryEntry[] {
  const map = new Map<string, LoveGalleryEntry>();
  for (const record of records) {
    const endingId = record.endingId ?? null;
    const key = `${record.scenarioId}:${endingId ?? record.outcome}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.firstAt = Math.min(existing.firstAt, record.endedAt);
      existing.lastAt = Math.max(existing.lastAt, record.endedAt);
    } else {
      map.set(key, {
        key,
        scenarioId: record.scenarioId,
        endingId,
        outcome: record.outcome,
        firstAt: record.endedAt,
        lastAt: record.endedAt,
        count: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/** 图鉴标题：命名结局用自己的名字，其余按结果档位，不额外发明剧情。 */
export function loveGalleryLabel(entry: LoveGalleryEntry, lang: Lang): string | null {
  if (entry.endingId) return LOVE_NAMED_ENDINGS[entry.endingId]?.title[lang] ?? null;
  return null;
}

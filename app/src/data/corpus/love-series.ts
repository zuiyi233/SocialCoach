import type { L } from "../taxonomy";
import type { Scenario } from "./types";
import { SCENARIOS } from ".";

/** 一条可循序练习的剧情线：由语料中带 series 标签的场景聚合而成。 */
export interface LoveSeries {
  id: string;
  name: L;
  /**
   * 有序：显式 `series.order` 优先，没标序的场景按 SCENARIOS 串联顺序补在后面。
   * 语料文件串联顺序不是叙事决策，所以跨文件组线时必须自己标 order。
   */
  scenarios: Scenario[];
  /**
   * 每一场都是同一批 NPC。只有 true 时才按「第 N 幕」的连续剧情口径展示；
   * false 是同一主题下的独立场景合集，互相没有剧情承接。
   */
  continuous: boolean;
}

/** 一场的 NPC 阵容（去掉学习者位），用来判断线内人物是否贯穿。 */
const castOf = (s: Scenario) => s.characters.filter((c) => c.id !== "you").map((c) => c.id).sort().join("+");

function buildSeries(): LoveSeries[] {
  const order: string[] = [];
  const byId = new Map<string, { series: LoveSeries; ranked: { s: Scenario; rank: number; idx: number }[] }>();
  for (const s of SCENARIOS) {
    // 只聚合恋爱场景：series 标签本身是跨模块用的（职场/家庭线也挂 series），
    // 不过滤会把 junior-aze / family-care 混进恋爱主页。
    if (!s.series || s.context !== "romantic") continue;
    let entry = byId.get(s.series.id);
    if (!entry) {
      entry = { series: { id: s.series.id, name: s.series.name, scenarios: [], continuous: true }, ranked: [] };
      byId.set(s.series.id, entry);
      order.push(s.series.id);
    }
    entry.ranked.push({ s, rank: s.series.order ?? Number.MAX_SAFE_INTEGER, idx: entry.ranked.length });
  }
  const out: LoveSeries[] = [];
  for (const id of order) {
    const entry = byId.get(id)!;
    entry.series.scenarios = entry.ranked.sort((a, b) => a.rank - b.rank || a.idx - b.idx).map((r) => r.s);
    const first = castOf(entry.series.scenarios[0]);
    entry.series.continuous = entry.series.scenarios.every((s) => castOf(s) === first);
    out.push(entry.series);
  }
  return out;
}

export const LOVE_SERIES: LoveSeries[] = buildSeries();
export const loveSeriesById = (id: string): LoveSeries | undefined => LOVE_SERIES.find((s) => s.id === id);

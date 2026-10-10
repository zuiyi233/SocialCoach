import type { L } from "../taxonomy";
import type { Scenario } from "./types";
import { SCENARIOS } from ".";

/** 一条可循序练习的剧情线：由语料中带 series 标签的场景聚合而成。 */
export interface LoveSeries {
  id: string;
  name: L;
  /** 有序：沿用 SCENARIOS 数组顺序（语料文件串联顺序即叙事顺序）。 */
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
  const byId = new Map<string, LoveSeries>();
  for (const s of SCENARIOS) {
    // 只聚合恋爱场景：series 标签本身是跨模块用的（职场/家庭线也挂 series），
    // 不过滤会把 junior-aze / family-care 混进恋爱主页。
    if (!s.series || s.context !== "romantic") continue;
    let ser = byId.get(s.series.id);
    if (!ser) {
      ser = { id: s.series.id, name: s.series.name, scenarios: [], continuous: true };
      byId.set(s.series.id, ser);
      order.push(s.series.id);
    }
    ser.scenarios.push(s);
  }
  for (const ser of byId.values()) {
    const first = castOf(ser.scenarios[0]);
    ser.continuous = ser.scenarios.every((s) => castOf(s) === first);
  }
  return order.map((id) => byId.get(id)!);
}

export const LOVE_SERIES: LoveSeries[] = buildSeries();
export const loveSeriesById = (id: string): LoveSeries | undefined => LOVE_SERIES.find((s) => s.id === id);

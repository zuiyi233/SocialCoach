import type { L } from "../taxonomy";
import type { Scenario } from "./types";
import { SCENARIOS } from ".";

/** 一条可循序练习的剧情线：由语料中带 series 标签的场景聚合而成。 */
export interface LoveSeries {
  id: string;
  name: L;
  /** 有序：沿用 SCENARIOS 数组顺序（语料文件串联顺序即叙事顺序）。 */
  scenarios: Scenario[];
}

function buildSeries(): LoveSeries[] {
  const order: string[] = [];
  const byId = new Map<string, LoveSeries>();
  for (const s of SCENARIOS) {
    if (!s.series) continue;
    let ser = byId.get(s.series.id);
    if (!ser) {
      ser = { id: s.series.id, name: s.series.name, scenarios: [] };
      byId.set(s.series.id, ser);
      order.push(s.series.id);
    }
    ser.scenarios.push(s);
  }
  return order.map((id) => byId.get(id)!);
}

export const LOVE_SERIES: LoveSeries[] = buildSeries();
export const loveSeriesById = (id: string): LoveSeries | undefined => LOVE_SERIES.find((s) => s.id === id);

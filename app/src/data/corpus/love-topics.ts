import { L } from "../taxonomy";

/**
 * Romance-track topics for the love module. Unlike the CASEL skills (which are
 * cross-context), a love topic is specific to the romantic context: it lets the
 * love page group scenarios, and lets knowledge retrieval prefer theories and
 * cases about the same topic over generic (often workplace-flavored) ones.
 */
export type LoveTopicId =
  | "approach" // 初次认识 / 搭讪
  | "define-relationship" // 暧昧期 / 明确关系
  | "rejection" // 表白与被拒
  | "breakup" // 分手与前任
  | "boundary" // 边界与独处
  | "long-distance" // 异地
  | "family" // 见家长
  | "trust"; // 信任与重建

export interface LoveTopic {
  id: LoveTopicId;
  name: L;
}

export const LOVE_TOPICS: LoveTopic[] = [
  { id: "approach", name: L("初次认识", "First approach") },
  { id: "define-relationship", name: L("暧昧与明确关系", "Ambiguity & commitment") },
  { id: "rejection", name: L("表白与被拒", "Confession & rejection") },
  { id: "breakup", name: L("分手与前任", "Breakup & exes") },
  { id: "boundary", name: L("边界与独处", "Boundaries") },
  { id: "long-distance", name: L("异地", "Long distance") },
  { id: "family", name: L("见家长", "Meeting the family") },
  { id: "trust", name: L("信任", "Trust") },
];

export const loveTopicById = (id: LoveTopicId) => LOVE_TOPICS.find((t) => t.id === id);

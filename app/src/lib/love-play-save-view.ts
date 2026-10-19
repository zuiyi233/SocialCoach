import type { L, Lang } from "@/data/taxonomy";
import type { Scenario } from "@/data/corpus/types";
import type { ChatMessage } from "./types";
import type { LovePlayEmotion, LovePlayOutcome } from "./love-play-client";
import type { LoveCarryTurn } from "./love-carry-store";
import { LovePlaySaveSchema, type LovePlaySave } from "./love-story";

/**
 * PlayScene 与 story slot 之间的纯决策层。
 *
 * 组件只负责把「已确认的界面状态」交给这里：
 * - `buildLovePlaySave` 只在稳定边界（有选项的回合、已收束的回合）生成合法快照；
 * - `planLovePlayRestore` 决定恢复 / 新局 / 停写，不碰模型请求；
 * - `pickNextLoveScene` 按 `series.order` 选下一幕，不依赖 `lastScene`；
 * - `canSubmitLovePlayRecord` 保证「记入统计」只提交一次。
 *
 * 这些函数没有 React、没有 localStorage，测试可以直接断言。
 */

/** 与 love-story 的 HISTORY_MAX 同口径：超过就裁掉最旧的行，但当前句必须留下。 */
const HISTORY_MAX = 40;

export interface LovePlaySaveInput {
  scenario: Scenario;
  lang: Lang;
  /** 已确认的对话（开场、学习者、NPC），失败/在途的尝试不在这里。 */
  history: ChatMessage[];
  /** 正在显示的 NPC 台词 id；必须能在 history 里找到。 */
  currentLineKey: string;
  /** 非收束回合的 2–4 个选项；收束时为 null。 */
  options: L[] | null;
  emotion: LovePlayEmotion;
  stance: number | null;
  /** 本局开场是否显示过承接句。 */
  carryover: boolean;
  learnerLines: LoveCarryTurn[];
  outcome: LovePlayOutcome | null;
  endingId?: string | null;
  routeState?: unknown;
  recorded: boolean;
  startedAt: number;
  updatedAt?: number;
}

/** 只留 npc / learner 两类行；save schema 不认识 coach / event。 */
function confirmed(history: ChatMessage[]): ChatMessage[] {
  return history.filter((m) => m.role === "npc" || m.role === "learner");
}

/** 裁剪到 HISTORY_MAX，同时保证 currentLineId 仍在窗口里（当前句通常就是最后一行）。 */
export function trimLovePlayHistory(history: ChatMessage[], currentLineId: string): ChatMessage[] | null {
  const rows = confirmed(history);
  const index = rows.findIndex((m) => m.id === currentLineId && m.role === "npc");
  if (index < 0) return null;
  const start = Math.max(0, Math.min(index, rows.length - HISTORY_MAX));
  return rows.slice(start, start + HISTORY_MAX);
}

/**
 * 裁剪历史后，learnerLines 只能保留仍然落在窗口里的发言，且顺序不变。
 * 旧窗口里被丢掉的那些直接跳过，而不是让整份 save 变成 invalid。
 */
export function fitLearnerLines(history: ChatMessage[], lines: LoveCarryTurn[]): LoveCarryTurn[] {
  let cursor = 0;
  const kept: LoveCarryTurn[] = [];
  for (const line of lines) {
    let found = -1;
    for (let i = cursor; i < history.length; i++) {
      const m = history[i];
      if (m.role === "learner" && m.text === line.text) {
        found = i;
        break;
      }
    }
    if (found < 0) continue;
    kept.push(line);
    cursor = found + 1;
  }
  return kept;
}

/**
 * 从界面状态构造一份可落盘的存档。返回 null 表示「现在不是稳定边界」：
 * 当前句还没进 history、playing 却没有 2–4 个选项、或形状过不了 schema。
 * 这样调用方可以放心地把所有状态交给它，坏状态不会写进 slot。
 */
export function buildLovePlaySave(input: LovePlaySaveInput): LovePlaySave | null {
  const history = trimLovePlayHistory(input.history, input.currentLineKey);
  if (!history) return null;

  const ended = input.outcome !== null;
  const options = ended ? null : input.options;
  if (!ended && (!options || options.length < 2 || options.length > 4)) return null;

  const save: LovePlaySave = {
    v: 1,
    scenarioId: input.scenario.id,
    seriesId: input.scenario.series?.id ?? null,
    lang: input.lang,
    status: ended ? "ended" : "playing",
    history: history.map((m) =>
      m.characterId
        ? { id: m.id, role: m.role as "npc" | "learner", characterId: m.characterId, text: m.text, lang: input.lang, ts: m.ts }
        : { id: m.id, role: m.role as "npc" | "learner", text: m.text, lang: input.lang, ts: m.ts },
    ),
    currentLineId: input.currentLineKey,
    options,
    emotion: input.emotion,
    stance: input.stance,
    carryover: input.carryover,
    learnerLines: fitLearnerLines(history, input.learnerLines),
    outcome: input.outcome,
    endingId: input.endingId ?? null,
    routeState: input.routeState,
    recorded: input.recorded,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt ?? Date.now(),
  };

  const parsed = LovePlaySaveSchema.safeParse(save);
  return parsed.success ? parsed.data : null;
}

export interface LovePlayResumeState {
  history: ChatMessage[];
  npcLine: { key: string; characterId?: string; text: string };
  options: L[] | null;
  emotion: LovePlayEmotion;
  stance: number | null;
  outcome: LovePlayOutcome | null;
  endingId: string | null;
  routeState?: unknown;
  recorded: boolean;
  learnerLines: LoveCarryTurn[];
  learnerTurns: number;
  carryover: boolean;
  startedAt: number;
  /** 已结束的幕用最后一次落盘时间当 endedAt；进行中不使用。 */
  endedAt: number;
  /** 所有已经显示过的 NPC 行：恢复时预置进 spokenRef，避免重读历史语音。 */
  spokenKeys: string[];
}

/** 把一份合法 save 还原成 PlayScene 需要的纯数据；currentLineId 不指向 NPC 行时返回 null。 */
export function restoreLovePlayView(save: LovePlaySave): LovePlayResumeState | null {
  const current = save.history.find((m) => m.id === save.currentLineId && m.role === "npc");
  if (!current) return null;

  const history: ChatMessage[] = save.history.map((m) =>
    m.role === "npc"
      ? { id: m.id, role: "npc" as const, characterId: m.characterId, text: m.text, ts: m.ts }
      : { id: m.id, role: "learner" as const, text: m.text, ts: m.ts },
  );

  return {
    history,
    npcLine: { key: current.id, characterId: current.characterId, text: current.text },
    options: save.options,
    emotion: save.emotion,
    stance: save.stance,
    outcome: save.outcome,
    endingId: save.endingId ?? null,
    routeState: save.routeState,
    recorded: save.recorded,
    learnerLines: save.learnerLines,
    learnerTurns: save.history.filter((m) => m.role === "learner").length,
    carryover: save.carryover,
    startedAt: save.startedAt,
    endedAt: save.updatedAt,
    spokenKeys: save.history.filter((m) => m.role === "npc").map((m) => m.id),
  };
}

export type LovePlaySaveRead = {
  status: "empty" | "ok" | "corrupt" | "incompatible" | "unavailable";
  save?: LovePlaySave;
  raw?: string;
};

export type LovePlaySaveNotice = "resumed" | "corrupt" | "incompatible" | "unavailable";

export type LovePlayRestorePlan =
  | {
      mode: "resume";
      save: LovePlaySave;
      view: LovePlayResumeState;
      autosave: true;
      notice: "resumed";
    }
  | {
      mode: "fresh";
      save: null;
      view: null;
      autosave: boolean;
      notice: Exclude<LovePlaySaveNotice, "resumed"> | null;
    };

/**
 * 读取结果 → 恢复决定。
 * - ok：直接恢复，绝不重新请求模型；
 * - empty：开新局并允许自动存档；
 * - corrupt / incompatible / unavailable：仍可玩，但停写，原件不覆盖。
 */
export function planLovePlayRestore(read: LovePlaySaveRead): LovePlayRestorePlan {
  if (read.status === "ok") {
    if (read.save) {
      const view = restoreLovePlayView(read.save);
      if (view) return { mode: "resume", save: read.save, view, autosave: true, notice: "resumed" };
    }
    return { mode: "fresh", save: null, view: null, autosave: false, notice: "corrupt" };
  }
  if (read.status === "empty") {
    return { mode: "fresh", save: null, view: null, autosave: true, notice: null };
  }
  if (read.status === "unavailable") {
    return { mode: "fresh", save: null, view: null, autosave: false, notice: "unavailable" };
  }
  return { mode: "fresh", save: null, view: null, autosave: false, notice: read.status };
}

/** 只有新局才发起第一个模型请求；恢复路径必须为 false。 */
export function restoreNeedsModelRequest(plan: LovePlayRestorePlan): boolean {
  return plan.mode === "fresh";
}

/** 自动存档去重：内容相同（不含 updatedAt）不重复写 revision。 */
export function lovePlaySaveSignature(save: LovePlaySave): string {
  return JSON.stringify({ ...save, updatedAt: 0 });
}

export interface LoveSceneLike {
  id: string;
  series?: { order?: number };
}

export interface PlayingSceneLike {
  id: string;
  updatedAt: number;
}

export type LoveSceneChoice<T extends LoveSceneLike> = {
  scene: T;
  index: number;
  mode: "playing" | "next" | "replay";
};

/** `series.order` 优先；没标序的场景按数组下标补在后面。 */
export function sortLoveScenes<T extends LoveSceneLike>(scenes: T[]): T[] {
  return scenes
    .map((scene, index) => ({ scene, index, rank: scene.series?.order ?? index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.scene);
}

/**
 * 系列页的下一幕：
 * 1. 有序场景里最近更新的进行中 save；
 * 2. 否则第一个未完成幕；
 * 3. 全部完成 → 第一幕重玩。
 */
export function pickNextLoveScene<T extends LoveSceneLike>(
  scenes: T[],
  completed: string[],
  playing: PlayingSceneLike[],
): LoveSceneChoice<T> | null {
  const sorted = sortLoveScenes(scenes);
  if (!sorted.length) return null;

  const indexById = new Map(sorted.map((scene, index) => [scene.id, index]));
  const inProgress = playing
    .flatMap((save) => {
      const index = indexById.get(save.id);
      return index === undefined ? [] : [{ index, updatedAt: save.updatedAt }];
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.index - b.index);
  if (inProgress.length) {
    const { index } = inProgress[0];
    return { scene: sorted[index], index, mode: "playing" };
  }

  const done = new Set(completed);
  const next = sorted.findIndex((scene) => !done.has(scene.id));
  if (next >= 0) return { scene: sorted[next], index: next, mode: "next" };
  return { scene: sorted[0], index: 0, mode: "replay" };
}

/** 「记入统计」只提交一次；刷新恢复的 recorded 同样挡住重复记录。 */
export function canSubmitLovePlayRecord(recorded: boolean): boolean {
  return !recorded;
}

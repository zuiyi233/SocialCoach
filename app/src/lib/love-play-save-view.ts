import type { L, Lang } from "@/data/taxonomy";
import type { Scenario } from "@/data/corpus/types";
import type { ChatMessage } from "./types";
import type { LovePlayEmotion, LovePlayOutcome } from "./love-play-client";
import type { LoveCarryTurn } from "./love-carry-store";
import { LovePlaySaveSchema, type LovePlaySave } from "./love-story";
import {
  emptyRioState,
  isRioStateCurrent,
  migrateLegacyRioState,
  parseRioState,
  type RioOutcome,
  type RioRelationshipState,
} from "./love-relationship-state";
import {
  RIO_ACT4_BEAT_GROUPS,
  RIO_ROUTE_ACT_SCENES,
  matchRioRequires,
  type RioBeat,
  type RioBeatGroup,
} from "./rio-route";

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

/* ------------------------------------------------------------------ *
 * Rio 第 4 幕：账本快照与作者写死的状态拍点（spec-love-rio-route §3.5）
 *
 * 进行中的动作快照存 save.routeState；已提交的账本存 story routes。
 * 两者都只装 `RioRelationshipState`，`stance` 是会话内数值，永不写进来。
 * ------------------------------------------------------------------ */

/** 与 LoveSeriesProgress 同构的只读形状；这里不 import 存储模块，保持可测试的纯函数。 */
export interface RioProgressLike {
  completed: string[];
  /** 旧档的「最近完成的一场」；迁移时用它取 outcome，缺省按空串。 */
  lastScene?: string;
  outcome: Record<string, RioOutcome>;
}

/** save.routeState / story routes 的两种合法形状：裸 state（旧档）或带拍点记录的包装。 */
export interface RioRouteSnapshot {
  rio: RioRelationshipState;
  appliedBeats: string[];
}

const RIO_SCENE_ACT = new Map<string, number>(
  Object.entries(RIO_ROUTE_ACT_SCENES).map(([act, sceneId]) => [sceneId, Number(act)]),
);

/** 包装成落盘形状；appliedBeats 复制一份，调用方后续改动不会反向污染账本。 */
export function rioRouteSnapshot(
  state: RioRelationshipState,
  appliedBeats: readonly string[],
): RioRouteSnapshot {
  return { rio: state, appliedBeats: [...appliedBeats] };
}

/**
 * 解包 save.routeState。兼容裸 state（没有 appliedBeats 的旧档）。
 * 坏形状返回 null，由调用方回落到已提交账本或迁移，不猜。
 */
export function readRioRouteSnapshot(raw: unknown): RioRouteSnapshot | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value) && "rio" in value) {
    const wrapper = value as { rio?: unknown; appliedBeats?: unknown };
    const parsed = parseRioState(wrapper.rio);
    if (!parsed.ok) return null;
    const appliedBeats = Array.isArray(wrapper.appliedBeats)
      ? wrapper.appliedBeats.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    return { rio: parsed.state, appliedBeats };
  }
  const parsed = parseRioState(value);
  return parsed.ok ? { rio: parsed.state, appliedBeats: [] } : null;
}

/** 已完成场景里的最大幕号；0 = 还没完成任何一幕。 */
function latestCompletedAct(progress: RioProgressLike | null | undefined): number {
  if (!progress) return 0;
  let latest = 0;
  for (const sceneId of progress.completed) {
    const act = RIO_SCENE_ACT.get(sceneId) ?? 0;
    if (act > latest) latest = act;
  }
  return latest;
}

/**
 * state 是否落后于系列进度。只在这一种情况下标 stale（开场切中性变体）：
 * - 进度已经走到更后面的幕（state 写失败 / 旧设备）；
 * - 同一幕但 outcome 对不上（旧一次通关留下的旧账）。
 * 新局（lastAct=0）与本幕进行中的快照（进度还没结算这一幕）都不算落后——
 * 「这一幕还没完成」不是「账本过期」。
 */
function rioStateBehindProgress(
  state: RioRelationshipState,
  progress: RioProgressLike | null | undefined,
): boolean {
  if (state.lastAct === 0) return false;
  const latest = latestCompletedAct(progress);
  if (latest > state.lastAct) return true;
  if (latest < state.lastAct) return false;
  return !isRioStateCurrent(state, progress ?? { completed: [], outcome: {} });
}

/**
 * 挂载时决定第 4 幕用哪本账：
 * 1. 本幕进行中的存档快照（比已提交 routes 新，spec §3.3）；
 * 2. 已提交到 story routes 的账本（裸 state）；
 * 3. 没有账本 → 从旧 3 幕进度迁移（legacy=true，中性开场）。
 * 没有任何进度时给空账本，让新玩家看到「你没见过的邮件」变体。
 * stale 只标在存在过的账本上，且不写盘——磁盘原文由调用方原样保留。
 */
export function planRioRouteEntry(sources: {
  /** save.routeState（只在 resume 时存在）。 */
  saved?: unknown;
  /** story routes[seriesId]（已提交账本）。 */
  committed?: unknown;
  progress?: RioProgressLike | null;
}): RioRouteSnapshot {
  const saved = readRioRouteSnapshot(sources.saved ?? null);
  const committed = saved ? null : readRioRouteSnapshot(sources.committed ?? null);
  const base = saved ?? committed;
  // lastAct=0 的账本没有声明任何已发生事实：进度若更靠前，按旧档迁移而不是把它当新玩家。
  if (base && base.rio.lastAct > 0) {
    const rio = rioStateBehindProgress(base.rio, sources.progress)
      ? { ...base.rio, stale: true }
      : base.rio;
    return { rio, appliedBeats: [...base.appliedBeats] };
  }
  const progress = sources.progress;
  if (progress && progress.completed.length > 0) {
    return {
      rio: migrateLegacyRioState({
        completed: progress.completed,
        lastScene: progress.lastScene ?? "",
        outcome: progress.outcome,
      }),
      appliedBeats: [],
    };
  }
  return { rio: emptyRioState(), appliedBeats: [] };
}

/**
 * 下一个该出现的作者拍点组：先「她想要什么」，再「答复前的下一步」。
 *
 * 一组只出现一次——玩家点过其中任一拍点就算问过这个问题，不要求把三条都点完；
 * 组内按 `requires` 过滤，偏好已知后不再重复给「问她想要什么」。
 * 两组都有记录时返回 null，普通回合继续用模型生成的选项。
 */
export function nextRioBeatGroup(
  state: RioRelationshipState | null | undefined,
  appliedBeats: readonly string[],
): RioBeatGroup | null {
  const applied = new Set(appliedBeats);
  for (const group of RIO_ACT4_BEAT_GROUPS) {
    if (group.beats.some((beat) => applied.has(beat.id))) continue;
    const beats = group.beats.filter((beat) => matchRioRequires(beat.requires, state));
    if (beats.length) return { ...group, beats };
  }
  return null;
}

/**
 * 选项文本 → 作者拍点。只认当前语言下的逐字原文：模型改写的近义句不写状态，
 * 也不拿模型文本冒充作者证据（spec §3.5「作者写死选项 + 逐字证据」）。
 */
export function rioBeatForOption(
  group: RioBeatGroup | null | undefined,
  text: string,
  lang: Lang,
): RioBeat | null {
  if (!group) return null;
  return group.beats.find((beat) => beat.text[lang] === text) ?? null;
}

/**
 * 本幕判出结果时要写进系列进度的 outcome。
 * terminal 优先；ended-only（没有目标判定、自然收尾）按 partial 记，同样算本幕完成，
 * 不能因为「只是收尾」把下一幕一直卡住。
 */
export function seriesOutcomeFor(
  terminal: LovePlayOutcome | null | undefined,
  ended: boolean | null | undefined,
): LovePlayOutcome | null {
  if (terminal) return terminal;
  return ended ? "partial" : null;
}

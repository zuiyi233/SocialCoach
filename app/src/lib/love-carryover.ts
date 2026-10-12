import { L, type Lang } from "@/data/taxonomy";
import { loveSeriesById } from "@/data/corpus/love-series";
import type { Scenario } from "@/data/corpus/types";
import type { LovePlayOutcome } from "./love-play-client";
import { readLoveSeriesProgress } from "./love-series-progress";
import { loveCarryAskLine, markLoveCarryAsked, pendingLoveCarryForOpening } from "./love-carry-store";
import { defaultLearnerId, speakerOf } from "./session-utils";

/**
 * P1 实验（review-2026-10-13-love-companionship §10.1）的写死核心：
 * 「上一幕的结果会不会被玩家感到被带走」只需要 2 条线 × 3 种结局 = 6 句台词就能验证，
 * 所以这里刻意是硬编码字面量——删掉这个对象等于删掉整个实验，不留结构。
 *
 * P2 之后它是**兜底**：学习者在上一场亲手留下过一句承诺时，开场引用那句（`love-carry-store`）；
 * 没有承诺时回到这 6 句。两条路都只在 continuous 线上走（每一幕同一批 NPC）：
 * 换人的线里让 NPC 声称记得上一幕，是对「谁在说话」的假话。
 *
 * 台词口径：只谈间隔与「上次谈到哪儿」的形状，不点名任何语料无法保证玩家真说过的
 * 事件、日期、地点或原话；success 不转暖、不发好感，只承认落地的部分并把下一件更难的事
 * 摆上桌；failure 只留 NPC 自己的余温变化，不辱骂、不造危机。NPC 全程不出角色做评价。
 */
export const LOVE_CARRYOVER: Record<string, Record<LovePlayOutcome, L>> = {
  // 暧昧到说清楚（Rio）：从「用忙挡着」到把话说定。
  "love-arc-rio-clarify": {
    success: L(
      "上次你没有把话缩回去，这次我也不先岔开——换你先说。",
      "You didn’t pull your words back last time, so I won’t steer off the subject first this time — you go ahead.",
    ),
    partial: L(
      "上回说到一半就停住了，这次我不替你补下半句，你自己接着讲。",
      "We stopped halfway last time, and I won’t finish your sentence for you — pick it up yourself.",
    ),
    failure: L(
      "上次就停在那儿了，这回我不会再先开口圆场，你想清楚再答我。",
      "That’s where it ended last time, and I’m not the one smoothing it over first — think before you answer me.",
    ),
  },
  // 被拒之后（Eve）：联系频率与「谁说了谁的话」，她的线不因为谈话变软。
  // 每一句都要在同一线的**两个**前一幕面前都说得通（第 1 幕承接第 0 幕，第 2 幕承接第 1 幕），
  // 所以只准谈间隔与「上次谈到哪儿」的形状：`love-reject-shared-circle` 的 objectives 与
  // success 里没有任何承诺可被「做到了 / 应了一半」引用，那一版是编造过去。
  "love-arc-eve-after-no": {
    success: L(
      "上次没有闹僵，这回我也不绕弯子——你想说什么，就照直说。",
      "Nothing came apart last time, and I’m not going to circle this time either — if you’ve got something to say, say it straight.",
    ),
    partial: L(
      "上回说到哪儿就停到哪儿，我不替你说下一句。你先讲。",
      "We stopped last time right where it stopped. I won’t say the next line for you — you start.",
    ),
    failure: L(
      "上回之后我把话收短了，今天先说清一句：我的答复没有变。",
      "After last time I kept my words shorter, so I’ll start with this: my answer hasn’t moved.",
    ),
  },
};

export interface LoveCarryover {
  /** 承接句（已按当前界面语言取值）：学习者的原话引用，或 P1 的结局兜底句；无承接时 null。 */
  text: string | null;
  /** 承接所依据的那一幕（紧邻的前一幕）的结局；没有记录则 null。 */
  outcome: LovePlayOutcome | null;
  /** 本场在自己线内的序号（0 起）；场景不属于任何线时 null。 */
  actIndex: number | null;
}

const NONE: LoveCarryover = { text: null, outcome: null, actIndex: null };

/** 纯查表：按线 + 结局取兜底承接句。任何输入不全或线没写过承接都回 null，不碰 DOM 与存储。 */
export function pickLoveCarryover(
  outcome: LovePlayOutcome | null,
  seriesId: string | undefined,
  lang: Lang,
): string | null {
  if (!outcome || !seriesId) return null;
  const line = LOVE_CARRYOVER[seriesId]?.[outcome];
  return line ? line[lang] : null;
}

/** 这一幕在说话的人：承诺按 TA 存、按 TA 取。 */
function npcOf(scenario: Scenario): string {
  return speakerOf(scenario, defaultLearnerId(scenario)).id;
}

/**
 * 取本场开场该带的承接句，优先级两条：
 * 1. 学习者在**同一条线、同一个 NPC** 别的场次里亲手留下的承诺——引用他的原话；
 * 2. 否则回到 P1：只看**紧邻的前一幕**（不是「任意已完成的场景」）的结局查表，
 *    这样一条线才读起来是一条链，而不是散点存档。
 *
 * 两条都先过 continuous 与 actIndex ≥ 1 的门槛。设备端进度与承接只在这里读，
 * 唯一写入是提问计数（`markLoveCarryAsked`）。
 *
 * `seriesId` 相等这一条不是形式主义：语料里 `tess` 同时是两条线上的两个角色
 * （爱好活动上认识的陌生人 / 异地的另一半），还共用一张立绘。按线隔离后
 * 这个撞 id 在本功能里无害，语料 id 本身不在这里动。
 */
export function loveCarryoverForScene(seriesId: string, scenarioId: string, lang: Lang): LoveCarryover {
  const series = loveSeriesById(seriesId);
  if (!series || !series.continuous) return NONE;
  const actIndex = series.scenarios.findIndex((s) => s.id === scenarioId);
  if (actIndex < 1) return actIndex === 0 ? { ...NONE, actIndex: 0 } : NONE;
  const scenario = series.scenarios[actIndex];
  const prevId = series.scenarios[actIndex - 1].id;
  const outcome = readLoveSeriesProgress(series.id).outcome[prevId] ?? null;
  const carry = pendingLoveCarryForOpening(series.id, npcOf(scenario), scenario.id);
  const ask = carry ? loveCarryAskLine(carry, lang) : null;
  if (carry && ask) {
    // 引用过就计数（state 不动）：askCount 既让幕内开场从 `ask` 换到 `askAgain`，
    // 也让跟进卡知道今天该不该换个问法——同一个计数，两处都读，不许各记一份。
    markLoveCarryAsked(carry.id);
    return { text: ask, outcome, actIndex };
  }
  return { text: pickLoveCarryover(outcome, series.id, lang), outcome, actIndex };
}

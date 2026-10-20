import { L, type Lang } from "@/data/taxonomy";
import { loveSeriesById } from "@/data/corpus/love-series";
import type { Scenario } from "@/data/corpus/types";
import type { LovePlayOutcome } from "./love-play-client";
import { readLoveSeriesProgress } from "./love-series-progress";
import { loveCarryAskLine, loveCarryLine, markLoveCarryAsked, pendingLoveCarryForOpening, readLoveCarries } from "./love-carry-store";
import { defaultLearnerId, speakerOf } from "./session-utils";

/**
 * P1 实验（review-2026-10-13-love-companionship §10.1）的写死核心：
 * 「上一幕的结果会不会被玩家感到被带走」只需要 2 条线 × 3 种结局 = 6 句台词就能验证，
 * 所以这里刻意是硬编码字面量——删掉这个对象等于删掉整个实验，不留结构。
 *
 * P2 之后它是**兜底**：学习者在上一场亲手留下过一句承诺时，开场引用那句（`love-carry-store`）；
 * 承诺答过（kept / open）由 G06 的 NPC 层用 `CARRY_LINES` 回头提；没有承诺时回到这 6 句。
 * 各条路都只在 continuous 线上走（每一幕同一批 NPC）：
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

/**
 * G22 / G06：同一线里按「前一幕」再细分一层的专属承接。
 *
 * 16 句通用承接是跨 NPC 共用的兜底，所以只能谈间隔与「上次谈到哪儿」的形状。
 * Rio 六幕每一幕的压力不同，同一句「上次你没把话缩回去」在第 2、3、4 幕会指错对象；
 * 这里只覆盖 Rio 的三处前幕 → 本幕衔接（第 4 幕 id 见 spec-love-rio-route §2.1），
 * 其余场景继续走 `LOVE_CARRYOVER`，不写 50 角色 × 16 句。
 *
 * 台词口径与通用表同一条：只谈**上一幕已发生的事实**（读 spec-love-rio-route §2 与对应
 * `simulationFacts` / `success` / `failure`），不点名玩家没说过的原话或日期；
 * success 不转暖、不涨好感，failure 不辱骂、不造危机。
 */
export const LOVE_CARRYOVER_SCENE: Record<string, Record<LovePlayOutcome, L>> = {
  // 第 1 幕 `love-approach-soft-decline-reinvite` → 第 2 幕 `love-define-rio-pace-talk`。
  // 依据：前幕 opening 的「忙」与「不是不想见你」；objectives 把「忙」当待核实的信息、再邀只提一次、
  // 无效果就停手；failure 是连环换日期。success 可能是「问出真实情况」或「体面把球交给她」两种，
  // 所以这里不引用项目/截止日期（那只是其中一支，且是 hidden）。
  // source: app/src/data/corpus/love-scenarios-deep-approach.ts#love-approach-soft-decline-reinvite
  "love-arc-rio-clarify:love-approach-soft-decline-reinvite": {
    success: L(
      "上次你听见「忙」，没把它当成拒绝，也没拿它当追问的许可；今晚也别把「以后」问成今晚必须答完的结论。",
      "Last time you heard “busy” and didn’t take it as a no, or as permission to keep pushing. Tonight, don’t turn “the future” into something that has to be settled before we leave.",
    ),
    partial: L(
      "上次我们只说到「忙」为止，谁也没往下追；今晚也别把没说完的那部分当成已经说好了。",
      "Last time we stopped at “busy” and neither of us pushed further. Tonight, don’t treat the part we didn’t finish as already agreed.",
    ),
    failure: L(
      "上次你在日历上一格一格地问我，我那天只想着怎么把对话停掉；今晚别再来一遍。",
      "Last time you walked me through the calendar date by date, and all I wanted was to end the conversation. Don’t do that again tonight.",
    ),
  },
  // 第 2 幕 `love-define-rio-pace-talk` → 第 3 幕 `love-family-expectation-clash`。
  // 依据：前幕 success 只要求「一个具体下一步」，且 Rio 不必承诺婚期；failure 是她为了结束谈话而松口、
  // 之后不再讲真实想法。partial 的「只拿到再想想」见 spec-love-rio-route §4.4 路径 B。
  // 不引用「两周」这类示例日期，也不预设外派（hidden）。
  // source: app/src/data/corpus/love-scenarios-deep-define.ts#love-define-rio-pace-talk
  "love-arc-rio-clarify:love-define-rio-pace-talk": {
    success: L(
      "上次我们只说好再谈一次，没把婚期定下来；今天两家的日子摆上桌，也别把它当成我们已经答应的事。",
      "Last time all we agreed was to talk again — no wedding date. Now that both families have put dates on the table, don’t treat them as something we’ve already accepted.",
    ),
    partial: L(
      "上次我们没谈出一个日期，今天也别急着用两家的安排把这个缺口补上。",
      "We didn’t land on a date last time. Don’t use both families’ arrangements to paper over that gap today.",
    ),
    failure: L(
      "上次你追着我要一个答案，我为了让你停下来才松的口；今天别把那次松口当成我的意思。",
      "Last time you kept pressing for an answer, and I gave way just to make it stop. Don’t read that concession as what I actually mean.",
    ),
  },
  // 第 3 幕 `love-family-expectation-clash` → 第 4 幕 `love-rio-secondment-deadline`。
  // 依据：前幕 success 是对齐口径、各自先跟自己父母谈，且把她瞒着答应她妈的事收回两人之间；
  // failure 是替 Rio 答应她家的方案或逼她当传话筒。partial 见 spec-love-rio-route §4.4 路径 B。
  // 第 4 幕的邮件/十天期限是本幕开场事实（spec §2.1）；这里只说「这封邮件」，不声称上次已知外派。
  // source: app/src/data/corpus/love-scenarios-deep-family.ts#love-family-expectation-clash
  "love-arc-rio-clarify:love-family-expectation-clash": {
    success: L(
      "上次我们把两家的话收回到了我们俩手里；这次这封邮件，也先让我自己看完。",
      "Last time we took both families’ words back into our own hands. This email — let me read it through first, too.",
    ),
    partial: L(
      "上次两家的事没完全说清，这次也别把决定整个推给我。",
      "We never fully settled the families last time. Don’t push the whole decision onto me this time.",
    ),
    failure: L(
      "上次在我家的事上你越过了我；这次这封邮件，先让我自己答。",
      "Last time you went over my head on my family’s side. This email — I answer it myself first.",
    ),
  },
};

export interface LoveCarryover {
  /** 承接句（已按当前界面语言取值）：学习者的原话引用，或结局兜底句；无承接时 null。 */
  text: string | null;
  /** 承接所依据的那一幕（紧邻的前一幕）的结局；没有记录则 null。 */
  outcome: LovePlayOutcome | null;
  /** 本场在自己线内的序号（0 起）；场景不属于任何线时 null。 */
  actIndex: number | null;
  /** 引用的是学习者哪一条承诺；没有引用承诺（走结局查表）时 null。`markLoveCarryoverShown` 只认它。 */
  carryId: string | null;
}

const NONE: LoveCarryover = { text: null, outcome: null, actIndex: null, carryId: null };

/**
 * 纯查表：先看「线 + 前一幕」的专属承接，未命中再按线 + 结局取通用兜底句。
 * 任何输入不全或线没写过承接都回 null，不碰 DOM 与存储。
 */
export function pickLoveCarryover(
  outcome: LovePlayOutcome | null,
  seriesId: string | undefined,
  lang: Lang,
  prevSceneId?: string,
): string | null {
  if (!outcome || !seriesId) return null;
  const sceneLine = prevSceneId ? LOVE_CARRYOVER_SCENE[`${seriesId}:${prevSceneId}`]?.[outcome] : undefined;
  if (sceneLine) return sceneLine[lang];
  const line = LOVE_CARRYOVER[seriesId]?.[outcome];
  return line ? line[lang] : null;
}

/** 这一幕在说话的人：承诺按 TA 存、按 TA 取。 */
function npcOf(scenario: Scenario): string {
  return speakerOf(scenario, defaultLearnerId(scenario)).id;
}

/**
 * G06 的 NPC 级承接：同一条线、同一个说话人的承诺**已经答过**（kept / open）时，
 * 开场用 `CARRY_LINES` 的 kept / open 那一格回头提它。文本全部来自既有台词库
 * （love-carry-lines.ts 只读），此前那两格只服务跟进卡的即时问答——不新增任何语料。
 *
 * - `dropped`（学习者喊停 / 问满 3 次被收尾）**永远不接**：那是对「不再问了」的尊重。
 * - 匹配沿用 `pendingLoveCarryForOpening` 的同一套键：seriesId + speakerOf 给出的说话人 id
 *   （`characterKey` 只管写入时的同人同场景，开场匹配按线 + 说话人）——`tess` 撞 id 的两条线
 *   各自隔离在自己的 seriesId 里，跨线不互相认领；不在这里做任何新的身份推断。
 * - 不要求承诺来自紧邻的前一幕：承接句引用的是学习者真说过的原话，隔一幕也不算编造。
 * - 这一层不依赖上一幕的结局（outcome 没记录也可以说）；多条命中时取最近更新的那条。
 */
export interface LoveNpcCarryover {
  /** 台词（已按界面语言取值）：CARRY_LINES 的 kept / open 格，学习者原话逐字在内。 */
  text: string;
  /** 引用的承诺条目：台词真正显示后由调用方决定是否 `markLoveCarryoverShown`。 */
  carryId: string;
}

export function pickLoveNpcCarryover(
  seriesId: string,
  npcId: string,
  scenarioId: string,
  lang: Lang,
): LoveNpcCarryover | null {
  const hits = readLoveCarries().filter(
    (c) =>
      (c.state === "kept" || c.state === "open") &&
      c.seriesId === seriesId &&
      c.npcId === npcId &&
      c.scenarioId !== scenarioId,
  );
  if (!hits.length) return null;
  const carry = hits.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  // kept / open 两格是台词库闭合矩阵的一部分，正常永远命中；缺格返回 null，不现编。
  const text = loveCarryLine(carry, carry.state === "open" ? "open" : "kept", lang);
  return text ? { text, carryId: carry.id } : null;
}

/**
 * 取开场点名的「承诺」这一半：同一条线、同一个说话人、还没答过的承诺原话，
 * 不看结局查表。Rio 第 4–6 幕的开场被作者变体占用后，未兑现承诺仍要被点名——
 * 失望/追问的口径全部来自 `CARRY_LINES`（不扣分、不给结局、只把问题摆回桌面）。
 */
export function peekLoveCarryPromiseForScene(seriesId: string, scenarioId: string, lang: Lang): LoveCarryover {
  const series = loveSeriesById(seriesId);
  if (!series || !series.continuous) return NONE;
  const actIndex = series.scenarios.findIndex((s) => s.id === scenarioId);
  if (actIndex < 1) return NONE;
  const scenario = series.scenarios[actIndex];
  const carry = pendingLoveCarryForOpening(series.id, npcOf(scenario), scenario.id);
  const ask = carry ? loveCarryAskLine(carry, lang) : null;
  if (carry && ask) return { text: ask, outcome: null, actIndex, carryId: carry.id };
  return NONE;
}

/**
 * 取本场开场该带的承接句（**纯读**，G09），解析顺序（G06）：
 * 1. 学习者在**同一条线、同一个 NPC** 别的场次里还没答过的承诺——引用他的原话
 *    （CARRY_LINES 的 ask / askAgain 格，P2 路径，优先级不变）；
 * 2. 场景内：线 + **紧邻前一幕**（不是「任意已完成的场景」）的专属承接句；
 * 3. 同线同 NPC 的 NPC 层（G06）：同一个说话人**已答过**（kept / open）的承诺，
 *    用 CARRY_LINES 的 kept / open 格回头提它，dropped 永不接；不依赖上一幕的结局；
 * 4. 系列/幕级通用句（LOVE_CARRYOVER）。
 *
 * 各层都先过 continuous 与 actIndex ≥ 1 的门槛。这里绝不写存储：重开/回想同一幕、
 * 以及任何一次 `Peek` 都不消耗提问额度。台词真的显示到屏幕上之后，调用方再调
 * `markLoveCarryoverShown(carryId)`——计数只由那一次显式调用进入 store。
 *
 * `seriesId` 相等这一条不是形式主义：语料里 `tess` 同时是两条线上的两个角色
 * （爱好活动上认识的陌生人 / 异地的另一半），还共用一张立绘。按线隔离后
 * 这个撞 id 在本功能里无害，语料 id 本身不在这里动。
 */
export function peekLoveCarryoverForScene(seriesId: string, scenarioId: string, lang: Lang): LoveCarryover {
  const series = loveSeriesById(seriesId);
  if (!series || !series.continuous) return NONE;
  const actIndex = series.scenarios.findIndex((s) => s.id === scenarioId);
  if (actIndex < 1) return actIndex === 0 ? { ...NONE, actIndex: 0 } : NONE;
  const scenario = series.scenarios[actIndex];
  const npcId = npcOf(scenario);
  const prevId = series.scenarios[actIndex - 1].id;
  const outcome = readLoveSeriesProgress(series.id).outcome[prevId] ?? null;
  // 1. 未答的承诺原话优先（P2）。
  const carry = pendingLoveCarryForOpening(series.id, npcId, scenario.id);
  const ask = carry ? loveCarryAskLine(carry, lang) : null;
  if (carry && ask) return { text: ask, outcome, actIndex, carryId: carry.id };
  // 2. 场景内（线 + 前一幕专属句）。
  const sceneLine = outcome ? LOVE_CARRYOVER_SCENE[`${series.id}:${prevId}`]?.[outcome]?.[lang] : undefined;
  if (sceneLine) return { text: sceneLine, outcome, actIndex, carryId: null };
  // 3. NPC 层：答过的承诺（kept / open），CARRY_LINES 渲染。
  const npcQuote = pickLoveNpcCarryover(series.id, npcId, scenario.id, lang);
  if (npcQuote) return { text: npcQuote.text, outcome, actIndex, carryId: npcQuote.carryId };
  // 4. 系列/幕级通用句兜底。
  return { text: pickLoveCarryover(outcome, series.id, lang, prevId), outcome, actIndex, carryId: null };
}

/**
 * 承接句真正显示后记一次提问。幂等：重复调用不会崩，也不再自己算账——
 * 单条每天只计一次、`askCount` 与 `lastAskedAt` 的写入全部由 `love-carry-store` 管，
 * 幕内开场与首页跟进卡读的是同一个计数。空 id（走结局查表的承接）直接忽略。
 */
export function markLoveCarryoverShown(carryId: string): void {
  if (!carryId) return;
  markLoveCarryAsked(carryId);
}

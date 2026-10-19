import type { L, Lang } from "@/data/taxonomy";
import {
  CARRY_LINES,
  CARRY_LINES_UNCLASSIFIED,
  CARRY_QUOTE_MARKER,
  type CarryPromiseClass,
  type CarryResolution,
} from "@/data/corpus/love-carry-lines";
import { uid } from "./format";

/**
 * 恋爱承接的结构化版本（review-2026-10-13-love-companionship §10.1 P2）：
 * 一「句」被带走的承诺 = 学习者自己打出来的话 + 他自己点的类别 + 说给哪个 NPC 听。
 *
 * 两条口径抄自 `love-series-progress.ts`：设备端独立 slot、解析防御且永不抛错；
 * 抄自 `spec-presence-layer.md:19-22`：`text` 是 `string` 而不是 `L`——原话永远单语，
 * 双语只属于模板（`CARRY_LINES`）。要凑双语就得机器翻译，而那正好破掉「逐字引用」。
 */

/**
 * `pending` = 还没答过，等着幕内 NPC 开场引用或首页跟进卡问起；
 * `open` = 答过一次「还没」，跟进卡还会再问，但换成「就还欠着」那句；
 * `kept` = 答过「做了」，问过满 3 次或学习者自己喊停的都落到 `dropped`。
 * 后两个态是终点。
 */
export type LoveCarryState = "pending" | "kept" | "open" | "dropped";

export interface LoveCarry {
  id: string;
  /** 学习者自己的话，逐字保存，永不翻译、不裁剪。 */
  text: string;
  /** 这句原话所属语言：模板按界面语言取，不用来翻译 text。 */
  lang: Lang;
  /** 学习者自己点的类别；null = 他选了「不用标类别」。 */
  cls: CarryPromiseClass | null;
  npcId: string;
  /** 录入那一刻的名字快照：语料日后改名不追溯，否则承接句会叫错人。 */
  npcName: L;
  scenarioId: string;
  seriesId: string | null;
  /**
   * 场景 + 角色的稳定身份键（`scenarioId:characterId`，G01/G20）。
   * 同一场景换一个 NPC 仍是另一个人的承诺：覆盖/复用只在同一个 `characterKey` 上成立。
   * 旧档没有这个字段，读取时按 `${scenarioId}:${npcId}` 兜底（`loveCarryKeyOf`），下次写入补上。
   */
  characterKey?: string;
  createdAt: number;
  updatedAt: number;
  askCount: number;
  /** 上一次被问出口的时间——幕内引用与首页跟进卡共用这一个计数与这一个时间戳。 */
  lastAskedAt?: number;
  state: LoveCarryState;
}

/** 采集现场能给出的全部信息：id、时间戳、提问计数、状态由 store 补齐。 */
export interface LoveCarryDraft {
  text: string;
  lang: Lang;
  cls: CarryPromiseClass | null;
  npcId: string;
  npcName: L;
  scenarioId: string;
  seriesId: string | null;
}

/** 一句回合的来源。`pick` 是点的选项、`type` 是自己打的——只有后者有资格被带走。 */
export interface LoveCarryTurn {
  via: "pick" | "type";
  text: string;
}

/** `too-long` = 原话超过 `LOVE_CARRY_TEXT_MAX`；存储层拒绝而不是裁剪，逐字保存不许被改写。 */
export type LoveCarrySave = { ok: true; carry: LoveCarry } | { ok: false; reason: "full" | "too-long" };

/** 恋爱玩法所有设备端 slot 的公共前缀：`…carry` 与 `…series.<id>` 都在它下面。 */
export const LOVE_PLAY_PREFIX = "socialcoach.love-play.";
/** 承接槽的设备端 key。备份/恢复侧（`lib/archive.ts`）引用这一个常量，不再各写一份字符串。 */
export const LOVE_CARRY_KEY = `${LOVE_PLAY_PREFIX}carry`;

/**
 * 「删除所有数据」的恋爱那一半：这些 slot 按设计不进 persist archive，store 的 `reset()` 碰不到，
 * 而承诺里存的是用户亲手打的一句话——不留这条 erase 路径，删除承诺就只剩逐条点「不再问了」。
 * 倒序扫描：删除会让其后的下标前移。返回删掉的条数，便于调用方在失败时给出可懂的说明。
 */
export function clearLovePlaySlots(): number {
  let removed = 0;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LOVE_PLAY_PREFIX)) {
        localStorage.removeItem(key);
        removed++;
      }
    }
  } catch {
    // 没有 localStorage（服务端渲染、隐私模式、配额）：与读取同一口径，静默视为「本机没留住这些数据」。
  }
  return removed;
}
/** 与在场层同一口径：每条承接都要整份序列化，无上限会多出一条配额失败线。 */
export const LOVE_CARRY_CAP = 20;
/** 承诺原话的长度上限。采集输入、落盘与导出校验共用这一个数，谁也不能比谁宽一个字。 */
export const LOVE_CARRY_TEXT_MAX = 500;

/** 承诺的归属键：同一场景里换一个 NPC 就是另一个人，覆盖/复用不能跨人（G20）。 */
export const loveCarryCharacterKey = (scenarioId: string, npcId: string): string => `${scenarioId}:${npcId}`;

/** 旧档没有 `characterKey`：读取路径按 `scenarioId:npcId` 兜底，不在解析时改写原始记录。 */
export function loveCarryKeyOf(carry: Pick<LoveCarry, "scenarioId" | "npcId" | "characterKey">): string {
  return carry.characterKey || loveCarryCharacterKey(carry.scenarioId, carry.npcId);
}

/**
 * 「她来找你」的节流表。形状抄 [review-2026-10-13-love-companionship §6] 从 AIcove 借来的
 * 三重门禁（日上限 / 最小间隔 / 免打扰，命中只改期不丢弃），**数值不按那组原值**：
 * 2026 年关于主动消息的公开指引簇在「≤2 次/天 + 约 4 小时间隔」，多数用户偏好 ≤1 次/天，
 * 而 AIcove 的 3 次/天 + 120 分钟落在这条容忍线之上。我们的落点是「打开应用才问」而非系统推送，
 * 语义更软，但没有理由把数放大回去。单条那一半与 `wiki/specs/spec-presence-layer.md` 第一节同口径。
 *
 * `perCarryMax: 3` 还有一个台词后果：同一条承诺一辈子会被问满三次，所以「这是我头一回提」
 * 和「我从没拿出来催过你」都不可能在第 2、3 次上成立。台词库因此把 `ask` 和 `askAgain` 分成
 * 两格，由 `askResolution()` 按 `askCount` 分派——计数在这里，谎就不许写在台词里。
 */
export const LOVE_CARRY_ASK = {
  /** 同一条承诺一辈子最多问几次。 */
  perCarryMax: 3,
  /** 同一条承诺两次提问之间的最小间隔（分钟）。第一次也等这么久：刚写下那句的当天不可能已经做完。 */
  perCarryGapMin: 24 * 60,
  /** 一个自然日里最多浮现几次提问（跨所有承诺合计）。 */
  perDayMax: 2,
  /** 两次浮现之间的最小间隔（分钟）。 */
  globalGapMin: 4 * 60,
  /** 免打扰窗口（本地小时），`[quietFromHour, 24) ∪ [0, quietToHour)` 内一句不问 = 22:00–08:00。 */
  quietFromHour: 22,
  quietToHour: 8,
} as const;

/** 跟进卡上三个答案就是三个目标态：做了 → `kept`、还没 → `open`、不再问了 → `dropped`。 */
export type LoveCarryAnswer = Exclude<LoveCarryState, "pending">;

/** 全局闸门被哪一条挡下的（只给测试与排查用，不显示给学习者）。 */
export type LoveCarryAskBlock = "quiet" | "per-day" | "spacing";

const STATES: readonly LoveCarryState[] = ["pending", "kept", "open", "dropped"];
/** 只有这两种态可被挤掉：还没问过的句子（pending / open）由不得存储容量来删。 */
const PRUNABLE: readonly LoveCarryState[] = ["kept", "dropped"];
const CLASSES: readonly CarryPromiseClass[] = ["call", "visit", "ritual"];

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const stamp = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const nameOf = (v: unknown): L | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<L>;
  return typeof o.zh === "string" && typeof o.en === "string" ? { zh: o.zh, en: o.en } : null;
};

/** 单条防御解析：认不出来的字段退回安全值，认不出来的状态整条丢掉。 */
function parseCarry(v: unknown): LoveCarry | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<LoveCarry>;
  const id = str(p.id);
  const text = str(p.text);
  const npcId = str(p.npcId);
  const scenarioId = str(p.scenarioId);
  const npcName = nameOf(p.npcName);
  if (!id || !text || !npcId || !scenarioId || !npcName) return null;
  // state 同时决定「能不能被挤掉」和「还要不要问」，猜一个都比丢更糟。
  if (!p.state || !STATES.includes(p.state)) return null;
  const lang: Lang = p.lang === "en" ? "en" : "zh";
  // 认不出的类别退回「没标类别」：兜底台词不预设这句是关于通话还是见面的，照样说得通。
  const cls = p.cls ?? null;
  const createdAt = stamp(p.createdAt, Date.now());
  const carry: LoveCarry = {
    id,
    text,
    lang,
    cls: cls && CLASSES.includes(cls) ? cls : null,
    npcId,
    npcName,
    scenarioId,
    // 线 id 坏了只当「没编线」看待：这句还是学习者说过的，不因为他打字打歪了就不该留。
    seriesId: typeof p.seriesId === "string" ? p.seriesId : null,
    createdAt,
    updatedAt: stamp(p.updatedAt, createdAt),
    askCount: Math.max(0, Math.trunc(stamp(p.askCount, 0))),
    state: p.state,
  };
  const lastAskedAt = stamp(p.lastAskedAt, NaN);
  if (Number.isFinite(lastAskedAt)) carry.lastAskedAt = lastAskedAt;
  // 旧档没有归属键就不写进对象：读取侧用 `loveCarryKeyOf` 兜底，避免一次无关写入
  // 把每个历史条目的字节形状都换掉（导出/恢复的逐字断言依赖这一点）。
  // 认不出的键（改档/旧格式）也走同一个兜底，不让一个坏字符串把这条承诺变得谁也匹配不上。
  const characterKey = str(p.characterKey);
  if (characterKey === loveCarryCharacterKey(scenarioId, npcId)) carry.characterKey = characterKey;
  return carry;
}

function parse(raw: string | null): LoveCarry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.map(parseCarry).filter((c): c is LoveCarry => c !== null);
  } catch {
    return [];
  }
}

/** 读取全部被带走的承诺；slot 损坏 / 存储不可用都读成空，不抛错。 */
export function readLoveCarries(): LoveCarry[] {
  if (typeof window === "undefined") return [];
  try {
    return parse(localStorage.getItem(LOVE_CARRY_KEY));
  } catch {
    return [];
  }
}

/** 写入：配额满或存储被禁用时静默失败（`writeLoveSeriesProgress` 同口径），不打断剧情。 */
function writeLoveCarries(list: LoveCarry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOVE_CARRY_KEY, JSON.stringify(list));
  } catch {
    // 这一句就只活到这儿：不弹错、不重试，学习者的这一幕不该被存储故障挡住。
  }
}

/**
 * 可带走的句子候选：**只有学习者自己打出来的回合**有资格进来。
 * 点选项 ≠ 用户真实表达（`wiki/04-api-reference.md` 对 assess 写死的同一条口径），
 * 所以选项文本、NPC 台词永远不会从这里冒出来成为「你说过的话」。
 */
export function loveCarryCandidates(turns: readonly LoveCarryTurn[]): string[] {
  const out: string[] = [];
  for (const turn of turns) {
    if (turn.via !== "type") continue;
    const text = turn.text.trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/**
 * 开场引用哪一条承诺：同一条线、同一个说话人、且不是这一场自己录的那句
 * （否则重玩本场会立刻把本场的话当成「上次」）。同线同人有多条时取最近更新的。
 * 不要求承诺来自**紧邻**的前一幕——P1 的 outcome 句才要紧邻，那是查表；
 * 承接句是学习者原话，只要真的说过就能引用，隔一幕也不算编造。
 */
export function pendingLoveCarryForOpening(
  seriesId: string,
  npcId: string,
  scenarioId: string,
): LoveCarry | null {
  // 同线同说话人：`characterKey` 的兜底在这里是同一个结论（旧档按 scenarioId:npcId 推），
  // 用 `npcId` 直接比对即可；`characterKey` 管的是**写入**时同场景换人不互相覆盖。
  const hits = readLoveCarries().filter(
    (c) => c.state === "pending" && c.seriesId === seriesId && c.npcId === npcId && c.scenarioId !== scenarioId,
  );
  if (!hits.length) return null;
  return hits.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
}

/**
 * 问过的次数决定用哪一种问法（台词库的 `ask` / `askAgain` 两格就是为这条规则存在的）：
 * 库里凡是宣称「我从没拿出来催过你」的句子，在第 2、3 次浮现时都是可被 `askCount` 证伪的假话。
 * 只做选择，不做拼接，也不做兜底的现编——库里少一格就返回 null。
 */
function askResolution(carry: LoveCarry): CarryResolution {
  return carry.askCount > 0 ? "askAgain" : "ask";
}

/**
 * 渲染台词库里的一格：`CARRY_LINES[类别][结果]`，没标类别走兜底那一列。
 * `{{quote}}` 换成学习者的原话——逐字进入，不翻译、不再包一层引号（模板里已经带了）、不截断。
 * 库里没有这一格就返回 null：调用方**不许多一次模型调用把话编圆**，那是 P4 的停止信号。
 */
export function loveCarryLine(carry: LoveCarry, resolution: CarryResolution, lang: Lang): string | null {
  const line = (carry.cls ? CARRY_LINES[carry.cls] : CARRY_LINES_UNCLASSIFIED)?.[resolution];
  if (!line) return null;
  // 替换写成函数形式：原话里若含 `$&` 之类的替换记号，字符串形式会把模板自己抄进去。
  return line.text[lang].replaceAll(CARRY_QUOTE_MARKER, () => carry.text);
}

/**
 * NPC 开场引用哪句承诺：学习者还没答过，所以只在 `ask` / `askAgain` 两格里选——
 * `open` 那句断言「还没做」，而学习者从没这么说过，替他把话说了就是编造他的作答。
 * 问第二次还说自己头一回提，也是编造，只不过编的是 NPC 自己。
 */
export function loveCarryAskLine(carry: LoveCarry, lang: Lang): string | null {
  return loveCarryLine(carry, askResolution(carry), lang);
}

/**
 * 挤到上限以内：按 `updatedAt` 从旧到新只删终态条目。
 * 一条都挤不出来时返回 null —— 调用方要么拒绝写入，要么原样写，绝不悄悄吃掉 `pending` / `open`。
 */
export function pruneLoveCarries(list: LoveCarry[]): LoveCarry[] | null {
  if (list.length <= LOVE_CARRY_CAP) return list;
  const terminal = list.filter((c) => PRUNABLE.includes(c.state)).sort((a, b) => a.updatedAt - b.updatedAt);
  const drop = new Set<string>();
  for (const c of terminal) {
    if (list.length - drop.size <= LOVE_CARRY_CAP) break;
    drop.add(c.id);
  }
  // 全删完还压不回上限（历史遗留的超长 slot）就当作没有出路：拒绝写入，而不是白删几条仍然超限。
  if (drop.size === 0 || list.length - drop.size > LOVE_CARRY_CAP) return null;
  return list.filter((c) => !drop.has(c.id));
}

/**
 * 记下这句承诺。同一场重玩不堆重复：**同一 `characterKey`** 已有的未决条目就地改写，
 * id、createdAt 与问过的次数都留着；同一场换一个 NPC 是另一个人的承诺，另起一条（G20）。
 *
 * 超长不再静默截断：`text` 是学习者亲手打的那句话，裁掉后半句再冒充「逐字保存」比拒绝更糟。
 * 超限返回 `too-long`，由采集 UI 明示；校验侧（`archive.ts` 的承诺 schema）共用同一个上限。
 */
export function saveLoveCarry(draft: LoveCarryDraft): LoveCarrySave {
  const now = Date.now();
  const text = draft.text.trim();
  if (text.length > LOVE_CARRY_TEXT_MAX) return { ok: false, reason: "too-long" };
  const input: LoveCarryDraft = { ...draft, text };
  const characterKey = loveCarryCharacterKey(draft.scenarioId, draft.npcId);
  const list = readLoveCarries();
  // `open`（答过一次「还没」）仍是未决：同一场重新许下同一句，改写的是同一条记录，
  // 不另起一条占格子；`kept` / `dropped` 是终点，新承诺另起一条。
  const idx = list.findIndex(
    (c) => (c.state === "pending" || c.state === "open") && loveCarryKeyOf(c) === characterKey,
  );
  if (idx >= 0) {
    const next: LoveCarry = { ...list[idx], ...input, characterKey, updatedAt: now };
    const out = [...list];
    out[idx] = next;
    writeLoveCarries(pruneLoveCarries(out) ?? out);
    return { ok: true, carry: next };
  }
  const carry: LoveCarry = { id: uid(), ...input, characterKey, createdAt: now, updatedAt: now, askCount: 0, state: "pending" };
  const pruned = pruneLoveCarries([...list, carry]);
  // 满了就拒绝这一条，而不是删一条还没问过的来腾地方。
  if (!pruned) return { ok: false, reason: "full" };
  writeLoveCarries(pruned);
  return { ok: true, carry };
}

/**
 * 这句承诺被问出口了一次（幕内引用或跟进卡浮现）：记一笔提问，**不改 state**
 * （作答是学习者按按钮的事）。能力类数值一个都不碰——这里只有 askCount / lastAskedAt。
 */
export function markLoveCarryAsked(id: string): void {
  const list = readLoveCarries();
  if (!list.some((c) => c.id === id)) return;
  const now = Date.now();
  writeLoveCarries(
    list.map((c) => {
      if (c.id !== id) return c;
      // 一次自然日只记一次「问过」。幕内开场是入戏的连续性，不是通知：玩家重开同一幕时让 NPC
      // 忽然不提那句承诺，比让他听见同一句更糟。但不设这道闸的话，连打三幕（或重开两次）就会
      // 在同一次访问里把 perCarryMax 问满，承诺被静默 retire，跟进卡——功能真正承诺的那一下——
      // 再也没有机会出现，而设置页写的是「两次至少隔一天」。计数按天，引用照旧。
      const counted = now - (c.lastAskedAt ?? 0) >= LOVE_CARRY_ASK.perCarryGapMin * MINUTE;
      return { ...c, askCount: counted ? c.askCount + 1 : c.askCount, lastAskedAt: now };
    }),
  );
}

const MINUTE = 60_000;

/** 同一个本地自然日：日上限与免打扰都按学习者手表上的「今天」，不按 UTC。 */
function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** 免打扰窗口（22:00–08:00 本地）内一句不问。 */
function inQuietHours(now: number): boolean {
  const hour = new Date(now).getHours();
  return hour >= LOVE_CARRY_ASK.quietFromHour || hour < LOVE_CARRY_ASK.quietToHour;
}

/**
 * 单条这一门：没答过的（`kept` / `dropped`）不再问；问满 3 次的不再问；
 * 距上次提问不足 24 小时的今天先放着。第一次没有 `lastAskedAt`，于是拿 `createdAt` 当锚点——
 * 同一趟来访里刚许下的承诺不该立刻被问「做了吗」。
 */
export function loveCarryAskable(carry: LoveCarry, now: number): boolean {
  if (carry.state !== "pending" && carry.state !== "open") return false;
  if (carry.askCount >= LOVE_CARRY_ASK.perCarryMax) return false;
  return now - (carry.lastAskedAt ?? carry.createdAt) >= LOVE_CARRY_ASK.perCarryGapMin * MINUTE;
}

/**
 * 全局闸门（跨所有承诺）。`lastAskedAt` 只由提问写入，所以「今天浮现过几次」直接从各条
 * 承诺自己的时间戳数就够了，不需要第二个 slot。会被挤掉的只有 `updatedAt` 最旧的终态条目，
 * 而当天被问过的那条：要么还在 pending / open（不参与挤出），要么答过所以 `updatedAt` 与
 * 提问同日——要把它删掉得在同一天里再攒满 20 条终态，那种日子日上限本身早就用完了。
 */
export function loveCarryGlobalBlock(list: readonly LoveCarry[], now: number = Date.now()): LoveCarryAskBlock | null {
  if (inQuietHours(now)) return "quiet";
  const asked = list.map((c) => c.lastAskedAt).filter((v): v is number => typeof v === "number");
  if (asked.filter((at) => sameLocalDay(at, now)).length >= LOVE_CARRY_ASK.perDayMax) return "per-day";
  const last = asked.length ? Math.max(...asked) : 0;
  if (last && now - last < LOVE_CARRY_ASK.globalGapMin * MINUTE) return "spacing";
  return null;
}

/**
 * 这一趟值不值得摆出跟进卡；值得的话问哪一句。返回 null = 不问。
 * **被节流只是延后**：state 一个都不改，条件满足了这句还会回来。
 * 候选不止一条时先问等得最久的那句（`createdAt` 最早），否则最新那句会一直插队。
 */
export function dueLoveCarry(now: number = Date.now(), list: readonly LoveCarry[] = readLoveCarries()): LoveCarry | null {
  if (loveCarryGlobalBlock(list, now)) return null;
  const candidates = list.filter((c) => loveCarryAskable(c, now));
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.createdAt < a.createdAt ? b : a));
}

/**
 * 问满 3 次却再没人来问的句子收尾成 `dropped`。不收尾它会永远挂在 `pending`：
 * `pruneLoveCarries` 只挤终态，于是它白占 20 分之一的格子，而 `loveCarryAskable` 再也不放它出来。
 */
export function retireExhaustedLoveCarries(list: LoveCarry[] = readLoveCarries()): void {
  const exhausted = (c: LoveCarry) => (c.state === "pending" || c.state === "open") && c.askCount >= LOVE_CARRY_ASK.perCarryMax;
  if (!list.some(exhausted)) return;
  const now = Date.now();
  writeLoveCarries(list.map((c) => (exhausted(c) ? { ...c, state: "dropped", updatedAt: now } : c)));
}

/**
 * 跟进卡上那句 NPC 的话：答过一次「还没」的句子走 `open`，其余按提问计数走
 * `ask`（一次没问过）或 `askAgain`（问过至少一次）。
 * `open` 优先于计数：它带着学习者自己按过的那次「还没」，比第几次开口更有依据。
 */
export function loveCarryCardLine(carry: LoveCarry, lang: Lang): string | null {
  return loveCarryLine(carry, carry.state === "open" ? "open" : askResolution(carry), lang);
}

/**
 * 记下学习者对跟进卡的答案。**只写 state / updatedAt**：`proficiency`、`loveProficiency`、
 * `stars`、`practiceDays` 一个都不碰，不发 assess、不建 session——在场层「回答做了不产生任何分数」
 * 那条纪律在这里逐字成立（`wiki/specs/spec-presence-layer.md` 第一节）。
 * 答「还没」但次数已经问满 = 没有下一次了，直接落 `dropped`。
 */
export function answerLoveCarry(id: string, answer: LoveCarryAnswer): void {
  const list = readLoveCarries();
  if (!list.some((c) => c.id === id)) return;
  const now = Date.now();
  writeLoveCarries(
    list.map((c) => {
      if (c.id !== id) return c;
      if (answer !== "open") return { ...c, state: answer, updatedAt: now };
      return { ...c, state: c.askCount >= LOVE_CARRY_ASK.perCarryMax ? "dropped" : "open", updatedAt: now };
    }),
  );
}

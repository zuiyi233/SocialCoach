/**
 * 恋爱域「真人感」层的回合意图（spec-love-human-voice §4.2，P1）。
 *
 * 纯函数、无 IO：随机源由调用方注入（`rng` 返回 [0,1)），服务端与测试均可重复运行，
 * 不碰 `Math.random` / `Date.now`。分类是确定性的，按
 * none → bare-ack → question → invitation → long-share → statement 顺序匹配。
 *
 * 两处量纲说明（对 spec 的读法）：
 * - bare-ack 的「长度 ≤4」：zh 按字符数；en 按词数（否则词表里的 `right` / `got it`
 *   永远不可能命中）；
 * - long-share 的「zh ≥ 40 字」：按归一化后的字符数（含标点，与口语「40 字」一致）。
 */
import type { Lang } from "@/data/taxonomy";

export type LearnerTurnKind =
  | "question"
  | "bare-ack"
  | "invitation"
  | "long-share"
  | "statement"
  | "none";

export type Initiative = "answer" | "reflect" | "hold-back" | "close" | "deflect";

/** 归一化：去零宽字符 → 去首尾空白 → 连续空白折叠为单个空格。 */
const normalize = (text: string): string =>
  text.replace(/[\u200B-\u200D\uFEFF\u2060]/g, "").trim().replace(/\s+/g, " ");

/** 除空白外没有任何字母 / 数字 / 汉字 ⇒ 只有标点或符号的「空」回合。 */
const HAS_CONTENT = /[A-Za-z0-9\u3400-\u4DBF\u4E00-\u9FFF]/;

/** 应答词表：短确认 / 致谢式回应。 */
const ACK_ZH = new Set([
  "嗯", "嗯嗯", "好", "好的", "行", "可以", "对", "是", "哦", "好吧", "知道了", "收到",
]);
const ACK_EN = new Set(["ok", "okay", "yeah", "yep", "sure", "hm", "mm", "right", "got it", "fine"]);

/**
 * 问句标记：`？`/`?` 或中文疑问词。
 * 刻意不用裸 `哪`（会命中「哪怕」）、不用裸 `怎么`（会命中「不怎么」）、
 * 不用裸 `呢`（会命中「我才怪呢」这类陈述）。
 */
const QUESTION_RE = /[？?]|吗|(?<!不)(?<!没)怎么|哪里|哪儿|哪个|哪些|哪位|谁|几点|是不是|能不能|会不会|你觉得呢|你们呢|您呢|你呢|然后呢|干嘛呢|所以呢|呢(?=[？?])/;
/** 邀请标记（英文在归一化后统一 toLowerCase 再匹配）；`一起` 必须带动作或疑问，避免命中「在一起」。 */
const INVITATION_ZH = /要不要|去不去|来不来|想不想|今晚|周末|陪我|带你|(?:要不要|去不去|来不来|想不想)[^。！？]{0,6}一起|一起(?:去|来|看|吃|玩|喝|逛|走|试试)/;
const INVITATION_EN = /want to|shall we|let's|together|tonight|weekend/;
/** 「哪里哪里」是客套否定，不是问句。 */
const HUMBLE_WHERE = /^哪里哪里[。！!]*$/;

export function classifyLearnerTurn(text: string, lang: Lang): LearnerTurnKind {
  const norm = normalize(text);
  if (norm === "" || !HAS_CONTENT.test(norm)) return "none";

  // bare-ack：短句且命中应答词表。尾部句末/次级标点先剥掉（「嗯。」仍是应答），
  // 但问号保留——「好？」是问句，不是应答。
  const hay = norm.toLowerCase();
  const ackKey = hay.replace(/[。，、！,!.]+$/u, "").trim();
  const short = lang === "zh" ? ackKey.length <= 4 : ackKey.split(/\s+/).length <= 4;
  if (short && (lang === "zh" ? ACK_ZH.has(ackKey) : ACK_EN.has(ackKey))) return "bare-ack";
  if (lang === "zh" && HUMBLE_WHERE.test(norm)) return "statement";

  if (QUESTION_RE.test(hay)) return "question";
  if (INVITATION_ZH.test(hay) || INVITATION_EN.test(hay)) return "invitation";

  // long-share：zh ≥ 40 字符 / en ≥ 25 词。
  const len = lang === "zh" ? norm.length : norm.split(/\s+/).length;
  if (len >= (lang === "zh" ? 40 : 25)) return "long-share";

  return "statement";
}

export function chooseInitiative(input: {
  rng: () => number;
  learnerTurn: LearnerTurnKind;
  lastNpcAskedQuestion: boolean;
  terminal: boolean;
  ended: boolean;
  turnIndex: number;
}): Initiative {
  const { rng, learnerTurn, lastNpcAskedQuestion, terminal, ended, turnIndex } = input;

  // 后置硬约束所需的屏蔽条件：先算（否则下方早返回会把 learnerTurn 收窄，
  // 使「=== question」之类的比较变成类型层面的不可达）。
  const deflectForbidden =
    learnerTurn === "question" || learnerTurn === "invitation" || ended || terminal || turnIndex === 0;

  // 收束：结局或终局回合不再推进，也不反问（terminal 与 ended 同判）。
  if (ended || terminal) return "close";
  // 问句必须回答，不许绕开。
  if (learnerTurn === "question") return "answer";
  // 上轮 NPC 刚问过，这边别再造一个问句。
  if (learnerTurn === "bare-ack" && lastNpcAskedQuestion) return "hold-back";
  if (learnerTurn === "invitation") return "answer";
  if (learnerTurn === "long-share") return "reflect";

  // 其余按概率抽样：answer 0.45 / reflect 0.3 / hold-back 0.2 / deflect 0.05。
  const roll = rng();
  const initiative: Initiative =
    roll < 0.45 ? "answer" : roll < 0.75 ? "reflect" : roll < 0.95 ? "hold-back" : "deflect";

  // 后置硬约束：deflect 不允许出现在问句 / 邀请 / 收束 / 首回合；命中时降级为 answer。
  if (initiative === "deflect" && deflectForbidden) return "answer";
  return initiative;
}

/** 提示词块：首行固定 `THIS TURN'S INITIATIVE: <name>`，随后 2 行规则（- 前缀，同 spec §4.4 示例）。 */
const block = (zh: string[], en: string[]): { zh: string; en: string } => ({
  zh: zh.map((line) => `- ${line}`).join("\n"),
  en: en.map((line) => `- ${line}`).join("\n"),
});

const DIRECTIVES: Record<Initiative, { zh: string; en: string }> = {
  answer: block(
    ["先直接回答对方的问题（若有），再决定要不要多一句。", "不许绕开：他问了什么，就先答什么。"],
    [
      "Answer their question directly first (if there is one), then decide whether one more line is worth it.",
      "Don't sidestep: answer what they actually asked.",
    ],
  ),
  reflect: block(
    ["只接住对方话里一个具体细节。", "不给建议、不总结、不评价。"],
    [
      "Latch onto one concrete detail of what they just said.",
      "No advice, no summary, no judgment.",
    ],
  ),
  "hold-back": block(
    ["只回一句短话，不反问、不推进新话题。", "可以只接住一半情绪；不要用「你呢？」结尾。"],
    [
      "Reply with one short line: no follow-up question, no new topic.",
      "You may catch only half of their feeling; never end with \"what about you?\".",
    ],
  ),
  close: block(
    ["收束这一回合，不再开新话题、不再反问。", "允许留半句，把话停在该停的地方。"],
    [
      "Wrap the turn up: no new topics, no follow-up questions.",
      "A trailing half-sentence is fine.",
    ],
  ),
  deflect: block(
    ["先岔开半句再回来，像真人一样走一下神。", "这不是拒绝回答；不得改变事实或立场。"],
    [
      "Veer off for half a line, then come back to them.",
      "This is not a refusal; never change the facts or your stance.",
    ],
  ),
};

export function initiativeDirective(initiative: Initiative, lang: Lang): string {
  return `THIS TURN'S INITIATIVE: ${initiative}\n${DIRECTIVES[initiative][lang]}`;
}

/**
 * 恋爱域「真人感」层的纯函数（spec-love-human-voice §4.1 / §4.5 / §4.6）。
 *
 * - 无 IO、无随机源：所有随机都从参数 `rng` 取，测试可注入固定序列；
 * - 只服务 `/api/love-play`（恋爱半教练 / 剧本模式 / Studio 后续端口）；
 *   教练模式（roleplay / assess）不得 import 本模块；
 * - `enforceLine` 的输出会喂给守卫（replyBoundaryProblem / roleplaySpeechGuard），
 *   所以 markdown 剥离必须先于守卫执行，保证守卫与玩家看到同一份文本。
 */
import type { Lang } from "@/data/taxonomy";
import type { Initiative, LearnerTurnKind } from "./turn-taking";

export type ReplyShape = "clause" | "short" | "two-beat" | "trail-off" | "flat";

/** 形态硬上限（§4.1）：zh 计字符、en 计词。 */
const SHAPE_LIMIT: Record<ReplyShape, Record<Lang, number>> = {
  clause: { zh: 14, en: 10 },
  "trail-off": { zh: 24, en: 14 },
  short: { zh: 30, en: 18 },
  flat: { zh: 45, en: 28 },
  "two-beat": { zh: 60, en: 35 },
};

/** 任何形态都不得突破的绝对上限；超过它才触发截断（§4.5）。 */
const ABSOLUTE_LIMIT: Record<Lang, number> = { zh: 120, en: 80 };

/** 句末标点（zh/en 共用同一集合）；次级标点用于补省略号的回退。 */
const SENTENCE_END = "。！？.!?";
const SECONDARY_PUNCT = "，、；,;";

export function pickReplyShape(input: {
  rng: () => number;
  lang: Lang;
  learnerTurn: LearnerTurnKind;
  initiative: Initiative;
  terminal: boolean;
  ended: boolean;
  turnIndex: number;
}): ReplyShape {
  const { rng, learnerTurn, initiative, terminal, ended } = input;
  if (terminal || ended) return "flat";
  if (initiative === "hold-back") return "clause";
  if (initiative === "close") return "trail-off";
  const roll = rng();
  if (learnerTurn === "bare-ack") {
    if (roll < 0.5) return "clause";
    if (roll < 0.8) return "trail-off";
    return "short";
  }
  if (learnerTurn === "question") {
    if (roll < 0.5) return "short";
    if (roll < 0.8) return "flat";
    return "two-beat";
  }
  if (roll < 0.35) return "short";
  if (roll < 0.6) return "flat";
  if (roll < 0.8) return "two-beat";
  if (roll < 0.92) return "clause";
  return "trail-off";
}

/** 每种形态的演法（第一行之后 1–2 行）。 */
const SHAPE_GUIDE: Record<ReplyShape, Record<Lang, string>> = {
  clause: {
    zh: "- 只给一个短句或半句，不解释。",
    en: "- Give one short clause or half a sentence. Do not explain.",
  },
  "trail-off": {
    zh: "- 说一半停住，用省略号收尾；不要补完。",
    en: "- Stop mid-thought and end with an ellipsis; do not complete it.",
  },
  short: {
    zh: "- 一到两句，口语化，不铺垫。",
    en: "- One to two casual sentences, no lead-in.",
  },
  flat: {
    zh: "- 平铺直叙：不修饰、不反问、不加感叹。",
    en: "- Plain and matter-of-fact: no flourish, no rhetorical questions, no exclamations.",
  },
  "two-beat": {
    zh: "- 两句，中间有停顿感；第二句可以是半句。",
    en: "- Two sentences with a pause between; the second may be a half sentence.",
  },
};

export function replyShapeDirective(shape: ReplyShape, lang: Lang): string {
  const n = SHAPE_LIMIT[shape][lang];
  const other = SHAPE_LIMIT[shape][lang === "zh" ? "en" : "zh"];
  const header =
    lang === "zh"
      ? `THIS TURN'S SHAPE: ${shape}（≤${n} 个汉字 / ≤${other} 个英文词）`
      : `THIS TURN'S SHAPE: ${shape} (≤${other} Chinese characters / ≤${n} English words)`;
  return `${header}\n${SHAPE_GUIDE[shape][lang]}`;
}

export function replyShapeLimit(shape: ReplyShape, lang: Lang): { maxChars: number } {
  return { maxChars: SHAPE_LIMIT[shape][lang] };
}

/** CJK 标点：间距规则只作用于这些字符（`…` 同时覆盖 `……`）。 */
const CJK_PUNCT = "，。！？、；：（）《》【】「」『』“”‘’…—·";

/** 归一化前先保护 URL / 邮箱 / 小数 / 时间：它们内部的 `.` `:` 不是句读，补空格会改写事实。 */
const PROTECT_RE =
  /https?:\/\/[^\s，。！？、；）】」』"']+|\bwww\.[^\s，。！？、；）】」』"']+|[\w.+-]+@[\w-]+\.[\w.]+|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.:：]\d+)+/g;

/** 剥离 markdown、统一标点空白；不改变事实与措辞。按步骤顺序执行保证幂等。 */
export function stripSpokenMarkdown(text: string): string {
  // 1. markdown 链接 [文字](url) → 文字；先做，避免 URL 保护把右括号一起吞掉。
  let s = text;
  for (let guard = 0; guard < 4; guard++) {
    const next = s.replace(/\[([^[\]]*)\]\([^)\n]*\)/g, "$1");
    if (next === s) break;
    s = next;
  }
  // 2. 占位保护数字 / URL / 邮箱；用私用区字符，后续任何规则都不会碰它们。
  const protectedTokens: string[] = [];
  s = s.replace(PROTECT_RE, (token) => {
    protectedTokens.push(token);
    return `\uE000${protectedTokens.length - 1}\uE001`;
  });
  // 3. 代码块（含语言标记）与行内反引号；残留的反引号一并清掉。
  s = s
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/`/g, "");
  // 4. 行首标题。
  s = s.replace(/^#{1,6}[ \t]*/gm, "");
  // 5. 行首列表：无序 / 有序。
  s = s.replace(/^[-*+•][ \t]+/gm, "");
  // `(?!\d)`：别把「3. 14」这种带空格的数字当有序列表吃掉。
  s = s.replace(/^\d+[.)][ \t]+(?!\d)/gm, "");
  // 6. 行首引用（连续 > 一次剥完，保证幂等）。
  s = s.replace(/^>+(?:[ \t])?/gm, "");
  // 7. 水平线。
  s = s.replace(/^-{3,}$/gm, "");
  s = s.replace(/^\*{3,}$/gm, "");
  // 8. 加粗 / 斜体标记；`_` 只在词边界成对时剥，不碰 snake_case。
  s = s.replace(/\*\*|__/g, "");
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
  s = s.replace(/(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu, "$1");
  // 9. 换行与连续空白折叠成单个空格。
  s = s.replace(/\s+/g, " ");
  // 10. 中文：两个 CJK 字符之间、以及 CJK 标点紧邻汉字时的空格去掉（中英之间保留）。
  //     标点规则必须要求汉字邻接，否则英文的「I miss you… Never」会被误删空格、破坏 beats 拼接。
  s = s
    .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, "")
    .replace(new RegExp(`(?<=\\p{Script=Han})\\s+(?=[${CJK_PUNCT}])`, "gu"), "")
    .replace(new RegExp(`(?<=[${CJK_PUNCT}])\\s+(?=\\p{Script=Han})`, "gu"), "");
  // 11. 英文：标点前不留空格；标点后补一个（句末 / 后接标点 / 后接汉字除外）；折叠多空格并 trim。
  s = s
    .replace(/\s+(?=[,.;:!?])/g, "")
    .replace(/(?<=[,.;:!?])(?![\s,.;:!?]|$)(?![\p{Script=Han}])/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 12. 还原受保护的数字 / URL / 邮箱。
  return s.replace(/\uE000(\d+)\uE001/g, (_, i: string) => protectedTokens[Number(i)] ?? "");
}

/** 中文超长截断：先找句末标点，再找次级标点补省略号；都没有则原样返回。 */
function truncateZh(s: string, limit: number): string {
  const chars = [...s];
  const prefix = chars.slice(0, limit);
  for (let i = prefix.length - 1; i >= 0; i--) {
    if (SENTENCE_END.includes(prefix[i])) return prefix.slice(0, i + 1).join("");
  }
  for (let i = prefix.length - 1; i >= 0; i--) {
    if (SECONDARY_PUNCT.includes(prefix[i])) return prefix.slice(0, i + 1).join("") + "……";
  }
  return s;
}

/** 英文超长截断：按词边界，绝不在单词中间切。 */
function truncateEn(s: string, limit: number): string {
  const words = s.split(/\s+/);
  const within = words.slice(0, limit);
  for (let i = within.length - 1; i >= 0; i--) {
    if (SENTENCE_END.includes(within[i].slice(-1))) return within.slice(0, i + 1).join(" ");
  }
  for (let i = within.length - 1; i >= 0; i--) {
    if (SECONDARY_PUNCT.includes(within[i].slice(-1))) return within.slice(0, i + 1).join(" ") + "…";
  }
  return s;
}

/** 剥离 + 归一 + 超长按句末截断（§4.5）；对同一输入幂等。 */
export function enforceLine(text: string, lang: Lang, shape: ReplyShape): string {
  // shape 为签名预留：截断只按绝对上限，形态上限用于提示词侧（replyShapeLimit）。
  void shape;
  const s = stripSpokenMarkdown(text);
  const limit = ABSOLUTE_LIMIT[lang];
  const over = lang === "zh" ? [...s].length > limit : s.split(/\s+/).length > limit;
  if (!over) return s;
  return lang === "zh" ? truncateZh(s, limit) : truncateEn(s, limit);
}

/** 同音 / 易混词表（§4.6），前者替换为后者。 */
const HOMOPHONE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["在", "再"],
  ["的", "得"],
  ["他", "她"],
  ["那", "哪"],
  ["已", "以"],
  ["做", "作"],
  ["吧", "把"],
  ["呢", "呐"],
];

/** 英文常见错拼（§4.6），只在原词存在时替换。 */
const EN_TYPO: Record<string, string> = {
  the: "teh",
  you: "yuo",
  just: "jsut",
  really: "realy",
  because: "becuase",
  about: "abuot",
};

/** 标点或空白不参与错字（不得改动标点结构）。 */
const NOT_TYPOABLE = /[\p{P}\s]/u;

function typoCase(word: string, typo: string): string {
  return /^[A-Z]/.test(word) ? typo[0].toUpperCase() + typo.slice(1) : typo;
}

/** 可选错字（§4.6）：默认关闭，`locked`（revealed / terminal / ended）时强制关闭；最多改一处。 */
export function maybeImperfection(input: {
  text: string;
  lang: Lang;
  rng: () => number;
  enabled: boolean;
  locked: boolean;
}): { text: string; corrected: boolean } {
  const { text, lang, rng, enabled, locked } = input;
  if (!enabled || locked) return { text, corrected: false };
  if (lang === "en") {
    const roll = rng();
    if (roll >= 0.003) return { text, corrected: false };
    const words = text.split(/\s+/);
    const pick = Math.floor((roll / 0.003) * words.length);
    const picked = words[pick]?.toLowerCase() ?? "";
    const idx = EN_TYPO[picked] ? pick : words.findIndex((w) => EN_TYPO[w.toLowerCase()]);
    if (idx >= 0) {
      words[idx] = typoCase(words[idx], EN_TYPO[words[idx].toLowerCase()]);
      return { text: words.join(" "), corrected: true };
    }
    return { text, corrected: false };
  }
  // 中文三档概率各自独立抽样；按 重复 > 同音替换 > 删除 的优先级最多应用一处。
  const dDup = rng();
  const dSub = rng();
  const dDel = rng();
  const chars = [...text];
  if (dDup < 0.003 && chars.length > 0) {
    const pos = Math.floor((dDup / 0.003) * chars.length);
    if (!NOT_TYPOABLE.test(chars[pos])) {
      chars.splice(pos, 0, chars[pos]);
      return { text: chars.join(""), corrected: true };
    }
  }
  if (dSub < 0.03) {
    const pair = HOMOPHONE_PAIRS[Math.floor((dSub / 0.03) * HOMOPHONE_PAIRS.length)];
    const target =
      pair && text.includes(pair[0])
        ? pair
        : (HOMOPHONE_PAIRS.find(([k]) => text.includes(k)) ?? null);
    if (target) return { text: text.replace(target[0], target[1]), corrected: true };
  }
  if (dDel < 0.002 && chars.length > 1) {
    const pos = Math.floor((dDel / 0.002) * chars.length);
    if (!NOT_TYPOABLE.test(chars[pos])) {
      chars.splice(pos, 1);
      return { text: chars.join(""), corrected: true };
    }
  }
  return { text, corrected: false };
}

/** 注意力漂移（走神）判定：`rng() < 0.15`。 */
export function pickDrift(rng: () => number): boolean {
  return rng() < 0.15;
}

/** 漂移写法提示：只影响怎么说，不许改变事实、立场、goal / redLine；问句与结局回合禁用。 */
export function driftDirective(lang: Lang): string {
  return lang === "zh"
    ? "THIS TURN MAY DRIFT: 允许轻轻走神半句\n" +
        "- 可以在半句里岔开一点：想起别的事、看一眼窗外、答非所问半句，然后回到对话。\n" +
        "- 不许改变事实、立场、goal 或 redLine；不许在问句或结局回合使用。"
    : "THIS TURN MAY DRIFT: a half-line of distraction is allowed\n" +
        "- Drift for half a line: remember something else, glance out the window, answer askew — then return to the conversation.\n" +
        "- Never change facts, stance, goal, or redLine; never use it on a question or ending turn.";
}

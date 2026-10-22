import type { Lang } from "@/data/taxonomy";

/**
 * 文风靠拢与用词提示（spec-love-human-voice §4.3/§4.4，P2）。
 * 纯函数、无 IO、不落盘：每次请求从 messages 里的 learner 行现算。
 * 只影响「怎么说」，不改变人设、立场与事实层；样本太少（<3）不画像。
 */

const round2 = (x: number): number => Math.round(x * 100) / 100;

/* ------------------------------------------------------------------ *
 * 画像
 * ------------------------------------------------------------------ */

export interface StyleProfile {
  samples: number;
  avgChars: number;
  shortRatio: number;      // zh: ≤8 汉字；en: ≤4 词
  questionRatio: number;   // 含 ? / ？
  ellipsisRatio: number;   // 含 … 或 ...
  emojiRatio: number;      // Extended_Pictographic
  particles: string[];     // 中文语气词实际出现过的
  latinRatio: number;      // zh 文本里含拉丁字母的行占比；en 恒 0
  lowercaseStartRatio: number; // en 行首字母小写占比；zh 恒 0
}

const ZERO_PROFILE: StyleProfile = {
  samples: 0,
  avgChars: 0,
  shortRatio: 0,
  questionRatio: 0,
  ellipsisRatio: 0,
  emojiRatio: 0,
  particles: [],
  latinRatio: 0,
  lowercaseStartRatio: 0,
};

/** 中文语气词，固定顺序；输出只含实际出现过的。 */
const PARTICLES = ["啊", "吧", "呢", "嘛", "诶", "呀", "哦", "啦"] as const;

const EMOJI_RE = /[\p{Extended_Pictographic}]/u;
const LATIN_RE = /[A-Za-z]/;

/** 行首字母前的可跳过字符：空白 + 引号/括号（ascii 与全角）。 */
const SKIP_BEFORE_LETTER = new Set([
  " ", "\t", "\"", "'", "“", "”", "‘", "’",
  "(", ")", "（", "）", "[", "]", "【", "】",
  "「", "」", "『", "』",
]);

/** 英文行的第一个字母是否小写；行里没有字母返回 null（不进分母）。 */
function firstLetterLower(line: string): boolean | null {
  for (const ch of line) {
    if (/\s/.test(ch) || SKIP_BEFORE_LETTER.has(ch)) continue;
    if (/[a-z]/.test(ch)) return true;
    if (/[A-Z]/.test(ch)) return false;
    return null;
  }
  return null;
}

export function analyzeStyle(lines: readonly string[], lang: Lang): StyleProfile {
  const rows = lines.filter((l) => l.trim().length > 0);
  const samples = rows.length;
  if (samples === 0) return { ...ZERO_PROFILE };

  // zh 与 en 统一按 [...text].length（码点）统计：en 的词数无法从字符数反推，
  // 画像阶段不引入分词；词数口径只在 styleMirrorBlock 的长文阈值里用字符数近似。
  const totalChars = rows.reduce((sum, l) => sum + [...l].length, 0);
  const shortCount = rows.filter((l) =>
    lang === "zh" ? [...l].length <= 8 : l.split(/\s+/).length <= 4,
  ).length;
  const questionCount = rows.filter((l) => /[?？]/.test(l)).length;
  const ellipsisCount = rows.filter((l) => /…|\.\.\./.test(l)).length;
  const emojiCount = rows.filter((l) => EMOJI_RE.test(l)).length;
  const latinCount = lang === "zh" ? rows.filter((l) => LATIN_RE.test(l)).length : 0;
  const lowerCount =
    lang === "en" ? rows.filter((l) => firstLetterLower(l) === true).length : 0;
  const lowerDenom =
    lang === "en" ? rows.filter((l) => firstLetterLower(l) !== null).length : 0;

  return {
    samples,
    avgChars: Math.round(totalChars / samples),
    shortRatio: round2(shortCount / samples),
    questionRatio: round2(questionCount / samples),
    ellipsisRatio: round2(ellipsisCount / samples),
    emojiRatio: round2(emojiCount / samples),
    particles: lang === "zh" ? PARTICLES.filter((p) => rows.some((l) => l.includes(p))) : [],
    latinRatio: lang === "zh" ? round2(latinCount / samples) : 0,
    lowercaseStartRatio: lang === "en" ? round2(lowerDenom ? lowerCount / lowerDenom : 0) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * 文风靠拢提示词块
 * ------------------------------------------------------------------ */

const STYLE_HEAD = (lang: Lang): string =>
  lang === "zh"
    ? "LEARNER'S WRITING STYLE（只影响你说话的长短与语气，不改变人设、不改变立场）"
    : "LEARNER'S WRITING STYLE (affects only how long and how casual your lines are — never the persona, never your stance)";

const STYLE_FORBID = (lang: Lang): string =>
  lang === "zh"
    ? "- 不要模仿错别字，不要评论他说话的方式，不要变成另一个人。"
    : "- Don't mimic typos, don't comment on how they talk, don't become someone else.";

/**
 * 长文阈值：中文直接按 spec 的 avgChars > 60 汉字；英文平均词数 > 45 的
 * 判断无法从 avgChars 反推（画像只存字符数），按英文平均 5.3 字符/词折算为
 * 240 字符作为等价阈值。
 */
function isLongForm(profile: StyleProfile, lang: Lang): boolean {
  return lang === "zh" ? profile.avgChars > 60 : profile.avgChars > 240;
}

export function styleMirrorBlock(profile: StyleProfile, lang: Lang): string | null {
  if (profile.samples < 3) return null;
  const head = STYLE_HEAD(lang);

  if (isLongForm(profile, lang)) {
    // 长文只给「不要比他更啰嗦」，不给靠拢指令。
    const hint =
      lang === "zh"
        ? "- 他习惯写长消息：不要比他更啰嗦。"
        : "- They tend to write long messages: don't be more long-winded than they are.";
    return `${head}\n${hint}\n${STYLE_FORBID(lang)}`;
  }

  // 只描述 2–4 个可观察特征（从 profile 字段推导，绝不贴原句）。
  const feats: string[] = [];
  if (lang === "zh") {
    feats.push(`他的消息平均 ${profile.avgChars} 字`);
    if (profile.shortRatio >= 0.6) feats.push("以短句为主");
    else if (profile.shortRatio <= 0.35) feats.push("句子偏长");
    if (profile.questionRatio >= 0.4) feats.push("常以问句结尾");
    if (profile.ellipsisRatio >= 0.3) feats.push("说话常带省略号");
    if (profile.particles.length > 0) feats.push(`常用「${profile.particles.slice(0, 3).join("」「")}」等语气词`);
    if (profile.emojiRatio >= 0.3) feats.push("经常用 emoji");
    else if (profile.emojiRatio === 0) feats.push("几乎不用 emoji");
    else feats.push("偶尔用 emoji");
    if (profile.latinRatio >= 0.2) feats.push("习惯中英混用");
  } else {
    feats.push(`Their messages average ${profile.avgChars} characters`);
    if (profile.shortRatio >= 0.6) feats.push("mostly short sentences");
    else if (profile.shortRatio <= 0.35) feats.push("longer sentences");
    if (profile.questionRatio >= 0.4) feats.push("often ends with a question");
    if (profile.ellipsisRatio >= 0.3) feats.push("often trails off with an ellipsis");
    if (profile.emojiRatio >= 0.3) feats.push("uses emoji a lot");
    else if (profile.emojiRatio === 0) feats.push("hardly uses emoji");
    else feats.push("occasionally uses emoji");
  }
  const desc =
    lang === "zh"
      ? `- ${feats[0]}，${feats.slice(1, 4).join("；")}。`
      : `- ${feats[0]}, ${feats.slice(1, 4).join("; ")}.`;
  const lean =
    lang === "zh"
      ? "- 轻微靠拢：句子长度接近他，少用书面语。"
      : "- Lean lightly toward that: keep your sentences close to theirs in length, avoid formal phrasing.";
  return `${head}\n${desc}\n${lean}\n${STYLE_FORBID(lang)}`;
}

/* ------------------------------------------------------------------ *
 * 用词提取（无分词依赖：引号词 / 拉丁 token / 中文重复片段）
 * ------------------------------------------------------------------ */

export interface LexiconTerm {
  term: string;
  count: number;
  source: string;
}

interface Candidate {
  term: string;
  count: number;
  firstIndex: number;
}

const LATIN_STOP = new Set([
  "the", "and", "you", "that", "this", "with", "have", "just", "like", "for",
  "but", "not", "are", "was", "what", "your", "our", "they", "then", "than",
  "from", "about", "into", "over", "under", "very", "really", "okay", "yeah",
]);

const CJK_STOP = new Set([
  "我们", "你们", "他们", "就是", "什么", "这个", "那个", "现在", "觉得", "真的",
  "可以", "但是", "因为", "所以", "还是", "一个", "没有", "知道", "时候", "自己",
  "不是", "这样", "那样", "如果", "然后", "已经", "感觉", "有点", "其实", "可能",
  "应该", "喜欢", "好的", "嗯嗯", "谢谢", "你好", "再见",
]);

/** 五种引号：内容 1–20 字，取首个非空捕获组。 */
const QUOTE_RE = /「([^」]{1,20})」|『([^』]{1,20})』|“([^”]{1,20})”|"([^"]{1,20})"|'([^']{1,20})'/g;
const LATIN_TOKEN_RE = /[A-Za-z][A-Za-z0-9_'-]{1,23}/g;
const CJK_RUN_RE = /[\u3400-\u9fff]+/g;

function countCandidates(rows: readonly string[], collect: (row: string, rowIndex: number, seen: Map<string, Candidate>) => void): Candidate[] {
  const seen = new Map<string, Candidate>();
  rows.forEach((row, i) => collect(row, i, seen));
  return [...seen.values()].sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex);
}

export function extractTerms(lines: readonly string[], lang: Lang): LexiconTerm[] {
  const rows = lines.filter((l) => l.trim().length > 0);

  // 1) 引号包住的词；2) 拉丁/数字 token（大小写敏感去重，停用词除外）。
  const quoted = countCandidates(rows, (row, i, seen) => {
    QUOTE_RE.lastIndex = 0;
    for (let m = QUOTE_RE.exec(row); m; m = QUOTE_RE.exec(row)) {
      const raw = m.slice(1).find((g) => g !== undefined) ?? "";
      const term = raw.trim();
      if (term.length < 1 || term.length > 20) continue;
      bump(seen, term, i);
    }
  });
  const latin = countCandidates(rows, (row, i, seen) => {
    LATIN_TOKEN_RE.lastIndex = 0;
    for (let m = LATIN_TOKEN_RE.exec(row); m; m = LATIN_TOKEN_RE.exec(row)) {
      if (LATIN_STOP.has(m[0].toLowerCase())) continue;
      bump(seen, m[0], i);
    }
  });

  // 3) 中文 2–4 字重复片段：每行 CJK 连续段上的滑窗，全样本出现 ≥2 次才要。
  //    中文提取只在 zh 模式跑；en 文本没有 CJK 段，天然为空。
  let frags: Candidate[] = [];
  if (lang === "zh") {
    const seen = new Map<string, Candidate>();
    rows.forEach((row, i) => {
      for (const run of row.match(CJK_RUN_RE) ?? []) {
        for (let size = 2; size <= 4; size++) {
          for (let start = 0; start + size <= run.length; start++) {
            const frag = run.slice(start, start + size);
            if (CJK_STOP.has(frag)) continue;
            bump(seen, frag, i);
          }
        }
      }
    });
    frags = [...seen.values()].filter((c) => c.count >= 2);
    // 同一条 term 只保留最长且 count 相同者：等 count 的短片段是长片段子串时丢掉。
    frags = frags.filter(
      (f) =>
        !frags.some(
          (g) => g !== f && g.count === f.count && g.term.length > f.term.length && g.term.includes(f.term),
        ),
    );
    frags.sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex);
  }

  // 引号词与拉丁 token 优先于中文片段；整体按 term 去重后取前 8。
  const merged: Candidate[] = [];
  const seenTerms = new Set<string>();
  for (const tier of [quoted, latin, frags]) {
    for (const c of tier) {
      if (seenTerms.has(c.term)) continue;
      seenTerms.add(c.term);
      merged.push(c);
      if (merged.length >= 8) break;
    }
    if (merged.length >= 8) break;
  }
  return merged.map((c) => ({ term: c.term, count: c.count, source: rows[c.firstIndex].slice(0, 120) }));
}

function bump(seen: Map<string, Candidate>, term: string, rowIndex: number): void {
  const cur = seen.get(term);
  if (cur) cur.count += 1;
  else seen.set(term, { term, count: 1, firstIndex: rowIndex });
}

/* ------------------------------------------------------------------ *
 * 用词提示词块
 * ------------------------------------------------------------------ */

export function lexiconBlock(terms: readonly LexiconTerm[], lang: Lang): string | null {
  if (terms.length === 0) return null;
  const head =
    lang === "zh"
      ? "LEARNER'S OWN WORDS（学习者自己的用词；不是让你复读的清单）"
      : "LEARNER'S OWN WORDS (the learner's own vocabulary — not a checklist to repeat back)";
  const lines = terms.slice(0, 8).map((t) => `- ${t.term}`);
  const rules =
    lang === "zh"
      ? "规则：一轮最多 1 个，要自然融入；只在贴合语境时用；不要重复对方的话；不要解释这个词；不要因为这个改变立场。"
      : "Rules: use at most one per turn, naturally; only when it fits the context; don't repeat their words back; don't explain the term; don't change your stance because of it.";
  return `${head}\n${lines.join("\n")}\n${rules}`;
}

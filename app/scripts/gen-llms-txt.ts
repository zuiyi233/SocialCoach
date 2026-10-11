/**
 * Generate app/public/llms.txt — the machine-readable entry point for LLMs
 * (wiki/12-stage-c.md, C5). The corpus URL inventory is derived from
 * src/data/corpus so it stays in sync as items are added; committed artifact
 * and script both live in the repo.
 *
 * URL 口径 (pinned with the landing-page agent):
 *   scenarios → /scenarios/{id}、/en/scenarios/{id}
 *   theories & cases → /library/{id}、/en/library/{id}
 *   absolute URLs built from SITE_URL (see src/lib/site-url.ts).
 *
 * Run:  pnpm exec tsx scripts/gen-llms-txt.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCENARIOS, THEORIES, CASES } from "../src/data/corpus/index";
import { SITE_URL } from "../src/lib/site-url";

const ORIGIN = SITE_URL.replace(/\/+$/, "");
const HOST = new URL(ORIGIN).host;
const link = (path: string) => `${ORIGIN}${path}`;

const SORTED_SCENARIOS = [...SCENARIOS].sort((a, b) => a.id.localeCompare(b.id));
const SORTED_THEORIES = [...THEORIES].sort((a, b) => a.id.localeCompare(b.id));
const SORTED_CASES = [...CASES].sort((a, b) => a.id.localeCompare(b.id));

// Author order follows README.md "研究" bibtex.
const AUTHORS = [
  "Tianfu Wang",
  "Max Xiong",
  "Yuxuan Lei",
  "Jianxun Lian",
  "Hongyuan Zhu",
  "Zhengyu Hu",
  "Linxiao Gong",
  "Dapeng Hu",
  "Xiaofang Li",
  "Peiting Tsai",
  "Nicholas Jing Yuan",
  "Qi Zhang",
];

const BIBTEX = `@article{wang2026socialcoach,
  title   = {SocialCoach: Personalized Social Skill Learning with Agentic Tutoring and Practice},
  author  = {Wang, Tianfu and Xiong, Max and Lei, Yuxuan and Lian, Jianxun
             and Zhu, Hongyuan and Hu, Zhengyu and Gong, Linxiao and Hu, Dapeng and Li, Xiaofang and Tsai, Peiting
             and Yuan, Nicholas Jing and Zhang, Qi},
  journal = {arXiv preprint arXiv:2606.04155},
  year    = {2026}
}`;

const out: string[] = [];

// ── Header / positioning ────────────────────────────────────────────────
out.push("# SocialCoach");
out.push("");
out.push("> 想说的话，说出来。");
out.push("> You know what to say. You just can't say it yet.");
out.push("");
out.push(
  "SocialCoach 是一个 AI 社交技能教练：在真实情境里和有自己立场、不会让你赢的 AI 角色实战演练，再用引用你原话的复盘，逐步提高沟通水平。核心语料是 142 个练习场景、168 条理论与 39 个案例，全部中英双语、全部有出处。无需注册，练习记录留在设备上、可导出。",
);
out.push(
  "SocialCoach is an AI social-skills coach: rehearse real conversations with characters who have their own goals and won't let you win, then review a debrief that quotes your own words. The corpus is 142 practice scenarios, 168 theories and 39 cases — bilingual (zh/en), every item with a traceable source. No account needed; practice records stay on your device and can be exported.",
);
out.push("");

// ── Key entry points ───────────────────────────────────────────────────
out.push("## Key entry points");
out.push("");
out.push(`- App homepage: ${link("/")}`);
out.push(`- 3D dinner/office practice: ${link("/3d")}`);
out.push(`- Library (videos, theories, cases): ${link("/learn")}`);
out.push("");

// ── Research ───────────────────────────────────────────────────────────
out.push("## Research");
out.push("");
out.push(
  "SocialCoach 基于论文《SocialCoach: Personalized Social Skill Learning with Agentic Tutoring and Practice》（arXiv 预印本，2026）。",
);
out.push(
  "Based on the paper: SocialCoach: Personalized Social Skill Learning with Agentic Tutoring and Practice (arXiv preprint, 2026).",
);
out.push("");
out.push("- Title: SocialCoach: Personalized Social Skill Learning with Agentic Tutoring and Practice");
out.push("- arXiv: 2606.04155 — https://arxiv.org/abs/2606.04155");
out.push(`- Host: ${HOST}`);
out.push("- Published: 2026-08-16 (arXiv preprint)");
out.push(`- Authors (12): ${AUTHORS.join(", ")}`);
out.push("");
out.push("```bibtex");
out.push(BIBTEX);
out.push("```");
out.push("");

// ── Scope & boundaries ─────────────────────────────────────────────────
out.push("## Scope and boundaries");
out.push("");
out.push("- 练习工具，不是临床评估、诊断或治疗：SocialCoach 不做任何医疗或心理健康声明，也不替代专业帮助。");
out.push("- 不是经认证的学校 SEL 课程；它是一个面向个人的练习工具。");
out.push("- 反馈、评分与复盘基于你本场对话的内容，不构成对个人能力的医学或心理评估。");
out.push("- 无需账号；练习记录只保存在设备上，可导出。");
out.push("- 每条理论/案例都标注来源（书名 + 作者），语料不生成无出处的策略或案例。");
out.push("");
out.push(
  "Practice tool only — not clinical assessment, diagnosis or treatment; not substitute for professional help. Not a certified school SEL curriculum.",
);
out.push("");

// ── Corpus index ───────────────────────────────────────────────────────
out.push("## Corpus index");
out.push("");
out.push(
  `The app ships ${SCENARIOS.length + THEORIES.length + CASES.length} bilingual learning items across ${SCENARIOS.length} scenarios, ${THEORIES.length} theories and ${CASES.length} cases — ${(SCENARIOS.length + THEORIES.length + CASES.length) * 2} landing pages with the zh/en versions.`,
);
out.push("");
out.push("Landing-page URL patterns (zh / en):");
out.push("");
out.push(`- Scenarios: ${link("/scenarios/{id}")} — ${link("/en/scenarios/{id}")}`);
out.push(`- Theories & cases: ${link("/library/{id}")} — ${link("/en/library/{id}")}`);
out.push("");

const itemGroups: Array<{
  heading: string;
  items: Array<{ id: string; path: string; enPath: string }>;
}> = [
  {
    heading: `### Scenarios (${SORTED_SCENARIOS.length}, 中文)`,
    items: SORTED_SCENARIOS.map((s) => ({ id: s.id, path: `/scenarios/${s.id}`, enPath: `/en/scenarios/${s.id}` })),
  },
  {
    heading: `### Scenarios (${SORTED_SCENARIOS.length}, English)`,
    items: SORTED_SCENARIOS.map((s) => ({ id: s.id, path: `/en/scenarios/${s.id}`, enPath: `/en/scenarios/${s.id}` })),
  },
  {
    heading: `### Theories (${SORTED_THEORIES.length}, 中文)`,
    items: SORTED_THEORIES.map((t) => ({ id: t.id, path: `/library/${t.id}`, enPath: `/en/library/${t.id}` })),
  },
  {
    heading: `### Theories (${SORTED_THEORIES.length}, English)`,
    items: SORTED_THEORIES.map((t) => ({ id: t.id, path: `/en/library/${t.id}`, enPath: `/en/library/${t.id}` })),
  },
  {
    heading: `### Cases (${SORTED_CASES.length}, 中文)`,
    items: SORTED_CASES.map((c) => ({ id: c.id, path: `/library/${c.id}`, enPath: `/en/library/${c.id}` })),
  },
  {
    heading: `### Cases (${SORTED_CASES.length}, English)`,
    items: SORTED_CASES.map((c) => ({ id: c.id, path: `/en/library/${c.id}`, enPath: `/en/library/${c.id}` })),
  },
];

for (const group of itemGroups) {
  out.push(group.heading);
  out.push("");
  for (const item of group.items) {
    out.push(`- ${link(item.path)}`);
  }
  out.push("");
}

out.push("## About this file");
out.push("");
out.push("Generated by app/scripts/gen-llms-txt.ts — run it after corpus changes to refresh this list.");

const output = `${out.join("\n").replace(/\n+$/, "")}\n`;
const target = fileURLToPath(new URL("../public/llms.txt", import.meta.url));
writeFileSync(target, output, "utf8");
console.log(`llms.txt written to ${target} (${Buffer.byteLength(output, "utf8")} bytes, ${out.length - 1} lines)`);
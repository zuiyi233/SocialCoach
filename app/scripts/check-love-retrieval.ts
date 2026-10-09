/**
 * Love-track retrieval baseline check (quality gate C).
 *
 * Run from app/: npx tsx scripts/check-love-retrieval.ts
 *
 * For each of the 8 love topics, retrieves knowledge the way a real debrief
 * does (topic-neutral learner wording + the topic's typical skills) and prints
 * the top-3 theories with their score breakdown (skill / loveTopic / context /
 * lexical). The breakdown ranking is recomputed here so the four components are
 * visible; it must exactly match retrieveKnowledge's ordering, otherwise the
 * report is lying about what the learner would actually see.
 *
 * Hard gate (asserted): every love topic must surface at least one of its own
 * theories in the top 3. That is the regression that stops future batches from
 * silently destroying the love-topic weighting.
 */
import assert from "node:assert/strict";
import { retrieveKnowledge, lexicalScore } from "../src/lib/retrieval";
import { THEORIES } from "../src/data/corpus";
import { LOVE_TOPICS, type LoveTopicId } from "../src/data/corpus/love-topics";
import type { SkillId } from "../src/data/taxonomy";

interface Probe {
  /** Typical skills of the topic's scenarios — simulates a real debrief call. */
  skills: SkillId[];
  /** Topic-neutral learner wording; deliberately avoids theory titles/keywords. */
  query: string;
}

const PROBES: Record<LoveTopicId, Probe> = {
  approach: {
    skills: ["building-relationships", "initiative"],
    query: "认识了一个人，聊过几次，想继续了解，又怕太主动把人吓跑",
  },
  "define-relationship": {
    skills: ["communication"],
    query: "相处两个月了，我想知道我们到底算什么，又怕一开口就把气氛弄僵",
  },
  rejection: {
    skills: ["emotion-regulation", "self-efficacy"],
    query: "我把心里的话说出来了，对方的回应不是我想的，现在不知道怎么收场",
  },
  breakup: {
    skills: ["communication", "emotion-regulation"],
    query: "在一起很久了，感觉越来越远，我想结束，又舍不得",
  },
  boundary: {
    skills: ["standing-up", "communication"],
    query: "有些事我不想配合，又不想把关系搞僵，不知道怎么开口",
  },
  "long-distance": {
    skills: ["communication", "perspective-taking"],
    query: "隔着很远，消息回复时快时慢，心里一直没底",
  },
  family: {
    skills: ["communication", "social-norms"],
    query: "见了对方家里人，饭桌上问了很多，我有点招架不住",
  },
  trust: {
    skills: ["communication", "empathy"],
    query: "发现对方瞒了我一些事，我不知道还能不能像以前一样相信",
  },
};

type TheoryLike = (typeof THEORIES)[number];

function theoryText(t: TheoryLike): string[] {
  return [t.title.en, t.title.zh, t.principle.en, t.principle.zh, ...t.howTo.flatMap((l) => [l.zh, l.en])];
}

interface BreakdownRow {
  id: string;
  topic: string | undefined;
  skill: number;
  love: number;
  ctx: number;
  lex: number;
  score: number;
}

function rankWithBreakdown(topicId: LoveTopicId, probe: Probe): BreakdownRow[] {
  const ctx = "romantic";
  return THEORIES.map((t) => {
    const skill = probe.skills.filter((k) => t.skills.includes(k)).length * 2;
    const love = t.loveTopic === topicId ? 3 : 0;
    const context = t.context === ctx ? 0.5 : 0;
    const lex = lexicalScore(probe.query, [...theoryText(t), ...t.keywords]) * 3;
    return { id: t.id, topic: t.loveTopic, skill, love, ctx: context, lex, score: skill + love + context + lex };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

const rows = new Map<LoveTopicId, BreakdownRow[]>();
let gated = 0;
for (const topic of LOVE_TOPICS) {
  const probe = PROBES[topic.id];
  const opts = { skills: probe.skills, context: "romantic" as const, query: probe.query, acquisition: true, performance: true, loveTopic: topic.id };
  const ranked = rankWithBreakdown(topic.id, probe);
  const actual = retrieveKnowledge(opts);
  assert.deepEqual(
    ranked.map((r) => r.id),
    actual.theories.map((t) => t.id),
    `${topic.id}: breakdown ranking diverges from retrieveKnowledge — report would be misleading`,
  );
  const own = ranked.some((r) => r.topic === topic.id);
  if (own) gated++;
  rows.set(topic.id, ranked);
  assert(own, `${topic.id}: no love-topic-matched theory in top 3 — loveTopic boost is not working`);
}

console.log("love-topic retrieval baseline (top 3 per topic; score = skill + love + ctx + lex)");
console.log("-".repeat(100));
console.log(
  `${"topic".padEnd(18)}${"rank".padEnd(5)}${"theory id".padEnd(42)}${"skill".padEnd(6)}${"love".padEnd(5)}${"ctx".padEnd(5)}${"lex".padEnd(5)}${"score".padEnd(6)}`,
);
for (const topic of LOVE_TOPICS) {
  for (let i = 0; i < 3; i++) {
    const r = rows.get(topic.id)![i];
    const topicTag = r.topic === topic.id ? "*" : r.topic ?? "—";
    console.log(
      `${(topic.id + " " + topicTag).padEnd(18)}${String(i + 1).padEnd(5)}${r.id.padEnd(42)}${String(r.skill.toFixed(1)).padEnd(6)}${String(r.love.toFixed(1)).padEnd(5)}${String(r.ctx.toFixed(1)).padEnd(5)}${String(r.lex.toFixed(1)).padEnd(5)}${r.score.toFixed(2).padEnd(6)}`,
    );
  }
}
console.log("-".repeat(100));
console.log(`topics surfacing their own theory in top 3: ${gated}/${LOVE_TOPICS.length}`);
console.log("(* marks theories carrying the probed loveTopic; only the * rows are the topic's own material)");
console.log("Human gate: at least 6 of 8 topics should have >=2 substantively relevant rows in top 3.");

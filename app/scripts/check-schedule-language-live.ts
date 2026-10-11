/** Opt-in live check for the scheduler's learner-facing language contract:
 * the adaptation fields (briefing / objectives / focus / why) must never leak
 * the internal bracketed skill id (`[seeking-help]` style) or — on the zh path —
 * the English skill names that `profileBlock` feeds the model as data.
 *
 * Run: node --env-file=.env.local --import tsx scripts/check-schedule-language-live.ts
 * One full schedule chain per language (~3 model calls each); keep runs serial,
 * the gateway throttles around 3 rpm and a 429 here is a failed probe, not a
 * language defect.
 */
import { FAST_MODEL, hasServerCredential, serverLLM } from "../src/lib/llm";
import { runSchedule } from "../src/lib/tasks/schedule";
import { SKILLS, type Lang, type SkillId } from "../src/data/taxonomy";

const PROFILES: Record<Lang, { name: string; bio: string; goals: SkillId[] }> = {
  zh: {
    name: "小周",
    bio: "在一家中型软件公司做产品经理，带一个三人的小团队，经常需要跟设计和不直接汇报给我的开发同事协调排期。最近一次跨部门会上，我被当众质疑了方案的可行性，当时没能把讨论拉回事实层面。",
    goals: ["communication", "resolving-conflicts"],
  },
  en: {
    name: "Sam",
    bio: "A product manager at a mid-size software company, leading a team of three. I regularly coordinate schedules with designers and developers outside my reporting line. In a recent cross-team meeting my plan was publicly questioned and I failed to steer the discussion back to facts.",
    goals: ["communication", "resolving-conflicts"],
  },
};

/** Matches the bracketed internal ids that `profileBlock` hands the model
 * ("seeking-help" and friends). Human prose never contains this pattern. */
const BRACKET_ID = /\[[a-z][a-z-]{2,}\]/;
const EN_SKILL_NAMES = SKILLS.map((s) => s.name.en);

async function checkLang(lang: Lang): Promise<string[]> {
  const p = PROFILES[lang];
  const out = await runSchedule(
    {
      profile: { ...p, contexts: ["workplace"], lang, createdAt: Date.now() },
      proficiency: { communication: 2.5, "resolving-conflicts": 2.0 },
      history: [],
      lang,
    },
    serverLLM,
    FAST_MODEL,
  );
  const a = out.adaptation;
  const fields: [string, string][] = [
    ["briefing", a.briefing ?? ""],
    ["focus", a.focus ?? ""],
    ["why", a.why ?? ""],
    ...(a.objectives ?? []).map((o, i): [string, string] => [`objectives[${i}]`, o ?? ""]),
  ];
  const bad: string[] = [];
  for (const [field, text] of fields) {
    if (BRACKET_ID.test(text)) bad.push(`${lang}/${field}: internal id leaked — ${text.slice(0, 120)}`);
    if (lang === "zh") {
      const hit = EN_SKILL_NAMES.find((n) => n.length > 3 && text.includes(n));
      if (hit) bad.push(`${lang}/${field}: English skill name "${hit}" on the zh path — ${text.slice(0, 120)}`);
    }
  }
  return bad;
}

async function main() {
  if (!hasServerCredential()) throw Error("No configured provider");
  const failures: string[] = [];
  // Serial on purpose: two live chains in parallel trip the account-level rpm cap.
  for (const lang of ["zh", "en"] as Lang[]) {
    const bad = await checkLang(lang);
    failures.push(...bad);
    console.log(`[${lang}] schedule chain done — ${bad.length === 0 ? "clean" : `${bad.length} leak(s)`}`);
  }
  if (failures.length) {
    for (const f of failures) console.error(`FAIL ${f}`);
    process.exitCode = 1;
  } else {
    console.log("PASS learner-facing schedule fields carry no internal ids and stay in the learner's language");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

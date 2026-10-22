/**
 * 生成调试状态夹具（app/debug/fixtures/states/*.json）。
 *
 * 夹具是数据，不是代码：CLI 的 `state.load` 直接写 localStorage。
 * 一旦 ArchiveSchema / SessionSchema 变了，重跑本脚本让夹具跟上契约：
 *
 *   cd app && npx tsx --tsconfig tsconfig.json scripts/debug-seed.ts
 *
 * 固定 id 与时间戳，保证 diff 稳定；场景本身仍从 corpus 取，避免手抄字段。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIOS } from "../src/data/corpus";
import { buildSession, defaultLearnerId, speakerOf } from "../src/lib/session-utils";

const OUT = join(process.cwd(), "debug", "fixtures", "states");
const AT = 1790000000000;

const profile = {
  name: "调试者",
  bio: "AI 调试用的虚构档案，不对应任何真人。",
  goals: ["communication"],
  contexts: ["workplace"],
  lang: "zh",
  createdAt: AT,
};

const settings = { tts: false, telemetry: false, theme: "light", voiceNoticeSeen: true };

const scenario = SCENARIOS.find((s) => s.id === "declining-extra-hours");
if (!scenario) throw new Error("declining-extra-hours is missing from the corpus");

const learnerId = defaultLearnerId(scenario);
const npcId = speakerOf(scenario, learnerId).id;
const briefing = buildSession(scenario, "arena", "zh");
const active = buildSession(scenario, "arena", "zh");

const fixtures = {
  "love-start": {
    archive: { profile, settings },
    keys: {},
  },
  "practice-briefing": {
    archive: {
      profile,
      settings,
      sessions: [{ ...briefing, id: "debug-practice-briefing", startedAt: AT }],
    },
    keys: {},
  },
  "practice-active": {
    archive: {
      profile,
      settings,
      sessions: [
        {
          ...active,
          id: "debug-practice-active",
          startedAt: AT,
          status: "active",
          messages: [
            { id: "debug-npc-1", role: "npc", characterId: npcId, text: "今晚这份改稿能不能帮我一起弄完？客户明早就要。", ts: AT + 1000 },
            { id: "debug-learner-1", role: "learner", text: "我今晚已经有安排了，可以先告诉我最急的是哪几页吗？", ts: AT + 2000 },
            // 必须以 NPC 收尾：最后一条是学习者发言时，Chat 会进「等待回复 / 恢复」态，输入框被禁用。
            { id: "debug-npc-2", role: "npc", characterId: npcId, text: "先标出第三部分的问题，明早九点前给我。", ts: AT + 3000 },
          ],
        },
      ],
    },
    keys: {},
  },
};

mkdirSync(OUT, { recursive: true });
for (const [name, fixture] of Object.entries(fixtures)) {
  const path = join(OUT, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

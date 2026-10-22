/** 离线回归：Galgame 回合的历史形状与契约修复路径（不联网，用假 LLM 记录请求）。G17：唯一哨兵解析。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOVE_PLAY_SENTINEL_CLOSE,
  LOVE_PLAY_SENTINEL_OPEN,
  runLovePlay,
  type LovePlayInput,
  type LovePlayMessage,
} from '../../src/lib/tasks/love-play';
import { LLMError, type ChatOpts, type LLM } from '../../src/lib/llm-core';
import { systemParts } from '../../src/lib/llm-core';
import { scenarioById } from '../../src/data/corpus';

const scenario = scenarioById('love-trust-eve-what-you-told')!;
const learnerId = scenario.characters.find((c) => c.playable)!.id;
const npcId = scenario.opening.characterId;
const shortScenario = scenarioById('love-approach-hobby-event')!;

const VALID = {
  line: { zh: '那句是你加的，还是我的原话？', en: 'Was that line yours or mine?' },
  options: [
    { zh: '是我加的。', en: 'I added it.' },
    { zh: '我不记得了。', en: 'I do not remember.' },
  ],
  emotion: 'tight',
  stance: 20,
  revealed: false,
  terminal: null,
  ended: false,
};

/** 按顺序吐出 replies 的假 LLM，并留下每次收到的请求。 */
function recorder(...replies: string[]): { llm: LLM; seen: ChatOpts[] } {
  const seen: ChatOpts[] = [];
  let n = 0;
  const llm: LLM = {
    chatText: async (opts: ChatOpts) => {
      seen.push(opts);
      return replies[Math.min(n++, replies.length - 1)];
    },
    chatStream: () => {
      throw Error('not used');
    },
  };
  return { llm, seen };
}

const systemText = (o: ChatOpts) => systemParts(o.system).map((part) => part.text).join('\n');

function input(messages: LovePlayMessage[]): LovePlayInput {
  return { scenario, learnerCharacterId: learnerId, language: 'zh', messages, turnLimit: scenario.maxTurns };
}

const opening: LovePlayMessage = { role: 'npc', characterId: npcId, text: scenario.opening.text.zh, ts: 1 };

test('prior NPC lines stay out of the assistant slot, which is the strongest format exemplar', async () => {
  const { llm, seen } = recorder(JSON.stringify(VALID));
  await runLovePlay(
    input([opening, { role: 'learner', text: '第一句大家知道，第二句是我替你说的。', ts: 2 }, { role: 'npc', characterId: npcId, text: '那当时你原话怎么讲的？', ts: 3 }, { role: 'learner', text: '我说她上一段刚结束，缓一缓就好。', ts: 4 }]),
    llm,
    'fake',
  );
  const turns = seen[0]!.messages;
  assert.equal(turns.filter((m) => m.role === 'assistant').length, 0, 'a partial-contract assistant history gets copied verbatim and collapses the reply shape');
  assert.equal(turns.length, 1);
  const script = turns[0]!.content;
  assert.match(script, /那当时你原话怎么讲的？/, 'the model must still see its own previous line');
  assert.match(script, /我说她上一段刚结束，缓一缓就好。/, 'and the learner’s latest words');
  assert.ok(script.indexOf('那当时你原话怎么讲的？') < script.indexOf('我说她上一段刚结束'), 'the script ends on the move being answered');
  assert.match(systemText(seen[0]!), /已用 2 \/ \d+/, 'learner turns are counted from the transcript');
});

test('a line-only reply is repaired once with the same learner turn', async () => {
  const { llm, seen } = recorder(JSON.stringify({ line: VALID.line }), JSON.stringify(VALID));
  const out = await runLovePlay(input([opening, { role: 'learner', text: '第二句是我加的。', ts: 2 }]), llm, 'fake');
  assert.equal(seen.length, 2, 'invalid contract output gets exactly one bounded repair');
  assert.deepEqual(out, VALID);
  const first = systemParts(seen[0]!.system);
  const second = systemParts(seen[1]!.system);
  assert.equal(second.length, first.length + 1, 'the repair rides on an appended system part');
  assert.deepEqual(seen[1]!.messages, seen[0]!.messages, 'repair reuses the same exchange, never a new turn');
});

test('silence events keep their place in the script without spending a learner turn', async () => {
  const { llm, seen } = recorder(JSON.stringify(VALID));
  await runLovePlay(input([opening, { role: 'learner', text: '我先说清一句。', ts: 2 }, { role: 'event', text: '', ts: 3, kind: 'silence' } as LovePlayMessage]), llm, 'fake');
  assert.match(seen[0]!.messages[0]!.content, /says nothing/);
  assert.match(systemText(seen[0]!), /已用 1 \/ \d+/);
});

test('a six-turn romance scene keeps its own maxTurns instead of the practice 12-turn floor', async () => {
  assert.equal(shortScenario.maxTurns, 6, 'the fixture must stay the six-turn hobby scene');
  const shortLearnerId = shortScenario.characters.find((c) => c.playable)!.id;
  const { llm, seen } = recorder(JSON.stringify(VALID));
  await runLovePlay(
    {
      scenario: shortScenario,
      learnerCharacterId: shortLearnerId,
      language: 'zh',
      messages: [{ role: 'npc', characterId: shortScenario.opening.characterId, text: shortScenario.opening.text.zh, ts: 1 }],
      turnLimit: shortScenario.maxTurns,
    },
    llm,
    'fake',
  );
  const system = systemText(seen[0]!);
  assert.match(system, /已用 0 \/ 6/, 'an explicit six-turn scene must not be widened to twelve');
  assert.doesNotMatch(system, /已用 \d+ \/ 12/);
});

// ---------- G17：唯一哨兵解析 ----------

const wrapped = (value: unknown) => `${LOVE_PLAY_SENTINEL_OPEN}${JSON.stringify(value)}${LOVE_PLAY_SENTINEL_CLOSE}`;

test('the output contract itself carries the sentinel so a compliant model can use it', async () => {
  const { llm, seen } = recorder(wrapped(VALID));
  await runLovePlay(input([opening, { role: 'learner', text: '第二句是我加的。', ts: 2 }]), llm, 'fake');
  assert.ok(systemText(seen[0]!).includes(LOVE_PLAY_SENTINEL_OPEN), 'the system prompt must demand the opening marker');
  assert.ok(systemText(seen[0]!).includes(LOVE_PLAY_SENTINEL_CLOSE), '…and the closing marker');
});

test('a sentinel-wrapped reply wins even when the prose around it contains stray braces', async () => {
  // 旧解析取第一个 `{`：这句前缀里的「{注意」会把解析带进沟里。哨兵截取对它免疫。
  const noisy = `模型：好的，这一回合我来。{注意：这不是 JSON}\n${wrapped(VALID)}\n以上。`;
  const { llm, seen } = recorder(noisy);
  const out = await runLovePlay(input([opening, { role: 'learner', text: '第二句是我加的。', ts: 2 }]), llm, 'fake');
  assert.deepEqual(out, VALID, 'the last complete sentinel pair is the reply — not the first brace in the prose');
  assert.equal(seen.length, 1, 'a clean sentinel reply takes no repair');
});

test('replies without sentinels keep the old lenient path, so marker-ignoring models do not regress', async () => {
  const { llm, seen } = recorder(`好的，这一回合是：\n${JSON.stringify(VALID)}`);
  const out = await runLovePlay(input([opening, { role: 'learner', text: '第二句是我加的。', ts: 2 }]), llm, 'fake');
  assert.deepEqual(out, VALID);
  assert.equal(seen.length, 1);
});

test('a verbatim echo of the contract example is invalid output and takes the bounded repair', async () => {
  // G17 的债务形态：示例七键俱全能通过旧校验，复述它会产出一条「…」假回合直达玩家。
  const echo = `${LOVE_PLAY_SENTINEL_OPEN}{"line":{"zh":"…","en":"…"},"options":[{"zh":"…","en":"…"},{"zh":"…","en":"…"}],"emotion":"neutral","stance":20,"revealed":false,"terminal":null,"ended":false}${LOVE_PLAY_SENTINEL_CLOSE}`;
  const { llm, seen } = recorder(echo, wrapped(VALID));
  const out = await runLovePlay(input([opening, { role: 'learner', text: '第二句是我加的。', ts: 2 }]), llm, 'fake');
  assert.deepEqual(out, VALID);
  assert.equal(seen.length, 2, 'placeholder-only text must never ship as a turn');
  const repair = systemParts(seen[1]!.system).at(-1)!.text;
  assert.match(repair, /LOVE-PLAY JSON contract/, 'the repair rides on the contract restatement');
  assert.ok(repair.includes(LOVE_PLAY_SENTINEL_OPEN) && repair.includes(LOVE_PLAY_SENTINEL_CLOSE), '…and re-states the sentinel');
});

test('sentinel-wrapped broken JSON is repaired once, then the bounded repair lands a valid turn', async () => {
  // 严格 JSON.parse 失败 → 截出载荷走 extractJSON 的修复启发式 → zod 不过 → 一次有界修复。
  const { llm, seen } = recorder(`${LOVE_PLAY_SENTINEL_OPEN}{"line":{"zh":"你好`, wrapped(VALID));
  const out = await runLovePlay(input([opening, { role: 'learner', text: '第二句是我加的。', ts: 2 }]), llm, 'fake');
  assert.deepEqual(out, VALID);
  assert.equal(seen.length, 2, 'attempts stay at one main call plus one repair');
});

test('two unparseable replies stop at the attempts cap with the friendly copy', async () => {
  const { llm, seen } = recorder('抱歉，这一句我说不好。', '真的说不好。');
  await assert.rejects(
    runLovePlay(input([opening, { role: 'learner', text: '第二句是我加的。', ts: 2 }]), llm, 'fake'),
    (e: unknown) => e instanceof LLMError && e.status === 502 && /场景信息不完整/.test(e.message),
    'the final rejection keeps the user-friendly retry wording',
  );
  assert.equal(seen.length, 2, 'one main call plus one bounded repair — nothing more');
});

test('the human-voice layer adds initiative, shape and style blocks before the output contract', async () => {
  const { llm, seen } = recorder(JSON.stringify(VALID));
  await runLovePlay(
    input([
      opening,
      { role: 'learner', text: '今天有点累。', ts: 2 },
      { role: 'learner', text: '不过还好吧。', ts: 3 },
      { role: 'learner', text: '你呢？', ts: 4 },
    ]),
    llm,
    'fake',
    () => 0.1,
  );
  const text = systemText(seen[0]!);
  assert.match(text, /THIS TURN'S INITIATIVE: answer/, 'a learner question forces a direct answer');
  assert.match(text, /THIS TURN'S SHAPE: /);
  assert.match(text, /LEARNER'S WRITING STYLE/, 'three learner lines are enough to profile');
  assert.ok(text.indexOf("THIS TURN'S SHAPE") < text.indexOf('LOVE-PLAY GALGAME 输出契约'), 'voice blocks sit before the output contract');
});

test('a fixed rng makes the voice blocks reproducible', async () => {
  const first = recorder(JSON.stringify(VALID));
  const second = recorder(JSON.stringify(VALID));
  const messages: LovePlayMessage[] = [opening, { role: 'learner', text: '今天有点累。', ts: 2 }];
  await runLovePlay(input(messages), first.llm, 'fake', () => 0.42);
  await runLovePlay(input(messages), second.llm, 'fake', () => 0.42);
  assert.equal(systemText(first.seen[0]!), systemText(second.seen[0]!));
});

test('markdown in the NPC line is stripped before it reaches the player', async () => {
  const dirty = { ...VALID, line: { zh: '- **那句**是你加的？', en: '- **Was that** yours?' } };
  const { llm } = recorder(JSON.stringify(dirty));
  const out = await runLovePlay(input([opening, { role: 'learner', text: '是我加的。', ts: 2 }]), llm, 'fake', () => 0.1);
  assert.equal(out.line.zh, '那句是你加的？');
  assert.equal(out.line.en, 'Was that yours?');
});

test('an over-long line is cut at the last sentence end, never mid-sentence', async () => {
  const zh = '这是一句很长的话。'.repeat(30);
  const en = 'This is a long sentence. '.repeat(30).trim();
  const { llm } = recorder(JSON.stringify({ ...VALID, line: { zh, en } }));
  const out = await runLovePlay(input([opening, { role: 'learner', text: '是我加的。', ts: 2 }]), llm, 'fake', () => 0.1);
  assert.ok([...out.line.zh].length <= 120, 'zh stays under the absolute cap');
  assert.ok(out.line.zh.endsWith('。'), 'the cut lands on a sentence end');
  assert.ok(out.line.en.split(/\s+/).length <= 80, 'en stays under the absolute cap');
  assert.ok(out.line.en.endsWith('.'), 'the en cut lands on a sentence end too');
});

test('beats are dropped when truncation breaks the line === beats.join invariant', async () => {
  const beat = { text: { zh: '这是一句很长的话。'.repeat(6), en: 'This is a long sentence. '.repeat(5).trim() }, emotion: 'neutral' as const };
  const { llm } = recorder(JSON.stringify({ ...VALID, beats: [beat, beat, beat, beat] }));
  const out = await runLovePlay(input([opening, { role: 'learner', text: '是我加的。', ts: 2 }]), llm, 'fake', () => 0.1);
  assert.equal(out.beats, undefined, 'stale beats fall back to line + emotion');
  assert.ok([...out.line.zh].length <= 120);
});

test('en beats ending in ellipses survive the per-beat normalization', async () => {
  const beats = [
    { text: { zh: '我想你…', en: 'I miss you…' }, emotion: 'neutral' as const },
    { text: { zh: '算了…', en: 'Never mind…' }, emotion: 'tight' as const },
  ];
  const { llm } = recorder(JSON.stringify({ ...VALID, line: { zh: '我想你…算了…', en: 'I miss you… Never mind…' }, beats }));
  const out = await runLovePlay(input([opening, { role: 'learner', text: '我也想你。', ts: 2 }]), llm, 'fake', () => 0.1);
  assert.ok(out.beats, 'the ellipsis across the beat boundary must not drop the beats');
  assert.equal(out.line.zh, out.beats!.map((b) => b.text.zh).join(''));
  assert.equal(out.line.en, out.beats!.map((b) => b.text.en).join(' '));
});

/** 顺序 rng：用完最后一个值后重复它。 */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('imperfection is off unless the setting sends true', async () => {
  const off = recorder(JSON.stringify(VALID));
  const out = await runLovePlay(input([opening, { role: 'learner', text: '是我加的？', ts: 2 }]), off.llm, 'fake', seq(0.1, 0, 0, 0));
  assert.deepEqual(out.line, VALID.line);
});

test('imperfection changes only the spoken line, never the choices', async () => {
  const on = recorder(JSON.stringify(VALID));
  const out = await runLovePlay(
    { ...input([opening, { role: 'learner', text: '是我加的？', ts: 2 }]), imperfection: true },
    on.llm,
    'fake',
    seq(0.1, 0, 0, 0),
  );
  assert.notEqual(out.line.zh, VALID.line.zh, 'the first character is duplicated');
  assert.equal(out.line.en, VALID.line.en, 'the other language key stays a faithful translation');
  assert.deepEqual(out.options, VALID.options, 'choices are never touched');
  assert.equal(out.beats, undefined, 'a typo drops beats so line === beats.join cannot break');
});

test('imperfection is forced off on revealed, terminal and ended turns', async () => {
  for (const locked of [{ revealed: true }, { terminal: 'success' as const }, { ended: true }]) {
    const { llm } = recorder(JSON.stringify({ ...VALID, ...locked }));
    const out = await runLovePlay(
      { ...input([opening, { role: 'learner', text: '是我加的？', ts: 2 }]), imperfection: true },
      llm,
      'fake',
      seq(0.1, 0, 0, 0),
    );
    assert.deepEqual(out.line, VALID.line, `locked turn must stay clean: ${JSON.stringify(locked)}`);
  }
});

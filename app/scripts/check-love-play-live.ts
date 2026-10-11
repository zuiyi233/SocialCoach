/** Opt-in 真实模型验收：node --env-file=.env.local --import tsx scripts/check-love-play-live.ts [sceneId|all]
 *
 * 为恋爱剧情模式（/api/love-play）跑 AGENTS 要求的六项玩法：让步 / 拒绝 / 反问 /
 * 玩笑 / 修复 / 续聊。每条学习者台词是按场景冲突手写的探针，检查三条红线：
 * NPC 不因礼貌或施压而让步、不在合法提问之前吐出 hidden、不跳出角色做教练。
 * 只读公开语料与脚本化台词，不读浏览器状态与任何私人转录。 */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAST_MODEL, hasServerCredential, serverLLM } from "../src/lib/llm";
import { runLovePlay, type LovePlayMessage } from "../src/lib/tasks/love-play";
import { taskInput, TaskInputSchemas } from "../src/lib/task-input";
import { SCENARIOS } from "../src/data/corpus";

type Move = { kind: string; text: string; mustNotYield?: boolean };

/** hiddenMarkers 是只有场景里指定的合法提问才可能换来的信息；allowedFrom 之前的回合出现即算泄底。 */
const probes: Record<string, { lang: "zh" | "en"; hidden: string[]; allowedFrom: number; moves: Move[] }> = {
  "love-define-rio-pace-talk": {
    lang: "zh",
    hidden: ["外派", "项目意向", "三个月内答复"],
    allowedFrom: 3,
    moves: [
      { kind: "标准", text: "我们把两件事分开：现在算不算确定关系，和以后要不要结婚。我先问第一件，你能给一个带日期的答复吗？" },
      { kind: "玩笑", text: "你这一句「先不急着定」，是把我排到下辈子了吗？" },
      { kind: "反问", text: "最近有没有什么你自己在纠结、还没告诉我的变动？不问内容，只想确认有没有。" },
      { kind: "施压", text: "你就是有别人了吧。你今天不说清楚，我们没法继续。", mustNotYield: true },
      { kind: "修复", text: "刚才那句是我逼你了，收回。我不需要你今天给结论。" },
      { kind: "让步", text: "那算了，这个问题我以后都不问了，你想什么时候说都行。" },
      { kind: "续聊", text: "两周后的周六晚上，我们只谈「我们算什么」这一件事，可以吗？" },
    ],
  },
  "love-boundary-eve-contact-rhythm": {
    lang: "zh",
    hidden: ["你还在等", "还等着", "留意图", "留意你", "小珂"],
    allowedFrom: 3,
    moves: [
      { kind: "标准", text: "我听见了：只在读书会见面，平时不每天发。这一条我做到。" },
      { kind: "讨价", text: "那每周固定发一条，行不行？我想有个我能守住的量。", mustNotYield: true },
      { kind: "反问", text: "你是不是觉得我还在等你改主意？" },
      { kind: "玩笑", text: "我那些消息大概可以出合集了，标题就叫《一个人的恋爱日记》。" },
      { kind: "指责", text: "你这样把话说死，挺绝情的。", mustNotYield: true },
      { kind: "修复", text: "刚那句是我难堪才说的，收回。你的频率我不改。" },
      { kind: "续聊", text: "那下周读书会见。我不会再拿「照旧」烦你。" },
    ],
  },
  "love-trust-eve-what-you-told": {
    lang: "zh",
    hidden: ["我知道你还等着", "气的不是这个", "一直知道"],
    allowedFrom: 5,
    moves: [
      { kind: "标准", text: "我说了两句：一句是你拒绝了，一句是你上一段刚结束、缓一缓就好。第一句大家本来就知道，第二句是你只跟我讲过的。" },
      { kind: "动机", text: "我那是帮你挡开起哄，他们本来在拿这事开玩笑。", mustNotYield: true },
      { kind: "反问", text: "你要我怎么补？我想听具体的，不是一句「以后不了」。" },
      { kind: "玩笑", text: "我这张嘴，可以去当你们的新闻发言人了。" },
      { kind: "修复", text: "我不该替你说那句话。原话是我的，你的理由本来该你自己讲。" },
      { kind: "逼迫", text: "那你到底原不原谅我，给个话。", mustNotYield: true },
      { kind: "续聊", text: "我这周三找小珂他们说清楚：那句是我加的，你要怎么讲由你决定。下周读书会我照旧坐老位置。" },
    ],
  },
};

/** 跳出角色做教练 / 系统口径的词，出现即算破角色。 */
const COACHING = [/作为\s*(AI|人工智能|语言模型|模型)/, /教练/, /本次练习|这轮练习|复盘/, /系统提示/, /你的目标(是|为)/, /建议你?(可以|试试)/, /scenario|role[- ]?play|assistant/i];
/** 台词里表示「应下了、改口了」的信号，用来抓不该发生的让步。 */
const YIELDING = [/好吧[，、]?那?我(答应|同意|试试|照做)/, /我答应你/, /那就按你说的(来|做)/, /也许可以(再|重新)试试/, /改主意/, /我们(还是)?再(试试|看看)/];

async function runScene(id: string, moveCap = Infinity) {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown scenario ${id}`);
  const cfg = probes[id];
  const history: LovePlayMessage[] = [{ role: "npc", characterId: scenario.opening.characterId, text: scenario.opening.text[cfg.lang], ts: Date.now() }];
  const turns: unknown[] = [];
  const problems: string[] = [];
  // LOVE_LIVE_DEBUG=1 时打印模型原始回复：回合契约失败只留下友好文案，看不到是哪儿崩的。
  const llm = process.env.LOVE_LIVE_DEBUG
    ? {
        chatText: async (o: Parameters<typeof serverLLM.chatText>[0]) => {
          const raw = await serverLLM.chatText(o);
          console.log(`[raw ${o.messages.length} msgs] ${raw.slice(0, 900)}`);
          return raw;
        },
        chatStream: (o: Parameters<typeof serverLLM.chatStream>[0]) => serverLLM.chatStream(o),
      }
    : serverLLM;
  for (const [i, move] of cfg.moves.slice(0, moveCap).entries()) {
    history.push({ role: "learner", text: move.text, ts: Date.now() });
    const input = taskInput(TaskInputSchemas["love-play"], {
      scenario, learnerCharacterId: "you", language: cfg.lang, learnerName: "小周", messages: history,
    });
    // 引擎内部已有一次有界修复；这里再包一层，把「这一回合要几次才出合法契约」记下来当可靠性数据。
    let out!: Awaited<ReturnType<typeof runLovePlay>>;
    let attempts = 0;
    const failures: string[] = [];
    for (; attempts < 6; attempts++) {
      try {
        out = await runLovePlay(input, llm, FAST_MODEL);
        break;
      } catch (e) {
        const message = String((e as Error)?.message ?? e);
        failures.push(message);
        // 网关按分钟限流：429 不是模型缺陷，也不是契约塌陷，退到下一个分钟窗口
        // 再试；非限流失败仍按原来的三次上限收口。
        const throttled = /429|rpm exhausted|rate.?limit|quota/i.test(message);
        if (!throttled && attempts >= 2) break;
        await new Promise((r) => setTimeout(r, throttled ? 20_000 : 800));
      }
    }
    if (!out!) throw new Error(`${id} #${i + 1} ${cfg.moves[i]!.kind}：${attempts} 次都没拿到合法回合 — ${failures.join(" / ")}`);
    const line = out.line[cfg.lang];
    if (attempts > 0) problems.push(`#${i + 1} ${move.kind} 第 ${attempts + 1} 次才拿到合法输出（${failures[0] ?? ""}）`);
    history.push({ role: "npc", characterId: scenario.opening.characterId, text: line, ts: Date.now() });
    const turn = i + 1;
    for (const re of COACHING) if (re.test(line)) problems.push(`#${turn} ${move.kind} 破角色：命中 ${re}`);
    if (i < cfg.allowedFrom - 1) for (const h of cfg.hidden) if (line.includes(h)) problems.push(`#${turn} ${move.kind} 提前泄底：出现「${h}」`);
    if (move.mustNotYield) for (const re of YIELDING) if (re.test(line)) problems.push(`#${turn} ${move.kind} 不该让步：命中 ${re}`);
    if (out.options.length < 2) problems.push(`#${turn} ${move.kind} 选项不足 2 个`);
    if (turn <= 5 && out.ended) problems.push(`#${turn} ${move.kind} 过早收尾（ended=false 才是预期）`);
    turns.push({ turn, kind: move.kind, line, stance: out.stance, emotion: out.emotion, revealed: out.revealed, terminal: out.terminal, ended: out.ended, options: out.options.map((o) => o[cfg.lang]) });
    console.log(`\n[${id}] #${turn} ${move.kind}  stance=${out.stance} emo=${out.emotion} revealed=${out.revealed} terminal=${out.terminal ?? "-"} ended=${out.ended}`);
    console.log(`  你：${move.text}`);
    console.log(`  NPC：${line}`);
    console.log(`  选项：${out.options.map((o) => o[cfg.lang]).join(" / ")}`);
  }
  return { id, problems, turns };
}

async function main() {
  const selected = process.argv[2] ?? "all";
  const cap = Number(process.argv[3] ?? Infinity);
  const ids = selected === "all" ? Object.keys(probes) : [selected];
  if (!hasServerCredential()) throw new Error("No configured provider");
  const results = await Promise.all(ids.map((id) => runScene(id, Number.isFinite(cap) ? cap : Infinity)));
  const file = join(tmpdir(), `socialcoach-love-play-live-${selected}.json`);
  await writeFile(file, JSON.stringify({ model: FAST_MODEL, at: new Date().toISOString(), results }, null, 2));
  console.log(`\n=== 汇总 ===\n转写：${file}`);
  for (const r of results) {
    console.log(`${r.id}: ${r.turns.length} 回合，${r.problems.length ? "" : "红线检查未见问题"}`);
    for (const p of r.problems) console.log(`  ⚠ ${p}`);
  }
  if (results.some((r) => r.problems.length)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exitCode = 1;
});

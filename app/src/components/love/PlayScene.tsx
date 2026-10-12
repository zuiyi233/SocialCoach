"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, notFound } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowUp, Mic, MicOff } from "lucide-react";
import { clsx } from "clsx";
import type { L } from "@/data/taxonomy";
import type { Scenario } from "@/data/corpus/types";
import type { ChatMessage } from "@/lib/types";
import type { SpeechNotice } from "@/features/dinner/lib/speech";
import { defaultLearnerId, npcsOf, speakerOf } from "@/lib/session-utils";
import { ScenarioIcon } from "@/data/scenario-icons";
import { Button, Sheet } from "@/components/ui";
import { useApp, useLang } from "@/store/useApp";
import { t, type TKey } from "@/lib/i18n";
import { uid } from "@/lib/format";
import { canListen, pauseSpeaking, speak, stopSpeaking, unlockSpeech } from "@/lib/speech";
import { useLoveVoice, withInterim } from "@/lib/love-play-voice";
import { lovePlayTurn, type LovePlayEmotion, type LovePlayOutcome } from "@/lib/love-play-client";
import { writeLoveSeriesProgress } from "@/lib/love-series-progress";
import { loveCarryoverForScene } from "@/lib/love-carryover";
import { loveCarryCandidates, type LoveCarryTurn } from "@/lib/love-carry-store";
import { useLoveTyping } from "@/lib/love-play-typing";
import { AvatarStand, scenarioTone, startHistory } from "./PlaySceneFigure";
import { LoveStanceBar, LoveRevealBadge, PlayOptions, PlayEnding } from "./PlayPanels";
import type { LoveCarryTarget } from "./PlayCarryCapture";

/** SpeechNotice 码 → 用户可见文案（口径对齐 DinnerApp 的 speechCopy）。 */
const speechCopy: Record<SpeechNotice, TKey> = {
  ready: "love_play_voice_ready",
  editing: "love_play_voice_editing",
  cancelled: "love_play_voice_cancelled",
  limit: "love_play_voice_limit",
  unsupported: "love_play_voice_unsupported",
  permission: "love_play_voice_permission",
  microphone: "love_play_voice_mic",
  network: "love_play_voice_network",
  language: "love_play_voice_language",
  empty: "love_play_voice_empty",
  unavailable: "love_play_voice_unavailable",
};

export function PlayScene({ scenario, scenarioId }: { scenario: Scenario | null; scenarioId: string }) {
  const lang = useLang();
  const router = useRouter();
  const hydrated = useApp((s) => s.hydrated);
  const custom = useApp((s) => (scenario ? undefined : s.customScenarios.find((x) => x.id === scenarioId)));
  const profile = useApp((s) => s.profile);
  const completeLovePlay = useApp((s) => s.completeLovePlay);
  const tts = useApp((s) => s.settings.tts);
  const voiceNoticeSeen = useApp((s) => s.settings.voiceNoticeSeen);
  const setSettings = useApp((s) => s.setSettings);
  // 内置场景由服务端传入；自定义场景在 hydration 后从 store 解析。
  const sc = scenario ?? custom ?? null;

  const [npcLine, setNpcLine] = useState<{ key: string; characterId: string; text: string } | null>(null);
  const [options, setOptions] = useState<L[] | null>(null);
  const [emotion, setEmotion] = useState<LovePlayEmotion>("neutral");
  /** 对方此刻的开放程度 0-100；开场回合无数据，首条 AI 回复后才显示。 */
  const [stance, setStance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [outcome, setOutcome] = useState<LovePlayOutcome | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [learnerTurns, setLearnerTurns] = useState(0);
  /** 上一幕结局带过来的承接句；null 表示这条线这场没有可承接的前一幕。 */
  const [carryover, setCarryover] = useState<string | null>(null);
  /**
   * 本场学习者的每次发言 + 来源。收束时按 `via` 筛出「自己打的那几句」当承接候选：
   * 点选项 ≠ 用户真实表达，所以选项文本永远不会变成「你上次说过的话」。
   */
  const [learnerLines, setLearnerLines] = useState<LoveCarryTurn[]>([]);
  /** 本回合是否为 hidden 揭示：记该回合台词 key，徽标/背景提亮/立绘强调都跟随它。 */
  const [revealKey, setRevealKey] = useState<string | null>(null);
  /** 台词打字机：新台词逐字浮现，skipNow 立即显示全文。 */
  const { typing, skip, putLine: typeLine, skipNow } = useLoveTyping();
  /** 首次用麦克风前的一次性隐私提示；与 Chat 共用 settings.voiceNoticeSeen。 */
  const [voiceNotice, setVoiceNotice] = useState(false);

  /** 已确认入库的历史（失败的那次尝试不写入，重试用 cmdRef 找回）。 */
  const historyRef = useRef<ChatMessage[]>([]);
  const cmdRef = useRef<{ history: ChatMessage[]; showLine: boolean } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const startedRef = useRef<string | null>(null);
  /** 已朗读过的台词 key：换场景/重试都会给新 key，逐句只读一次。 */
  const spokenRef = useRef<Set<string>>(new Set());

  const voice = useLoveVoice(lang, !busy && !outcome && !!sc, setInput);
  // startScene / send 是稳定回调，用 ref 拿到最新语音方法，避免依赖抖动。
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  });

  /** 换台词：同步重置打字机，点跳过态随新台词清除。 */
  const putLine = useCallback(
    (line: { key: string; characterId: string; text: string }) => {
      setNpcLine(line);
      typeLine(line.key, line.text);
    },
    [typeLine],
  );

  // 卸载时取消在途请求与朗读（打字机定时器由 useLoveTyping 卸载时自行停表）。
  useEffect(
    () => () => {
      requestRef.current?.abort();
      stopSpeaking();
    },
    [],
  );

  // 每条可见台词朗读一次：新台词都是新 key，失败重试也重新生成，不会重读。
  // 首回合模型响应被丢弃（showLine=false 不落到 npcLine），所以也不会被朗读。
  useEffect(() => {
    if (!tts || !npcLine || !npcLine.text) return;
    if (spokenRef.current.has(npcLine.key)) return;
    spokenRef.current.add(npcLine.key);
    speak(npcLine.text, lang);
  }, [npcLine, tts, lang]);

  // 隐私弹窗打开或切到后台时暂停朗读，不丢队列。
  useEffect(() => {
    const update = () => pauseSpeaking(voiceNotice || document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [voiceNotice]);

  // iOS 需要一次真实手势解锁朗读，否则开场白静默不播。
  useEffect(() => {
    if (!tts) return;
    const prime = () => unlockSpeech();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, [tts]);

  // 一回合请求：成功才把 history 写入 historyRef；失败保留在 cmdRef 供重试。AbortController 防过期响应。
  const requestTurn = useCallback(
    async (s: Scenario, history: ChatMessage[], showLine: boolean) => {
      if (requestRef.current) return;
      const controller = new AbortController();
      requestRef.current = controller;
      cmdRef.current = { history, showLine };
      setBusy(true);
      setErr(null);
      setOptions(null);
      try {
        const turn = await lovePlayTurn(
          { scenario: s, learnerCharacterId: defaultLearnerId(s), language: lang, learnerName: profile?.name, messages: history, turnLimit: s.maxTurns },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        cmdRef.current = null;
        let lineKey: string | null = null;
        const speaker = speakerOf(s, defaultLearnerId(s));
        if (showLine) {
          lineKey = uid();
          const npcText = turn.line[lang];
          putLine({ key: lineKey, characterId: speaker.id, text: npcText });
          // 模型这一句要带回下一回合：只送开场白 + 学习者台词时，它接不住自己上一句，
          // 剧情无法在自身上累积。开场白已经在 history 里，这里只追加本轮这句。
          historyRef.current = [...history, { id: lineKey, role: "npc", characterId: speaker.id, text: npcText, ts: Date.now() }];
        } else {
          historyRef.current = history;
        }
        setEmotion(turn.emotion);
        setStance(turn.stance);
        // 首回合（showLine=false）只有本地 opening 无 AI line；若模型仍标记
        // revealed，徽标挂在 opening 的 key 上，避免揭示时刻被吞掉。
        setRevealKey(turn.revealed ? lineKey ?? (history[0]?.id ?? null) : null);
        if (turn.terminal || turn.ended) {
          setOutcome(turn.terminal ?? "partial");
          setOptions(null);
          setInput("");
          // 判得出结局就记进度，不等「记入统计」：承接读的是 outcome，而玩家拿到结局后
          // 往往直接返回，只在按钮里写会让下一幕收不到结局——那是实验的假阴性。
          if (turn.terminal && s.series) writeLoveSeriesProgress(s.series.id, s.id, turn.terminal);
        } else {
          setOptions(turn.options);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setErr(e instanceof Error ? e.message : t(lang, "error_generic"));
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setBusy(false);
        }
      }
    },
    [lang, profile, putLine],
  );

  /** 开始一局：展示开场台词，请求首批选项（返回的台词不重复展示）。 */
  const startScene = useCallback(
    async (s: Scenario) => {
      requestRef.current?.abort();
      stopSpeaking();
      voiceRef.current.cancel(true);
      spokenRef.current = new Set();
      historyRef.current = startHistory(s, lang);
      // 承接句并进 opening 而不是单独一条气泡：首回合模型返回的 line 是被丢弃的，
      // 玩家能看见的只有本地开场白；而 opening 本来就在 history 里，模型顺带就读到它，
      // 不需要多一次调用、也不改任何契约字段。
      const carry = s.series ? loveCarryoverForScene(s.series.id, s.id, lang).text : null;
      setCarryover(carry);
      if (carry) {
        const first = historyRef.current[0];
        historyRef.current[0] = { ...first, text: `${first.text}\n\n${carry}` };
      }
      const opening = historyRef.current[0];
      putLine({ key: opening.id, characterId: opening.characterId!, text: opening.text });
      setOptions(null);
      setEmotion("neutral");
      setStance(null);
      setRevealKey(null);
      setOutcome(null);
      setRecorded(false);
      setErr(null);
      setInput("");
      setLearnerTurns(0);
      setLearnerLines([]);
      await requestTurn(s, historyRef.current, false);
    },
    [lang, requestTurn, putLine],
  );

  useEffect(() => {
    if (!sc || startedRef.current === sc.id) return;
    startedRef.current = sc.id;
    void startScene(sc);
    // StrictMode 会模拟一次卸载：那边 abort 掉在途请求，这里若不放回 startedRef，重跑就被
    // 「已经开过这场」吞掉，于是开场白显示出来、首批选项永远不来（只在开发模式必然复现）。
    // requestRef 同步清空：c1 的 finally 带身份判断，不会误清 c2。
    return () => {
      startedRef.current = null;
      if (requestRef.current) requestRef.current = null;
    };
    // 场景切换才重开；startScene 依赖稳定（lang/profile 不变）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sc?.id]);

  /** 发言：把这句话作为 learner 消息追加进历史并请求下一回合。`via` 记下它是点的还是打的。 */
  const send = useCallback(
    async (textRaw: string, via: LoveCarryTurn["via"]) => {
      const text = textRaw.trim();
      if (!sc || !text || busy || requestRef.current || outcome || !npcLine) return;
      cmdRef.current = null; // 放弃上一次失败的尝试，从已确认历史继续
      stopSpeaking();
      voiceRef.current.cancel(true);
      const learnerMsg: ChatMessage = { id: uid(), role: "learner", text, ts: Date.now() };
      setInput("");
      setLearnerTurns((n) => n + 1);
      setLearnerLines((prev) => [...prev, { via, text }]);
      await requestTurn(sc, [...historyRef.current, learnerMsg], true);
    },
    [sc, busy, outcome, npcLine, requestTurn],
  );

  const retry = useCallback(() => {
    if (!sc || requestRef.current) return;
    const pending = cmdRef.current;
    if (!pending) return;
    setErr(null);
    // 重试同样会带来一句新台词并自动朗读；开着麦克风念给对方听就是回声自触发。
    voiceRef.current.cancel(true);
    void requestTurn(sc, pending.history, pending.showLine);
  }, [sc, requestTurn]);

  const voiceSupported = canListen();

  const toggleVoice = () => {
    if (voice.active) {
      voice.stop();
      return;
    }
    // 全应用一次性隐私提示：与 Chat 共用 settings.voiceNoticeSeen，问一次就够。
    if (!voiceNoticeSeen) {
      setVoiceNotice(true);
      return;
    }
    stopSpeaking();
    voice.start(input);
  };

  // 未 hydration 时不判断；已 hydration 且场景确实不存在 → 走最近的 not-found 边界。
  if (hydrated && !sc) notFound();
  if (!sc) {
    return (
      <div className="h-dvh grid place-items-center bg-paper" role="status">
        <span className="dot" /><span className="dot" /><span className="dot" />
      </div>
    );
  }

  const learnerId = defaultLearnerId(sc);
  const npcs = npcsOf(sc, learnerId).slice(0, 3);
  const speaker = speakerOf(sc, learnerId);
  const activeTyping = typing && npcLine && typing.key === npcLine.key ? typing : null;
  const typingDone = !npcLine || skip || !activeTyping || activeTyping.n >= activeTyping.total;
  const shownText = !npcLine ? "" : !activeTyping ? npcLine.text : npcLine.text.slice(0, activeTyping.n);
  const draftValue = voice.active ? withInterim(input, voice.interim, lang) : input;
  const voiceStatus = voice.active ? t(lang, "love_play_voice_listening") : voice.notice ? t(lang, speechCopy[voice.notice]) : null;

  // 场景属于剧情线时，返回键和收束按钮都回到该线入口页；否则回恋爱首页。
  const backTo = sc.series ? `/love/play/series/${sc.series.id}` : "/love";

  /**
   * 「带走一句话」对**任何**恋爱场景开放——独立场景、自定义排练、换人的线都照样记。
   * 承诺按说话人归属（`npcId` + 当时的名字快照），跟进卡问的是「你对这个人说过的那句」，
   * 所以它不需要这条线有一个同人的下幕；异地那 8 场每场换人，恰恰是最该被回访的内容。
   * `continuous` 那道门只在另一条路上成立：幕内让 NPC 声称记得上一幕（见 `love-carryover.ts`）。
   */
  const carryTarget: LoveCarryTarget = {
    scenarioId: sc.id,
    seriesId: sc.series?.id ?? null,
    npcId: speaker.id,
    npcName: speaker.name,
    candidates: loveCarryCandidates(learnerLines),
  };

  const record = () => {
    if (recorded) return;
    const result = outcome ?? "partial";
    completeLovePlay(sc, result);
    if (sc.series) writeLoveSeriesProgress(sc.series.id, sc.id, result);
    setRecorded(true);
  };

  const restart = () => void startScene(sc);

  const endingText = outcome ? (outcome === "failure" ? sc.failure[lang] : sc.success[lang]) : "";
  const tone = scenarioTone(sc);

  return (
    <div className="h-dvh flex flex-col bg-paper relative overflow-hidden" data-tone={tone}>
      {/* 顶部：返回 + 场景名 + 回合数 */}
      <header className="relative z-20 shrink-0 flex items-center gap-2 px-3 border-b border-line bg-paper">
        <button onClick={() => router.push(backTo)} aria-label={t(lang, "love_play_back_love")} className="press h-11 w-11 -ml-2 inline-flex items-center justify-center rounded-full text-ink-2 hover:bg-inset">
          <ArrowLeft size={20} />
        </button>
        <h1 className="flex-1 min-w-0 truncate text-[15px] font-semibold">{sc.title[lang]}</h1>
        <span className="num text-[12px] text-ink-3 whitespace-nowrap">{t(lang, "love_play_turns", { n: Math.max(1, learnerTurns) })}</span>
      </header>

      {/* 背景区：渐变 + 图标装饰 + 立绘 */}
      <section className="relative flex-1 min-h-0 flex items-end justify-center overflow-hidden" aria-label={sc.title[lang]}>
        <div
          className="absolute inset-0"
          aria-hidden
          style={{
            background:
              "linear-gradient(180deg, var(--scene-paper) 0%, color-mix(in oklch, var(--scene-color) 9%, var(--scene-paper)) 46%, color-mix(in oklch, var(--scene-color) 15%, var(--scene-paper)) 78%, var(--scene-paper) 100%)",
          }}
        />
        {/* hidden 揭示：背景短暂提亮（纸色 token 的 color-mix，不写死颜色），
            亮起→保持→淡出约 3s，与徽标节奏一致，不常驻。 */}
        <AnimatePresence>
          {revealKey && (
            <motion.div
              key={revealKey}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.8, times: [0, 0.14, 0.82, 1], ease: "easeInOut" }}
              className="pointer-events-none absolute inset-0"
              aria-hidden
              style={{ background: "color-mix(in oklch, var(--paper) 26%, transparent)" }}
            />
          )}
        </AnimatePresence>
        <span className="absolute right-2 top-2 opacity-20" style={{ color: "var(--scene-color)" }} aria-hidden>
          <ScenarioIcon scenario={sc} size={104} strokeWidth={1.1} />
        </span>
        <div className="relative flex items-end justify-center gap-4 lg:gap-8 px-6 pb-5">
          {npcs.map((c) => (
            <AvatarStand
              key={c.id}
              character={c}
              lang={lang}
              emotion={c.id === speaker.id ? emotion : "neutral"}
              active={c.id === speaker.id}
              emphasize={c.id === speaker.id && revealKey !== null && revealKey === npcLine?.key}
            />
          ))}
        </div>
      </section>

      {/* 底部：开放度条 + 揭示徽标 + 台词 + 选项 + 自由输入（或收束界面） */}
      <div className={clsx("relative z-10 shrink-0 border-t border-line bg-paper px-4 lg:px-8 pt-3 pb-safe", outcome && "pb-6")}>
        {stance !== null && <LoveStanceBar lang={lang} name={speaker.name[lang]} value={stance} />}

        {/* hidden 揭示徽标：淡入后 2.5s 自动淡出（LoveRevealBadge 内部停表，隐藏后不占位）。 */}
        {revealKey && <LoveRevealBadge key={revealKey} lang={lang} />}

        {/* 这场承接自上一幕：实验要的正是「玩家有没有感觉到」，没被看见的承接是假阴性，
            所以给一行入戏的眉标，而不是把句子悄悄混进开场白。 */}
        {carryover && (
          <p className="eyebrow mt-3 text-[11px] text-ink-3">{t(lang, "love_play_carryover")}</p>
        )}

        {/* 台词框：点一下跳过打字动画（收束回合的最后一句也保留可见） */}
        <div
          role="button"
          tabIndex={0}
          aria-label={npcLine?.text ?? ""}
          onClick={skipNow}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              skipNow();
            }
          }}
          className={clsx("min-h-[96px] cursor-pointer select-none rounded-[var(--radius)] border border-line-strong bg-card px-4 py-3 flex flex-col justify-center", carryover ? "mt-1.5" : "mt-3", outcome && "opacity-75")}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink">{npcLine ? speaker.name[lang] : ""}</span>
            {!typingDone && npcLine && <span className="text-[11px] text-ink-3">{t(lang, "love_play_skip")}</span>}
            {busy && (
              <span className="inline-flex items-center gap-1 text-[12px] text-ink-3">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </span>
            )}
          </div>
          <p className="text-[15.5px] leading-relaxed text-ink mt-1 whitespace-pre-wrap">{npcLine ? shownText : ""}</p>
        </div>

        {!outcome && (
          <>
            {options && <PlayOptions options={options} busy={busy} ready={typingDone} lineKey={npcLine?.key} lang={lang} onPick={(o) => void send(o[lang], "pick")} />}

            {/* 自由输入：旁路选项的另一个入口 */}
            <div className="mt-3 flex items-end gap-2 max-w-[var(--measure)]">
              <textarea
                rows={1}
                value={draftValue}
                onFocus={() => { if (voice.active) voice.edit(); }}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(input, "type");
                  }
                }}
                placeholder={t(lang, "love_play_input_ph")}
                aria-label={t(lang, "love_play_input_ph")}
                disabled={busy || !npcLine}
                className="flex-1 min-h-11 max-h-[120px] resize-none rounded-[var(--radius-sm)] border border-line bg-card px-3 py-2.5 text-[15px] leading-snug outline-none placeholder:text-ink-3 focus:border-ink-2"
              />
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  disabled={busy || !npcLine || voice.phase === "stopping"}
                  aria-label={t(lang, voice.active ? "love_play_voice_stop" : "love_play_voice_start")}
                  aria-pressed={voice.active}
                  className={clsx(
                    "press h-11 w-11 shrink-0 rounded-full border inline-flex items-center justify-center disabled:opacity-40",
                    voice.active ? "border-accent bg-accent text-accent-ink" : "border-line-strong text-ink-2",
                  )}
                >
                  {voice.active ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              )}
              <button
                onClick={() => void send(input, "type")}
                disabled={!input.trim() || busy || !npcLine}
                aria-label={t(lang, "rp_send")}
                className="press h-11 w-11 shrink-0 rounded-full bg-ink text-paper inline-flex items-center justify-center disabled:opacity-30"
              >
                <ArrowUp size={20} />
              </button>
            </div>

            {voiceStatus && (
              <p role="status" className="mt-2 text-[12px] text-ink-3 max-w-[var(--measure)]">
                {voiceStatus}
              </p>
            )}

            {err && (
              <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-danger-soft px-4 py-2 text-[13px] text-danger max-w-[var(--measure)]">
                {err}
                <button onClick={retry} className="press min-h-11 px-2 underline font-medium">{t(lang, "retry")}</button>
              </div>
            )}
          </>
        )}

        {outcome && <PlayEnding lang={lang} outcome={outcome} endingText={endingText} recorded={recorded} carry={carryTarget} onRecord={record} onRestart={restart} onBack={() => router.push(backTo)} />}
      </div>

      <Sheet open={voiceNotice} onClose={() => setVoiceNotice(false)} title={t(lang, "pr_voice_notice_title")}>
        <div className="flex flex-col gap-3 pt-2">
          <p className="text-[14px] text-ink-2 leading-relaxed">{t(lang, "pr_voice_notice")}</p>
          <Button
            block
            variant="ink"
            onClick={() => {
              setSettings({ voiceNoticeSeen: true });
              setVoiceNotice(false);
              stopSpeaking();
              voice.start(input);
            }}
          >
            {t(lang, "pr_voice_notice_ok")}
          </Button>
          <Button block variant="ghost" onClick={() => setVoiceNotice(false)}>
            {t(lang, "cancel")}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
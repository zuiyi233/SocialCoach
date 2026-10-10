"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, notFound } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowUp } from "lucide-react";
import { clsx } from "clsx";
import type { L } from "@/data/taxonomy";
import type { Scenario } from "@/data/corpus/types";
import type { ChatMessage } from "@/lib/types";
import { defaultLearnerId, npcsOf } from "@/lib/session-utils";
import { ScenarioIcon } from "@/data/scenario-icons";
import { useApp, useLang } from "@/store/useApp";
import { t } from "@/lib/i18n";
import { uid } from "@/lib/format";
import { lovePlayTurn, type LovePlayEmotion, type LovePlayOutcome } from "@/lib/love-play-client";
import { writeLoveSeriesProgress } from "@/lib/love-series-progress";
import { useLoveTyping } from "@/lib/love-play-typing";
import { AvatarStand, scenarioTone, speakerOf, startHistory } from "./PlaySceneFigure";
import { LoveStanceBar, LoveRevealBadge, PlayOptions, PlayEnding } from "./PlayPanels";

export function PlayScene({ scenario, scenarioId }: { scenario: Scenario | null; scenarioId: string }) {
  const lang = useLang();
  const router = useRouter();
  const hydrated = useApp((s) => s.hydrated);
  const custom = useApp((s) => (scenario ? undefined : s.customScenarios.find((x) => x.id === scenarioId)));
  const profile = useApp((s) => s.profile);
  const completeLovePlay = useApp((s) => s.completeLovePlay);
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
  /** 本回合是否为 hidden 揭示：记该回合台词 key，徽标/背景提亮/立绘强调都跟随它。 */
  const [revealKey, setRevealKey] = useState<string | null>(null);
  /** 台词打字机：新台词逐字浮现，skipNow 立即显示全文。 */
  const { typing, skip, putLine: typeLine, skipNow } = useLoveTyping();

  /** 已确认入库的历史（失败的那次尝试不写入，重试用 cmdRef 找回）。 */
  const historyRef = useRef<ChatMessage[]>([]);
  const cmdRef = useRef<{ history: ChatMessage[]; showLine: boolean } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const startedRef = useRef<string | null>(null);

  /** 换台词：同步重置打字机，点跳过态随新台词清除。 */
  const putLine = useCallback(
    (line: { key: string; characterId: string; text: string }) => {
      setNpcLine(line);
      typeLine(line.key, line.text);
    },
    [typeLine],
  );

  // 卸载时取消在途请求（打字机定时器由 useLoveTyping 卸载时自行停表）。
  useEffect(() => () => requestRef.current?.abort(), []);

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
      historyRef.current = startHistory(s, lang);
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
      await requestTurn(s, historyRef.current, false);
    },
    [lang, requestTurn, putLine],
  );

  useEffect(() => {
    if (!sc || startedRef.current === sc.id) return;
    startedRef.current = sc.id;
    void startScene(sc);
    // 场景切换才重开；startScene 依赖稳定（lang/profile 不变）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sc?.id]);

  /** 选项即发言：把选项文本作为 learner 消息追加进历史并请求下一回合。 */
  const send = useCallback(
    async (textRaw: string) => {
      const text = textRaw.trim();
      if (!sc || !text || busy || requestRef.current || outcome || !npcLine) return;
      cmdRef.current = null; // 放弃上一次失败的尝试，从已确认历史继续
      const learnerMsg: ChatMessage = { id: uid(), role: "learner", text, ts: Date.now() };
      setInput("");
      setLearnerTurns((n) => n + 1);
      await requestTurn(sc, [...historyRef.current, learnerMsg], true);
    },
    [sc, busy, outcome, npcLine, requestTurn],
  );

  const retry = useCallback(() => {
    if (!sc || requestRef.current) return;
    const pending = cmdRef.current;
    if (!pending) return;
    setErr(null);
    void requestTurn(sc, pending.history, pending.showLine);
  }, [sc, requestTurn]);

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

  // 场景属于剧情线时，返回键和收束按钮都回到该线入口页；否则回恋爱首页。
  const backTo = sc.series ? `/love/play/series/${sc.series.id}` : "/love";

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
          className={clsx("mt-3 min-h-[96px] cursor-pointer select-none rounded-[var(--radius)] border border-line-strong bg-card px-4 py-3 flex flex-col justify-center", outcome && "opacity-75")}
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
            {options && <PlayOptions options={options} busy={busy} ready={typingDone} lineKey={npcLine?.key} lang={lang} onPick={(o) => void send(o[lang])} />}

            {/* 自由输入：旁路选项的另一个入口 */}
            <div className="mt-3 flex items-end gap-2 max-w-[var(--measure)]">
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={t(lang, "love_play_input_ph")}
                aria-label={t(lang, "love_play_input_ph")}
                disabled={busy || !npcLine}
                className="flex-1 min-h-11 max-h-[120px] resize-none rounded-[var(--radius-sm)] border border-line bg-card px-3 py-2.5 text-[15px] leading-snug outline-none placeholder:text-ink-3 focus:border-ink-2"
              />
              <button
                onClick={() => void send(input)}
                disabled={!input.trim() || busy || !npcLine}
                aria-label={t(lang, "rp_send")}
                className="press h-11 w-11 shrink-0 rounded-full bg-ink text-paper inline-flex items-center justify-center disabled:opacity-30"
              >
                <ArrowUp size={20} />
              </button>
            </div>

            {err && (
              <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-danger-soft px-4 py-2 text-[13px] text-danger max-w-[var(--measure)]">
                {err}
                <button onClick={retry} className="press min-h-11 px-2 underline font-medium">{t(lang, "retry")}</button>
              </div>
            )}
          </>
        )}

        {outcome && <PlayEnding lang={lang} outcome={outcome} endingText={endingText} recorded={recorded} onRecord={record} onRestart={restart} onBack={() => router.push(backTo)} />}
      </div>
    </div>
  );
}
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, notFound } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowUp, Bookmark, History, Mic, MicOff, Settings2 } from "lucide-react";
import { clsx } from "clsx";
import type { L } from "@/data/taxonomy";
import type { Scenario } from "@/data/corpus/types";
import type { ChatMessage } from "@/lib/types";
import type { SpeechNotice } from "@/features/dinner/lib/speech";
import { defaultLearnerId, npcsOf, speakerOf } from "@/lib/session-utils";
import { ScenarioIcon } from "@/data/scenario-icons";
import { Button, Chip, Sheet, Switch } from "@/components/ui";
import { useApp, useLang } from "@/store/useApp";
import { t, type TKey } from "@/lib/i18n";
import { uid } from "@/lib/format";
import { canListen, pauseSpeaking, speak, stopSpeaking, unlockSpeech } from "@/lib/speech";
import { useLoveVoice, withInterim } from "@/lib/love-play-voice";
import { lovePlayTurn, type LovePlayEmotion, type LovePlayOutcome } from "@/lib/love-play-client";
import { readLoveSeriesProgress, writeLoveSeriesProgress } from "@/lib/love-series-progress";
import { loveSeriesById } from "@/data/corpus/love-series";
import { markLoveCarryoverShown, peekLoveCarryoverForScene } from "@/lib/love-carryover";
import { subscribeLoveSlots } from "@/lib/love-slot-events";
import { loveCarryCandidates, type LoveCarryTurn } from "@/lib/love-carry-store";
import {
  clearLoveStorySlot,
  deleteLovePlayScene,
  deleteLovePlaySlot,
  readLovePlayRoute,
  readLovePlaySave,
  readLovePlaySlots,
  readLoveStoryStore,
  saveLovePlayScene,
  saveLovePlaySlot,
  writeLovePlayRoute,
  LOVE_STORY_KEY,
  type LovePlaySave,
  type LovePlaySlot,
} from "@/lib/love-story";
import {
  buildLovePlaySave,
  canSubmitLovePlayRecord,
  lovePlaySaveSignature,
  nextRioBeatGroup,
  planLovePlayRestore,
  planRioRouteEntry,
  restoreLovePlayView,
  rioBeatForOption,
  rioRouteSnapshot,
  seriesOutcomeFor,
  type LovePlayResumeState,
  type RioRouteSnapshot,
} from "@/lib/love-play-save-view";
import { RIO_SERIES_ID, resolveRioEnding, type RioAct, type RioRelationshipState } from "@/lib/love-relationship-state";
import { applyRioBeat, resolveRioOpening, rioRouteSceneAct, type RioBeat, type RioBeatGroup } from "@/lib/rio-route";
import { resolveLoveVoice } from "@/lib/love-voices";
import { useLoveTyping } from "@/lib/love-play-typing";
import { loveContentKey, markLoveTextSeen, readLoveReadState } from "@/lib/love-read";
import {
  DEFAULT_LOVE_READER,
  readLoveReaderSettings,
  writeLoveReaderSettings,
  type LoveReaderSettings,
} from "@/lib/love-reader-settings";
import { AvatarStand, scenarioTone, startHistory } from "./PlaySceneFigure";
import { LoveStanceBar, LoveRevealBadge, PlayOptions, PlayEnding } from "./PlayPanels";
import { LoveRecap } from "./LoveRecap";
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

/** 自动存档的非阻塞提示；resumed 单独显示，因为它是正常路径。 */
type SaveNotice =
  | "conflict"
  | "quota"
  | "invalid"
  | "unavailable"
  | "corrupt"
  | "incompatible"
  | "deleted"
  | "restart_failed";

const SAVE_NOTICE_KEY: Record<SaveNotice, TKey> = {
  conflict: "love_play_save_conflict",
  quota: "love_play_save_quota",
  invalid: "love_play_save_invalid",
  unavailable: "love_play_save_unavailable",
  corrupt: "love_play_save_corrupt",
  incompatible: "love_play_save_incompatible",
  deleted: "love_play_save_deleted",
  restart_failed: "love_play_save_restart_failed",
};

type PendingTurn = { history: ChatMessage[]; showLine: boolean; pending?: LoveCarryTurn };
type EndingKind = "terminal" | "ended";
const SLOT_IDS: readonly LovePlaySlot[] = ["1", "2", "3"];

/** 幕号（1 起），供 series v2 的 `lastAct`；缺省由线内顺序推出。 */
function actNumberOf(scenario: Scenario): number | undefined {
  if (!scenario.series) return undefined;
  if (scenario.series.order && scenario.series.order >= 1) return scenario.series.order;
  const series = loveSeriesById(scenario.series.id);
  const index = series?.scenarios.findIndex((s) => s.id === scenario.id) ?? -1;
  return index >= 0 ? index + 1 : undefined;
}

/**
 * 只有 Rio 第 4–6 幕接路线契约：作者写死的开场变体与每幕两组状态拍点。
 * 第 1–3 幕与其他恋爱场景完全走原路径（模型选项 + 静态开场）。
 */
function rioRouteActOf(scenario: Scenario | null | undefined): RioAct | null {
  return scenario && scenario.series?.id === RIO_SERIES_ID ? rioRouteSceneAct(scenario.id) : null;
}

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
  /** terminal = 本幕目标有了结果；ended = 没有目标判定，自然收尾。两者文案不同。 */
  const [endingKind, setEndingKind] = useState<EndingKind | null>(null);
  /** 第 6 幕的命名结局；当前场景为 null。 */
  const [endingId, setEndingId] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState(false);
  const [learnerTurns, setLearnerTurns] = useState(0);
  /** 开场是否拼过承接句；恢复时只读 save 的布尔值，不再重算。 */
  const [carryoverMark, setCarryoverMark] = useState(false);
  /**
   * 本场学习者的每次发言 + 来源。收束时按 `via` 筛出「自己打的那几句」当承接候选：
   * 点选项 ≠ 用户真实表达，所以选项文本永远不会变成「你上次说过的话」。
   */
  const [learnerLines, setLearnerLines] = useState<LoveCarryTurn[]>([]);
  /** 本回合是否为 hidden 揭示：记该回合台词 key，徽标/背景提亮/立绘强调都跟随它。 */
  const [revealKey, setRevealKey] = useState<string | null>(null);
  /** 阅读偏好与已读：设备端独立 slot，不写主档。 */
  const [reader, setReader] = useState<LoveReaderSettings>(DEFAULT_LOVE_READER);
  const [readerOpen, setReaderOpen] = useState(false);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [slots, setSlots] = useState<Partial<Record<LovePlaySlot, LovePlaySave>>>({});
  const [slotNotice, setSlotNotice] = useState<{ key: TKey; vars?: Record<string, string | number> } | null>(null);
  /** 读取手动槽前先确认：会替换当前这一局。 */
  const [slotPending, setSlotPending] = useState<LovePlaySlot | null>(null);
  const [lineWasSeen, setLineWasSeen] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  /** 最新阅读偏好给 putLine 用，避免为它重建开局回调。 */
  const readerRef = useRef(reader);
  /** 台词打字机：新台词逐字浮现，skipNow 立即显示全文。 */
  const { typing, skip, putLine: typeLine, skipNow } = useLoveTyping(reader.speed);
  /** 首次用麦克风前的一次性隐私提示；与 Chat 共用 settings.voiceNoticeSeen。 */
  const [voiceNotice, setVoiceNotice] = useState(false);
  /** 自动存档的状态提示：不阻塞剧情，只在台词框上方占一行。 */
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  /** 坏档恢复：不自动开新局，只有用户明确选择后才清空并开始（spec §3.3）。 */
  const [recovery, setRecovery] = useState<{ raw: string; reason: "corrupt" | "incompatible" } | null>(null);
  const [resumed, setResumed] = useState(false);
  const [canRecap, setCanRecap] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const [recapSave, setRecapSave] = useState<LovePlaySave | null>(null);
  /** 当前该显示的作者拍点组；null = 本回合用模型选项。 */
  const [beatGroup, setBeatGroup] = useState<RioBeatGroup | null>(null);
  /** 拍点落地后递增，把自动存档从 ref 变更里叫醒（ref 本身不触发渲染）。 */
  const [routeTick, setRouteTick] = useState(0);

  /** 已确认入库的历史（失败的那次尝试不写入，重试用 cmdRef 找回）。 */
  const historyRef = useRef<ChatMessage[]>([]);
  const cmdRef = useRef<PendingTurn | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const startedRef = useRef<string | null>(null);
  /** 已朗读过的台词 key：换场景/重试都会给新 key，逐句只读一次。 */
  const spokenRef = useRef<Set<string>>(new Set());
  /** 每次开局递增：旧 generation 的响应/abort 不得再写 state 或历史。 */
  const generationRef = useRef(0);
  /** 开局时间只在 startScene / 恢复时写入，渲染期不取时钟（保持组件纯）。 */
  const startedAtRef = useRef(0);
  const endedAtRef = useRef<number | null>(null);
  const recordedRef = useRef(false);
  const recordingRef = useRef(false);
  /** story slot 的 revision；null = 本局不自动存档。 */
  const revisionRef = useRef<number | null>(null);
  const autosaveRef = useRef(true);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const currentSaveRef = useRef<LovePlaySave | null>(null);
  /** 自动存档里的 `routeState`：第 4 幕是 `{rio, appliedBeats}` 包装，其余场景原样透传。 */
  const routeStateRef = useRef<unknown>(undefined);
  /** 第 4 幕的账本 + 已应用的作者拍点；stance 只在 React state 里，永不进这里。 */
  const rioRouteRef = useRef<RioRouteSnapshot | null>(null);
  /** 已提交到 story routes 的内容签名：同一幕重复提交是幂等的，不重复写 revision。 */
  const routeCommitRef = useRef<string | null>(null);
  /** 开场承接句的 carryId：台词真正显示后只 mark 一次。 */
  const carryIdRef = useRef<string | null>(null);
  const carryMarkedRef = useRef(false);

  const voice = useLoveVoice(lang, !busy && !outcome && !!sc, setInput);
  // startScene / send 是稳定回调，用 ref 拿到最新语音方法，避免依赖抖动。
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  });

  /** 换台词：同步重置打字机；已读/自动/减少动态直接出全文。 */
  const putLine = useCallback(
    (line: { key: string; characterId: string; text: string }) => {
      setNpcLine(line);
      const seen = sc ? seenRef.current.has(loveContentKey(sc.id, line.text)) : false;
      setLineWasSeen(seen);
      const r = readerRef.current;
      typeLine(line.key, line.text, r.reduceMotion || r.auto || (r.skipRead && seen));
    },
    [typeLine, sc],
  );

  // 阅读偏好与已读索引都是设备端独立 slot：挂载时只读一次，之后按需写。
  // 首帧必须与服务端默认值一致，所以在 effect 里读 localStorage（lazy init 会造成 hydration 不一致）。
  useEffect(() => {
    const loaded = readLoveReaderSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReader(loaded);
    readerRef.current = loaded;
    seenRef.current = readLoveReadState().seen;
  }, []);

  // 卸载时取消在途请求与朗读（打字机定时器由 useLoveTyping 卸载时自行停表）。
  useEffect(
    () => () => {
      requestRef.current?.abort();
      requestRef.current = null;
      stopSpeaking();
    },
    [],
  );

  // 每条可见台词朗读一次：新台词都是新 key，失败重试也重新生成，不会重读。
  // 首回合模型响应被丢弃（showLine=false 不落到 npcLine），所以也不会被朗读。
  // 声线按「场景 + 说话人」解析，同一个 tess 在两条线里是两个声音。
  useEffect(() => {
    if (!tts || !npcLine || !npcLine.text || !sc) return;
    if (spokenRef.current.has(npcLine.key)) return;
    spokenRef.current.add(npcLine.key);
    speak(npcLine.text, lang, resolveLoveVoice(sc.id, npcLine.characterId));
  }, [npcLine, tts, lang, sc]);

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

  // 恢复后「已回到上次停下的地方」只出现一次；不占交互。
  useEffect(() => {
    if (!resumed) return;
    const timer = window.setTimeout(() => setResumed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [resumed]);

  /**
   * 把一份已构造好、已通过稳定边界判定的存档写进 story slot。
   * 自动存档与「点作者拍点后立即落盘」共用同一条 revision / 提示分支。
   */
  const persistSave = useCallback((save: LovePlaySave): boolean => {
    // 停写标记是单向的：坏档、冲突、另一标签页清空后，任何入口（自动存档 / 拍点落盘）
    // 都不得再写，否则 routes 或新 save 会把刚被清掉的 slot 重建回来。
    if (!autosaveRef.current) return false;
    currentSaveRef.current = save;
    setCanRecap(true);
    const signature = lovePlaySaveSignature(save);
    if (signature === lastSavedSignatureRef.current) return true;

    const expected = revisionRef.current;
    if (expected === null) {
      autosaveRef.current = false;
      setSaveNotice("invalid");
      return false;
    }
    const result = saveLovePlayScene(save, expected);
    if (result.ok) {
      lastSavedSignatureRef.current = signature;
      revisionRef.current = result.store.revision;
      currentSaveRef.current = result.store.saves[save.scenarioId] ?? save;
      setSaveNotice((prev) => (prev === "quota" ? null : prev));
      return true;
    }
    switch (result.reason) {
      case "quota":
        // 本局继续，下一个稳定边界自动重试；不覆盖上一份有效 save。
        setSaveNotice("quota");
        break;
      case "conflict":
        autosaveRef.current = false;
        setSaveNotice("conflict");
        break;
      case "unavailable":
        autosaveRef.current = false;
        revisionRef.current = null;
        setSaveNotice("unavailable");
        break;
      default:
        autosaveRef.current = false;
        revisionRef.current = null;
        setSaveNotice("invalid");
        break;
    }
    return false;
  }, []);

  /**
   * 第 4 幕收束时把账本提交到 story routes（spec §3.3：先 progress、后 routes）。
   * quota / conflict 只提示，不拦剧情；记入统计成功后会再兜底试一次。
   * 同一份内容重复提交按签名跳过，但磁盘上已有的同内容再写一次也无害。
   */
  const commitRioRoute = useCallback((state: RioRelationshipState): boolean => {
    // 本页已被明确停写（坏档 / 冲突 / 另一标签页清空 / 存储不可用）时，不借 routes 重建 slot。
    if (!autosaveRef.current) return false;
    const payload = { ...state, updatedAt: Date.now() };
    const signature = JSON.stringify({ ...payload, updatedAt: 0 });
    if (routeCommitRef.current === signature) return true;
    // 本局已经被明确要求停写（损坏档 / 另一标签页清空 / 冲突 / 存储不可用）：
    // 不借 routes 这条路绕过停写规则，把刚被删掉的 story slot 重建回来。
    if (!autosaveRef.current) return false;

    const result = writeLovePlayRoute(RIO_SERIES_ID, payload, revisionRef.current ?? undefined);
    if (result.ok) {
      revisionRef.current = result.store.revision;
      routeCommitRef.current = signature;
      setSaveNotice((prev) => (prev === "quota" ? null : prev));
      return true;
    }
    setSaveNotice(
      result.reason === "conflict"
        ? "conflict"
        : result.reason === "quota"
          ? "quota"
          : result.reason === "unavailable"
            ? "unavailable"
            : "invalid",
    );
    return false;
  }, []);

  /**
   * 收束时把账本记到本幕：即使玩家一个作者拍点都没选中（模型直接收束），
   * 也要留下 `lastAct=4 / lastOutcome=本幕结局`，否则下一幕读不到上一幕的结局。
   * 快照同步回 routeState，收束档刷新后仍是同一本账。
   */
  const finalizeRioRoute = useCallback(
    (outcome: LovePlayOutcome, act: RioAct): boolean => {
      const snapshot = rioRouteRef.current;
      if (!snapshot) return false;
      const final: RioRelationshipState = {
        ...snapshot.rio,
        lastAct: act,
        lastOutcome: outcome,
        stale: false,
      };
      const updated = rioRouteSnapshot(final, snapshot.appliedBeats);
      rioRouteRef.current = updated;
      routeStateRef.current = updated;
      return commitRioRoute(final);
    },
    [commitRioRoute],
  );

  /**
   * 作者拍点只用逐字选项文本当证据：`applyRioBeat` 拒绝改写文本/未知拍点，
   * 返回同一个 state 引用时这里也不写 appliedBeats。stance 只在会话里，不在这里。
   */
  const applyAuthoredBeat = useCallback((beat: RioBeat): RioRouteSnapshot | null => {
    const snapshot = rioRouteRef.current;
    if (!snapshot) return null;
    const next = applyRioBeat(snapshot.rio, beat.id, {
      kind: "option",
      optionId: beat.id,
      text: beat.text,
    });
    if (next === snapshot.rio) return null;
    const appliedBeats = snapshot.appliedBeats.includes(beat.id)
      ? snapshot.appliedBeats
      : [...snapshot.appliedBeats, beat.id];
    const updated = rioRouteSnapshot(next, appliedBeats);
    rioRouteRef.current = updated;
    routeStateRef.current = updated;
    setBeatGroup(null);
    setRouteTick((n) => n + 1);
    return updated;
  }, []);

  /**
   * 一回合请求：成功才把 history 写入 historyRef；失败保留在 cmdRef 供重试。
   * 学习者台词在请求成功后才进入 learnerLines / 回合数——失败的半回合不能变成
   * 「你上次说过的话」，否则承接候选会漂移。
   */
  const requestTurn = useCallback(
    async (s: Scenario, history: ChatMessage[], showLine: boolean, pending?: LoveCarryTurn) => {
      if (requestRef.current) return;
      const generation = generationRef.current;
      const controller = new AbortController();
      requestRef.current = controller;
      cmdRef.current = { history, showLine, pending };
      setBusy(true);
      setErr(null);
      setOptions(null);
      setBeatGroup(null);
      try {
        const turn = await lovePlayTurn(
          { scenario: s, learnerCharacterId: defaultLearnerId(s), language: lang, learnerName: profile?.name, messages: history, turnLimit: s.maxTurns },
          controller.signal,
        );
        // 过期响应 / abort 不写任何 state，也不碰 history。
        if (controller.signal.aborted || generationRef.current !== generation) return;
        cmdRef.current = null;
        let lineKey: string | null = null;
        const speaker = speakerOf(s, defaultLearnerId(s));
        let nextHistory = history;
        if (showLine) {
          lineKey = uid();
          const npcText = turn.line[lang];
          putLine({ key: lineKey, characterId: speaker.id, text: npcText });
          // 模型这一句要带回下一回合：只送开场白 + 学习者台词时，它接不住自己上一句，
          // 剧情无法在自身上累积。开场白已经在 history 里，这里只追加本轮这句。
          nextHistory = [...history, { id: lineKey, role: "npc", characterId: speaker.id, text: npcText, ts: Date.now() }];
        }
        historyRef.current = nextHistory;
        if (pending) {
          // 只有这一回合真正成功，学习者的发言才算「说过」；重试成功也只计一次。
          setLearnerTurns((n) => n + 1);
          setLearnerLines((prev) => [...prev, pending]);
        }
        setEmotion(turn.emotion);
        setStance(turn.stance);
        // 首回合（showLine=false）只有本地 opening 无 AI line；若模型仍标记
        // revealed，徽标挂在 opening 的 key 上，避免揭示时刻被吞掉。
        setRevealKey(turn.revealed ? lineKey ?? (history[0]?.id ?? null) : null);
        if (turn.terminal || turn.ended) {
          // terminal = 目标结果；ended-only = 没有判定，按中性收尾展示（记分口径同 partial）。
          setOutcome(turn.terminal ?? "partial");
          setEndingKind(turn.terminal ? "terminal" : "ended");
          setBeatGroup(null);
          endedAtRef.current = Date.now();
          setOptions(null);
          setInput("");
          // 判得出结局就记进度，不等「记入统计」：承接读的是 outcome，而玩家拿到结局后
          // 往往直接返回，只在按钮里写会让下一幕收不到结局——那是实验的假阴性。
          // ended-only 也是本幕完成（中性/partial），不把下一幕卡在「未完成」上。
          const seriesOutcome = seriesOutcomeFor(turn.terminal, turn.ended);
          if (seriesOutcome && s.series) {
            writeLoveSeriesProgress(s.series.id, s.id, seriesOutcome, actNumberOf(s));
          }
          // 第 4–6 幕：progress 落盘后再提交账本；写失败只留提示，不阻断收尾。
          // 第 6 幕收束时按账本判定命名结局（可能为 null：条件没凑齐就不硬给名字）。
          const rioAct = rioRouteActOf(s);
          if (rioAct && seriesOutcome) {
            finalizeRioRoute(seriesOutcome, rioAct);
            if (rioAct === 6) {
              const snapshot = rioRouteRef.current;
              setEndingId(snapshot ? resolveRioEnding(snapshot.rio) : null);
            }
          }
        } else {
          // 第 4–6 幕：轮到作者拍点时，用 2–3 条写死的选项替换模型选项；
          // 拍点组一直保留到玩家真的选中一个作者选项，自由输入始终可用。
          const rioAct = rioRouteActOf(s);
          const rio = rioAct ? rioRouteRef.current : null;
          const group = rio && rioAct ? nextRioBeatGroup(rio.rio, rio.appliedBeats, rioAct) : null;
          if (group) {
            const authored = group.beats.map((beat) => beat.text);
            // 极端情况下作者选项只剩 1 条（requires 过滤后），补模型选项凑够 2 条，
            // 否则 playing save 不合法、整局都会停止自动存档。
            const merged =
              authored.length >= 2
                ? authored
                : [
                    ...authored,
                    ...turn.options.filter(
                      (option) =>
                        !authored.some((text) => text.zh === option.zh && text.en === option.en),
                    ),
                  ].slice(0, 4);
            setBeatGroup(group);
            setOptions(merged);
          } else {
            setOptions(turn.options);
          }
        }
      } catch (e) {
        if (controller.signal.aborted || generationRef.current !== generation) return;
        setErr(e instanceof Error ? e.message : t(lang, "error_generic"));
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          if (generationRef.current === generation) setBusy(false);
        }
      }
    },
    [lang, profile, putLine, finalizeRioRoute],
  );

  /** 开始一局：展示开场台词，请求首批选项（返回的台词不重复展示）。 */
  const startScene = useCallback(
    async (s: Scenario) => {
      generationRef.current += 1;
      // abort 后同步清 ref：否则新一局的首个 requestTurn 会被旧 ref 挡掉，只剩开场无选项。
      requestRef.current?.abort();
      requestRef.current = null;
      cmdRef.current = null;
      stopSpeaking();
      voiceRef.current.cancel(true);
      spokenRef.current = new Set();
      historyRef.current = startHistory(s, lang);
      startedAtRef.current = Date.now();
      endedAtRef.current = null;
      recordedRef.current = false;
      recordingRef.current = false;
      // 第 4–6 幕：账本在挂载时已经读好；重开本幕沿用同一本账，不退回空状态。
      const rioAct = rioRouteActOf(s);
      const rio = rioAct ? rioRouteRef.current : null;
      routeStateRef.current = rio ?? undefined;
      carryMarkedRef.current = false;
      carryIdRef.current = null;
      currentSaveRef.current = null;
      lastSavedSignatureRef.current = null;
      setCanRecap(false);
      setRecapOpen(false);
      setRecapSave(null);
      setResumed(false);
      setRecording(false);
      setRecordError(false);
      setEndingId(null);
      setEndingKind(null);
      setBeatGroup(null);
      // 第 4–6 幕的开场由账本选作者变体（见 resolveRioOpening）；变体本身就是「上次之后」，
      // 与承接句只能出现一个（spec §3.5）。其余场景维持原有的承接句拼接。
      const openingVariant = rio && rioAct ? resolveRioOpening(rio.rio, rioAct) : null;
      if (openingVariant) {
        const first = historyRef.current[0];
        historyRef.current[0] = { ...first, text: openingVariant[lang] };
      }
      // 承接句并进 opening 而不是单独一条气泡：首回合模型返回的 line 是被丢弃的，
      // 玩家能看见的只有本地开场白；而 opening 本来就在 history 里，模型顺带就读到它。
      // 读路径是纯的：mark 由下面的「真正显示」effect 负责。
      const carry =
        !openingVariant && s.series ? peekLoveCarryoverForScene(s.series.id, s.id, lang) : null;
      const carryText = carry?.text ?? null;
      carryIdRef.current = carry?.carryId ?? null;
      setCarryoverMark(!!carryText);
      if (carryText) {
        const first = historyRef.current[0];
        historyRef.current[0] = { ...first, text: `${first.text}\n\n${carryText}` };
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
      setBusy(false);
      await requestTurn(s, historyRef.current, false);
    },
    [lang, requestTurn, putLine],
  );

  const applyResume = useCallback(
    (view: LovePlayResumeState, save: LovePlaySave, s: Scenario, rioPlan: RioRouteSnapshot | null) => {
      const speaker = speakerOf(s, defaultLearnerId(s));
      historyRef.current = view.history;
      spokenRef.current = new Set(view.spokenKeys);
      startedAtRef.current = view.startedAt;
      endedAtRef.current = view.outcome ? view.endedAt : null;
      // 第 4 幕用挂载时规划好的账本（比 save 里的裸 state 多 appliedBeats）；
      // 其余场景原样透传 routeState。
      rioRouteRef.current = rioPlan;
      routeStateRef.current = rioPlan ?? view.routeState;
      recordedRef.current = view.recorded;
      recordingRef.current = false;
      carryIdRef.current = null;
      carryMarkedRef.current = true;
      setNpcLine({ key: view.npcLine.key, characterId: view.npcLine.characterId ?? speaker.id, text: view.npcLine.text });
      setLineWasSeen(seenRef.current.has(loveContentKey(s.id, view.npcLine.text)));
      // 恢复不重播打字机/揭示：当前句直接全文，skip=true。
      skipNow();
      setOptions(view.options);
      // 存档里显示的若正是某组作者选项，刷新后组标题也要跟着回来；
      // 对不上就按普通模型选项显示，避免标题与按钮错位。
      const resumeAct = rioRouteActOf(s);
      const pendingGroup =
        rioPlan && resumeAct ? nextRioBeatGroup(rioPlan.rio, rioPlan.appliedBeats, resumeAct) : null;
      const savedGroup =
        pendingGroup &&
        (view.options ?? []).some(
          (option) => rioBeatForOption(pendingGroup, option[lang], lang) !== null,
        )
          ? pendingGroup
          : null;
      setBeatGroup(savedGroup);
      setEmotion(view.emotion);
      setStance(view.stance);
      setOutcome(view.outcome);
      setEndingKind(view.outcome ? "terminal" : null);
      setEndingId(view.endingId);
      setRecorded(view.recorded);
      setRecording(false);
      setRecordError(false);
      setLearnerLines(view.learnerLines);
      setLearnerTurns(view.learnerTurns);
      setCarryoverMark(view.carryover);
      setBusy(false);
      setErr(null);
      setInput("");
      setRevealKey(null);
      currentSaveRef.current = save;
      lastSavedSignatureRef.current = lovePlaySaveSignature(save);
      setCanRecap(true);
      setSaveNotice(null);
      setResumed(true);
    },
    [skipNow, lang],
  );

  // 挂载先读本幕存档：有效则原地恢复（不请求模型、不重读历史语音）；坏档保留原件并停写。
  useEffect(() => {
    if (!sc || startedRef.current === sc.id) return;
    startedRef.current = sc.id;
    let alive = true;
    setSlots(readLovePlaySlots(sc.id).slots);
    const read = readLovePlaySave(sc.id);
    const plan = planLovePlayRestore(read);
    // 第 4–6 幕：在决定 resume/fresh 之前先读账本与系列进度（只读，不写盘）。
    // saved 是进行中的存档快照（含 appliedBeats），committed 是已提交到 routes 的账本；
    // 两者都没有才从旧进度迁移，进度为空则给空账本。
    const rioPlan = rioRouteActOf(sc)
      ? planRioRouteEntry({
          saved: plan.mode === "resume" ? plan.save.routeState : undefined,
          committed: readLovePlayRoute(RIO_SERIES_ID),
          progress: readLoveSeriesProgress(RIO_SERIES_ID),
        })
      : null;
    rioRouteRef.current = rioPlan;
    routeCommitRef.current = null;

    if (plan.mode === "resume") {
      const store = readLoveStoryStore();
      revisionRef.current = store.status === "ok" ? store.store.revision : 0;
      autosaveRef.current = true;
      // 恢复是挂载时的一次性状态注入；放进微任务，避免 effect 体内同步级联渲染。
      queueMicrotask(() => {
        if (alive) applyResume(plan.view, plan.save, sc, rioPlan);
      });
    } else {
      const store = readLoveStoryStore();
      const writable = plan.autosave && (store.status === "ok" || store.status === "empty");
      revisionRef.current = writable ? (store.status === "ok" ? store.store.revision : 0) : null;
      autosaveRef.current = writable;
      queueMicrotask(() => {
        if (!alive) return;
        // 坏档/版本不兼容：原件是恢复线索，先不开始任何剧情（spec §3.3）。
        if ((plan.notice === "corrupt" || plan.notice === "incompatible") && read.raw) {
          setSaveNotice(null);
          setRecovery({ raw: read.raw, reason: plan.notice });
          setCanRecap(false);
          return;
        }
        // empty 时也显式清空：同组件切换场景不应沿用上一幕的坏档提示。
        setSaveNotice(plan.notice);
        setCanRecap(false);
        void startScene(sc);
      });
    }

    // StrictMode 会模拟一次卸载：那边 abort 掉在途请求，这里若不放回 startedRef，重跑就被
    // 「已经开过这场」吞掉，于是开场白显示出来、首批选项永远不来（只在开发模式必然复现）。
    // requestRef 同步清空：c1 的 finally 带身份判断，不会误清 c2。
    return () => {
      alive = false;
      startedRef.current = null;
      requestRef.current?.abort();
      requestRef.current = null;
      cmdRef.current = null;
    };
    // 场景切换才重开；applyResume/startScene 依赖稳定（lang/profile 不变）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sc?.id]);

  // 另一标签页清空数据：本页停止保存，绝不把刚被删掉的进度重建回来（spec §3.4）。
  // 同一 slot 的其它变化（手动存/删）顺手刷新槽位列表。
  useEffect(() => {
    if (!sc?.id) return;
    return subscribeLoveSlots((key) => {
      if (key !== LOVE_STORY_KEY) return;
      const read = readLoveStoryStore();
      setSlots(read.status === "ok" ? read.store.slots[sc.id] ?? {} : {});
      if (read.status !== "empty") return;
      autosaveRef.current = false;
      revisionRef.current = null;
      lastSavedSignatureRef.current = null;
      setSaveNotice("deleted");
    });
  }, [sc?.id]);

  /** 开场承接句真正显示后记一次提问计数；恢复路径不会走到这里。 */
  useEffect(() => {
    const id = carryIdRef.current;
    if (!id || carryMarkedRef.current || !npcLine) return;
    if (!historyRef.current.some((m) => m.id === npcLine.key && m.role === "npc")) return;
    // 打字机刚开始时一个字都还没露出来，等第一个字符可见再记；随后 ref 保证只记一次。
    if (typing && typing.key === npcLine.key && typing.n === 0) return;
    carryMarkedRef.current = true;
    markLoveCarryoverShown(id);
  }, [npcLine, typing]);

  /**
   * 已读索引：整句完整显示后才记（自动/减少动态/已读跳过都是一次到全文）。
   * 坏 slot 不覆盖由 `markLoveTextSeen` 负责；seenRef 先记，避免 StrictMode 双跑重复写。
   */
  useEffect(() => {
    if (!sc || !npcLine || !npcLine.text) return;
    if (!skip && typing && typing.key === npcLine.key && typing.n < typing.total) return;
    const key = loveContentKey(sc.id, npcLine.text);
    if (seenRef.current.has(key)) return;
    seenRef.current.add(key);
    markLoveTextSeen(sc.id, [key]);
  }, [sc, npcLine, typing, skip]);

  // 存档/阅读提示只占一行，3 秒后自行消失，不打断剧情。
  useEffect(() => {
    if (!slotNotice) return;
    const timer = window.setTimeout(() => setSlotNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [slotNotice]);

  /**
   * 自动存档：只在稳定边界写——请求不在途、当前句已进 history、playing 已有 2–4 个选项
   * （或已经收束）。内容签名相同就不重复写 revision；conflict / invalid / unavailable 停写，
   * quota 只提示并在下一回合继续重试。
   */
  useEffect(() => {
    if (!sc || !autosaveRef.current || busy || !npcLine) return;
    if (!outcome && (!options || options.length < 2 || options.length > 4)) return;
    if (!historyRef.current.some((m) => m.id === npcLine.key && m.role === "npc")) return;

    const save = buildLovePlaySave({
      scenario: sc,
      lang,
      history: historyRef.current,
      currentLineKey: npcLine.key,
      options,
      emotion,
      stance,
      carryover: carryoverMark,
      learnerLines,
      outcome,
      endingId,
      routeState: routeStateRef.current,
      recorded,
      startedAt: startedAtRef.current,
    });
    if (!save) return;

    persistSave(save);
    // routeTick 只为把「拍点写进 ref」这件事叫醒 effect；内容去重由 persistSave 负责。
  }, [sc, busy, npcLine, options, emotion, stance, carryoverMark, learnerLines, outcome, recorded, endingId, lang, routeTick, persistSave]);

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
      // learnerTurns / learnerLines 等请求成功后再记（失败回滚见 requestTurn）。
      await requestTurn(sc, [...historyRef.current, learnerMsg], true, { via, text });
    },
    [sc, busy, outcome, npcLine, requestTurn],
  );

  /**
   * 选项点击入口：命中作者拍点时先写账本并**立即**落盘，再把逐字文本交给原有 `send`。
   * 证据只取作者写死的 `beat.text`；模型改写过的句子不匹配、不写状态。
   */
  const pickOption = useCallback(
    (option: L) => {
      if (!sc) return;
      const beat = rioBeatForOption(beatGroup, option[lang], lang);
      if (beat) {
        const updated = applyAuthoredBeat(beat);
        if (updated && npcLine) {
          // 这一回合还没发出，但「玩家选了哪条作者选项」已经是确定事实；
          // 与自动存档同一套 revision/提示分支，请求失败也不会把这次选择留在内存里。
          const save = buildLovePlaySave({
            scenario: sc,
            lang,
            history: historyRef.current,
            currentLineKey: npcLine.key,
            options,
            emotion,
            stance,
            carryover: carryoverMark,
            learnerLines,
            outcome,
            endingId,
            routeState: updated,
            recorded,
            startedAt: startedAtRef.current,
          });
          if (save) persistSave(save);
        }
      }
      void send(option[lang], "pick");
    },
    [
      sc,
      beatGroup,
      lang,
      applyAuthoredBeat,
      npcLine,
      options,
      emotion,
      stance,
      carryoverMark,
      learnerLines,
      outcome,
      endingId,
      recorded,
      persistSave,
      send,
    ],
  );

  const retry = useCallback(() => {
    if (!sc || requestRef.current) return;
    const pending = cmdRef.current;
    if (!pending) return;
    setErr(null);
    // 重试同样会带来一句新台词并自动朗读；开着麦克风念给对方听就是回声自触发。
    voiceRef.current.cancel(true);
    void requestTurn(sc, pending.history, pending.showLine, pending.pending);
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

  const leave = () => {
    stopSpeaking();
    voiceRef.current.cancel(true);
    router.push(backTo);
  };

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
    if (!outcome || recordedRef.current || recordingRef.current || !canSubmitLovePlayRecord(recorded)) return;
    recordingRef.current = true;
    setRecording(true);
    setRecordError(false);
    let landed = false;
    try {
      landed = completeLovePlay({
        scenario: sc,
        outcome,
        startedAt: startedAtRef.current,
        endedAt: endedAtRef.current ?? Date.now(),
        lang,
        endingId,
      });
    } catch {
      landed = false;
    }
    recordingRef.current = false;
    setRecording(false);
    if (landed) {
      recordedRef.current = true;
      setRecorded(true);
      // 记录写进同一个 story slot，会推进 revision；不同步过来，随后保存 recorded=true 会被
      // 误判成别的标签页冲突。
      if (autosaveRef.current) {
        const store = readLoveStoryStore();
        if (store.status === "ok") revisionRef.current = store.store.revision;
      }
      // 进度写入对本幕幂等：terminal 与 ended-only 都算完成，重玩靠前一幕也不会倒退。
      if (sc.series) writeLoveSeriesProgress(sc.series.id, sc.id, outcome, actNumberOf(sc));
      // 兜底：判出结局时如果 routes 因 quota/conflict 没写成，这里再试一次；
      // 同一份账本按签名跳过，不会因为多点一次「记入统计」写出两份。
      const recordAct = rioRouteActOf(sc);
      if (recordAct) finalizeRioRoute(outcome, recordAct);
    } else {
      setRecordError(true);
    }
  };

  const restart = () => {
    const result = deleteLovePlayScene(sc.id, revisionRef.current ?? undefined);
    if (result.ok) {
      revisionRef.current = result.store.revision;
      autosaveRef.current = true;
      setSaveNotice(null);
    } else {
      // 删不掉旧档也继续开局，但本局不再写 slot（损坏档尤其不能被新局覆盖）。
      autosaveRef.current = false;
      revisionRef.current = null;
      const reason: SaveNotice =
        result.reason === "conflict"
          ? "conflict"
          : result.reason === "quota"
            ? "restart_failed"
            : result.reason === "unavailable"
              ? "unavailable"
              : "invalid";
      setSaveNotice((prev) => (prev === "corrupt" || prev === "incompatible" ? prev : reason));
    }
    void startScene(sc);
  };

  /** 坏档恢复：先把原件交给用户留底，再允许明确清空。 */
  const downloadRecoveryRaw = () => {
    if (!recovery) return;
    try {
      const blob = new Blob([recovery.raw], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `socialcoach-love-save-${sc.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // 下载失败不阻断恢复，原件仍在设备上，用户可以直接重试。
    }
  };

  const restartFromRecovery = () => {
    clearLoveStorySlot();
    const store = readLoveStoryStore();
    const writable = store.status === "ok" || store.status === "empty";
    autosaveRef.current = writable;
    revisionRef.current = writable ? (store.status === "ok" ? store.store.revision : 0) : null;
    routeCommitRef.current = null;
    setRecovery(null);
    setSaveNotice(writable ? null : "invalid");
    void startScene(sc);
  };

  const openRecap = () => {
    if (!canRecap) return;
    let snapshot = currentSaveRef.current;
    if (!snapshot) {
      const read = readLovePlaySave(sc.id);
      snapshot = read.status === "ok" && read.save ? read.save : null;
    }
    if (!snapshot) return;
    setRecapSave(snapshot);
    setRecapOpen(true);
  };

  const closeRecap = () => {
    setRecapOpen(false);
    stopSpeaking();
  };

  /** 当前界面是否已经到一个可以安全落盘的稳定点；在途回合不存。 */
  const snapshotForSlot = (): LovePlaySave | null => {
    if (!sc || !npcLine || busy || !historyRef.current.some((m) => m.id === npcLine.key && m.role === "npc")) {
      return null;
    }
    return buildLovePlaySave({
      scenario: sc,
      lang,
      history: historyRef.current,
      currentLineKey: npcLine.key,
      options,
      emotion,
      stance,
      carryover: carryoverMark,
      learnerLines,
      outcome,
      endingId,
      routeState: routeStateRef.current,
      recorded,
      startedAt: startedAtRef.current,
    });
  };

  /** 手动槽写入失败的提示口径：冲突与自动归档同源，其它原因各自说清楚。 */
  const slotWriteFailure = (reason: "conflict" | "quota" | "unavailable" | "invalid") => {
    if (reason === "conflict") {
      autosaveRef.current = false;
      setSlotNotice({ key: "love_play_slot_conflict" });
      return;
    }
    setSlotNotice({
      key:
        reason === "quota"
          ? "love_play_save_quota"
          : reason === "unavailable"
            ? "love_play_save_unavailable"
            : "love_play_slot_failed",
    });
  };

  const saveToSlot = (slot: LovePlaySlot) => {
    if (!sc) return;
    if (!autosaveRef.current) {
      setSlotNotice({ key: "love_play_slot_stopped" });
      return;
    }
    const save = snapshotForSlot();
    if (!save) {
      setSlotNotice({ key: "love_play_slot_unstable" });
      return;
    }
    const result = saveLovePlaySlot(sc.id, slot, save, revisionRef.current ?? undefined);
    if (!result.ok) {
      slotWriteFailure(result.reason);
      return;
    }
    revisionRef.current = result.store.revision;
    setSlots(result.store.slots[sc.id] ?? {});
    setSlotNotice({ key: "love_play_slot_saved", vars: { n: slot } });
  };

  /**
   * 读取手动槽：中止在途回合、停朗读，再按同一套恢复投影原地换局。
   * 本幕的关系账本用槽里的 routeState 快照重新规划，和挂载恢复同一口径。
   */
  const loadFromSlot = (slot: LovePlaySlot) => {
    if (!sc) return;
    const save = slots[slot];
    if (!save) return;
    const view = restoreLovePlayView(save);
    if (!view) {
      setSlotNotice({ key: "love_play_slot_unreadable" });
      return;
    }
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    cmdRef.current = null;
    stopSpeaking();
    voiceRef.current.cancel(true);
    const rioPlan = rioRouteActOf(sc)
      ? planRioRouteEntry({
          saved: save.routeState,
          committed: readLovePlayRoute(RIO_SERIES_ID),
          progress: readLoveSeriesProgress(RIO_SERIES_ID),
        })
      : null;
    const store = readLoveStoryStore();
    const writable = store.status === "ok" || store.status === "empty";
    autosaveRef.current = writable;
    revisionRef.current = writable ? (store.status === "ok" ? store.store.revision : 0) : null;
    routeCommitRef.current = null;
    lastSavedSignatureRef.current = null;
    applyResume(view, save, sc, rioPlan);
    setSlotsOpen(false);
    setSlotPending(null);
    setSlotNotice({ key: "love_play_slot_loaded", vars: { n: slot } });
  };

  const removeSlot = (slot: LovePlaySlot) => {
    if (!sc) return;
    if (!autosaveRef.current) {
      setSlotNotice({ key: "love_play_slot_stopped" });
      return;
    }
    const result = deleteLovePlaySlot(sc.id, slot, revisionRef.current ?? undefined);
    if (!result.ok) {
      slotWriteFailure(result.reason);
      return;
    }
    revisionRef.current = result.store.revision;
    setSlots(result.store.slots[sc.id] ?? {});
    setSlotPending(null);
    setSlotNotice({ key: "love_play_slot_deleted", vars: { n: slot } });
  };

  const updateReader = (patch: Partial<LoveReaderSettings>) => {
    const next = { ...reader, ...patch };
    setReader(next);
    readerRef.current = next;
    writeLoveReaderSettings(next);
  };

  const endingText = !outcome
    ? ""
    : endingKind === "ended"
      ? t(lang, "love_play_ended_text")
      : outcome === "failure"
        ? sc.failure[lang]
        : outcome === "partial"
          ? t(lang, "love_play_partial_text")
          : sc.success[lang];
  const tone = scenarioTone(sc);
  const lineTextClass =
    reader.textSize === "sm" ? "text-[14px]" : reader.textSize === "lg" ? "text-[18px]" : "text-[15.5px]";
  const slotWhen = (save: LovePlaySave) =>
    new Date(save.updatedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const slotLine = (save: LovePlaySave) =>
    t(lang, save.status === "ended" ? "love_play_slot_status_ended" : "love_play_slot_status_playing", {
      n: Math.max(1, save.history.filter((m) => m.role === "learner").length),
    });
  const slotPreview = (save: LovePlaySave) =>
    [...save.history].reverse().find((m) => m.role === "npc")?.text ?? "";

  return (
    <div className="h-dvh flex flex-col bg-paper relative overflow-hidden" data-tone={tone}>
      {/* 顶部：返回 + 场景名 + 回想 + 回合数 */}
      <header className="relative z-20 shrink-0 flex items-center gap-2 px-3 border-b border-line bg-paper">
        <button onClick={leave} aria-label={t(lang, "love_play_back_love")} className="press h-11 w-11 -ml-2 inline-flex items-center justify-center rounded-full text-ink-2 hover:bg-inset">
          <ArrowLeft size={20} />
        </button>
        <h1 className="flex-1 min-w-0 truncate text-[15px] font-semibold">{sc.title[lang]}</h1>
        <button
          onClick={() => setSlotsOpen(true)}
          aria-label={t(lang, "love_play_slots")}
          aria-haspopup="dialog"
          className="press h-11 w-11 inline-flex items-center justify-center rounded-full text-ink-2 hover:bg-inset"
        >
          <Bookmark size={19} />
        </button>
        <button
          onClick={() => setReaderOpen(true)}
          aria-label={t(lang, "love_play_reader")}
          aria-haspopup="dialog"
          className="press h-11 w-11 inline-flex items-center justify-center rounded-full text-ink-2 hover:bg-inset"
        >
          <Settings2 size={19} />
        </button>
        <button
          onClick={openRecap}
          disabled={!canRecap}
          aria-label={t(lang, "love_play_recap")}
          aria-haspopup="dialog"
          className="press h-11 w-11 inline-flex items-center justify-center rounded-full text-ink-2 hover:bg-inset disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <History size={19} />
        </button>
        <span className="num hidden sm:inline text-[12px] text-ink-3 whitespace-nowrap">{t(lang, "love_play_turns", { n: Math.max(1, learnerTurns) })}</span>
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
          {revealKey && !reader.reduceMotion && (
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
        {carryoverMark && (
          <p className="eyebrow mt-3 text-[11px] text-ink-3">{t(lang, "love_play_carryover")}</p>
        )}

        {resumed && (
          <p className="mt-2 text-[12px] text-ink-3" role="status">{t(lang, "love_play_resumed")}</p>
        )}

        {saveNotice && (
          <div className="mt-2 max-w-[var(--measure)] rounded-[var(--radius-sm)] bg-inset px-3 py-2" role="status">
            <p className="text-[12px] leading-relaxed text-ink-2">{t(lang, SAVE_NOTICE_KEY[saveNotice])}</p>
            {saveNotice === "conflict" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
                  {t(lang, "love_play_save_reload")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSaveNotice(null)}>
                  {t(lang, "love_play_save_keep")}
                </Button>
              </div>
            )}
          </div>
        )}

        {slotNotice && (
          <p className="mt-2 text-[12px] text-ink-3 max-w-[var(--measure)]" role="status">
            {t(lang, slotNotice.key, slotNotice.vars)}
          </p>
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
          className={clsx("min-h-[96px] cursor-pointer select-none rounded-[var(--radius)] border border-line-strong bg-card px-4 py-3 flex flex-col justify-center", carryoverMark ? "mt-1.5" : "mt-3", outcome && "opacity-75")}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-[13px] font-semibold text-ink">{npcLine ? speaker.name[lang] : ""}</span>
              {lineWasSeen && npcLine && (
                <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
                  {t(lang, "love_play_seen")}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {!typingDone && npcLine && <span className="text-[11px] text-ink-3">{t(lang, "love_play_skip")}</span>}
              {busy && (
                <span className="inline-flex items-center gap-1 text-[12px] text-ink-3">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                </span>
              )}
            </span>
          </div>
          <p className={clsx("leading-relaxed text-ink mt-1 whitespace-pre-wrap", lineTextClass)}>{npcLine ? shownText : ""}</p>
        </div>

        {!outcome && (
          <>
            {options && (
              <PlayOptions
                options={options}
                busy={busy}
                ready={typingDone}
                lineKey={npcLine?.key}
                lang={lang}
                prompt={beatGroup?.title}
                onPick={pickOption}
              />
            )}

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

        {outcome && (
          <PlayEnding
            lang={lang}
            outcome={outcome}
            endingKind={endingKind}
            endingId={endingId}
            endingText={endingText}
            recorded={recorded}
            recording={recording}
            recordFailed={recordError}
            carry={carryTarget}
            onRecord={record}
            onRestart={restart}
            onBack={leave}
          />
        )}
      </div>

      <LoveRecap open={recapOpen} onClose={closeRecap} save={recapSave} scenario={sc} />

      {/* 手动存档：1 个自动档在后台，3 个手动位回到保存那一刻。 */}
      <Sheet
        open={slotsOpen}
        onClose={() => {
          setSlotsOpen(false);
          setSlotPending(null);
        }}
        title={t(lang, "love_play_slots")}
      >
        <div className="flex flex-col gap-3 pt-2">
          <p className="text-[12px] leading-relaxed text-ink-3">{t(lang, "love_play_slot_auto_hint")}</p>
          {SLOT_IDS.map((slot) => {
            const save = slots[slot];
            const confirming = slotPending === slot;
            return (
              <div key={slot} className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-line bg-card p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">
                    {t(lang, "love_play_slot_n", { n: slot })}
                  </span>
                  <span className="num text-[11px] text-ink-3">
                    {save ? `${slotWhen(save)} · ${slotLine(save)}` : t(lang, "love_play_slot_empty")}
                  </span>
                </div>
                {save && (
                  <p className="line-clamp-2 text-[12px] leading-relaxed text-ink-2">{slotPreview(save)}</p>
                )}
                {confirming && save ? (
                  <div className="rounded-[var(--radius-sm)] bg-inset px-3 py-2" role="alertdialog" aria-label={t(lang, "love_play_slot_confirm", { n: slot })}>
                    <p className="text-[12px] leading-relaxed text-ink-2">
                      {t(lang, "love_play_slot_confirm", { n: slot })}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="ink" onClick={() => loadFromSlot(slot)}>
                        {t(lang, "love_play_slot_confirm_load")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSlotPending(null)}>
                        {t(lang, "cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={save ? "secondary" : "primary"}
                      onClick={() => saveToSlot(slot)}
                    >
                      {t(lang, save ? "love_play_slot_overwrite" : "love_play_slot_save")}
                    </Button>
                    {save && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setSlotPending(slot)}>
                          {t(lang, "love_play_slot_load")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => removeSlot(slot)}>
                          {t(lang, "love_play_slot_delete")}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Sheet>

      {/* 阅读设置：字号/速度/自动/已读跳过/减少动态，全部只影响恋爱模式。 */}
      <Sheet open={readerOpen} onClose={() => setReaderOpen(false)} title={t(lang, "love_play_reader_title")}>
        <div className="flex flex-col gap-5 pt-2">
          <div>
            <p className="text-[13px] font-semibold text-ink">{t(lang, "love_play_reader_size")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["sm", "md", "lg"] as const).map((size) => (
                <Chip
                  key={size}
                  active={reader.textSize === size}
                  onClick={() => updateReader({ textSize: size })}
                  sharedSelection={false}
                >
                  {t(lang, `love_play_reader_size_${size}` as TKey)}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-ink">{t(lang, "love_play_reader_speed")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["slow", "normal", "fast"] as const).map((speed) => (
                <Chip
                  key={speed}
                  active={reader.speed === speed}
                  onClick={() => updateReader({ speed })}
                  sharedSelection={false}
                >
                  {t(lang, `love_play_reader_speed_${speed}` as TKey)}
                </Chip>
              ))}
            </div>
          </div>
          {([
            ["auto", "love_play_reader_auto", "love_play_reader_auto_hint"],
            ["skipRead", "love_play_reader_skip", "love_play_reader_skip_hint"],
            ["reduceMotion", "love_play_reader_motion", "love_play_reader_motion_hint"],
          ] as const).map(([field, label, hint]) => (
            <div key={field} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">{t(lang, label)}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{t(lang, hint)}</p>
              </div>
              <Switch
                checked={reader[field]}
                onChange={(value) => {
                  const patch: Partial<LoveReaderSettings> = { [field]: value };
                  updateReader(patch);
                }}
                label={t(lang, label)}
              />
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={!!recovery}
        onClose={leave}
        title={t(lang, "love_play_recovery_title")}
      >
        <div className="flex flex-col gap-3 pt-2">
          <p className="text-[14px] leading-relaxed text-ink-2">{t(lang, "love_play_recovery_body")}</p>
          <Button block variant="ink" onClick={downloadRecoveryRaw}>
            {t(lang, "love_play_recovery_download")}
          </Button>
          <Button block variant="danger" onClick={restartFromRecovery}>
            {t(lang, "love_play_recovery_restart")}
          </Button>
          <Button block variant="ghost" onClick={leave}>
            {t(lang, "cancel")}
          </Button>
        </div>
      </Sheet>

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

"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { Lang, L } from "@/data/taxonomy";
import type { TKey } from "@/lib/i18n";
import type { LovePlayOutcome } from "@/lib/love-play-client";
import { t } from "@/lib/i18n";
import { Button, Sheet } from "@/components/ui";
import { subscribeLoveSlots } from "@/lib/love-slot-events";
import { loveTimedChoiceRemainingMs, LOVE_TIMED_CHOICE_MS } from "@/lib/love-timed-choice";
import type { LoveChapterCard as LoveChapterCardData } from "@/lib/love-chapter-card";
import {
  LOVE_MEMORY_KEY,
  LOVE_MEMORY_TEXT_MAX,
  deleteLoveMemoryEntry,
  integrateLoveMemories,
  resolveLoveMemoriesForScope,
  setLoveMemoryLocked,
  updateLoveMemoryText,
  type LoveMemoryEntry,
} from "@/lib/love-memory";
import { PlayCarryCapture, type LoveCarryTarget } from "./PlayCarryCapture";

/**
 * 本回合的选项列表：按钮普通样式，不提示对错，点选即作为 learner 发言。台词打字未完时禁用。
 * `prompt` 是作者状态拍点组的标题（第 4 幕）；没有时沿用通用提示，布局不变。
 */
export function PlayOptions({ options, busy, ready, lineKey, lang, prompt, onPick }: { options: L[]; busy: boolean; ready: boolean; lineKey: string | undefined; lang: Lang; prompt?: L; onPick: (o: L) => void }) {
  return (
    <AnimatePresence initial={false}>
      {!busy && (
        <motion.div
          key={lineKey ?? "opts"}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="mt-3 flex flex-col gap-2 max-w-[var(--measure)]"
        >
          <p className="text-[11px] text-ink-3">{prompt ? prompt[lang] : t(lang, "love_play_options_hint")}</p>
          {options.map((o, i) => (
            <button
              key={i}
              onClick={() => onPick(o)}
              disabled={busy || !ready}
              className="press min-h-12 rounded-[var(--radius-sm)] border border-line bg-card px-4 text-left text-[14px] leading-snug text-ink hover:border-line-strong disabled:opacity-40 disabled:hover:border-line"
            >
              {o[lang]}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 好感度条：stance 是"对方此刻的开放程度"（0-100），不是给学习者的分数。首回合（无 stance）不渲染。 */
const STANCE_BANDS: ReadonlyArray<{ max: number; key: TKey; color: string }> = [
  { max: 30, key: "love_play_stance_low", color: "var(--clay)" },
  { max: 70, key: "love_play_stance_mid", color: "var(--teal)" },
  { max: 101, key: "love_play_stance_high", color: "var(--rose)" },
];

export function LoveStanceBar({ lang, name, value }: { lang: Lang; name: string; value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  if (Number.isNaN(v)) return null;
  const band = STANCE_BANDS.find((b) => v < b.max) ?? STANCE_BANDS[STANCE_BANDS.length - 1];
  return (
    <div className="max-w-[var(--measure)]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-ink-3 whitespace-nowrap">
          {t(lang, "love_play_stance_label")} · {name}
        </span>
        <span className="text-[11px] font-medium whitespace-nowrap" style={{ color: band.color }}>
          {t(lang, band.key)}
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-label={t(lang, "love_play_stance_label")}
        className="mt-1.5 h-1.5 rounded-full bg-inset overflow-hidden"
      >
        <motion.span
          className="block h-full origin-left rounded-full"
          style={{ background: band.color }}
          initial={false}
          animate={{ width: `${v}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

/** 揭示徽标：revealed=true 时在台词框上方浮现，2.5s 后自动淡出；卸载即停表。 */
export function LoveRevealBadge({ lang }: { lang: Lang }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 2500);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          role="status"
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium"
          style={{
            color: "var(--rose)",
            borderColor: "color-mix(in oklch, var(--rose) 38%, transparent)",
            background: "color-mix(in oklch, var(--rose) 12%, var(--card))",
          }}
        >
          <Sparkles size={13} className="shrink-0" />
          <span>{t(lang, "love_play_reveal_badge")}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * 收尾标题：命名结局优先（第 6 幕预留），其次区分「自然收尾」与三种目标结果。
 * 未知 endingId 静默回退，不崩、也不把 partial 冒充 success。
 */
export function loveEndingTitleKey(
  outcome: LovePlayOutcome,
  endingKind: "terminal" | "ended" | null,
  endingId: string | null,
): TKey {
  if (endingId === "said-it-plain") return "love_play_ending_said_it_plain";
  if (endingId === "clean-parting") return "love_play_ending_clean_parting";
  if (endingKind === "ended") return "love_play_outcome_ended";
  if (outcome === "success") return "love_play_outcome_success";
  if (outcome === "partial") return "love_play_outcome_partial";
  return "love_play_outcome_failure";
}

/** 收束界面：结局标题 + 本幕收尾文案 + 带走一句话 + 记入统计 / 重新开始 / 返回。 */
export function PlayEnding({
  lang,
  outcome,
  endingKind,
  endingId,
  endingText,
  recorded,
  recording,
  recordFailed,
  carry,
  onRecord,
  onRestart,
  onBack,
}: {
  lang: Lang;
  outcome: LovePlayOutcome;
  /** terminal = 目标结果；ended = 没有判定，自然收尾。 */
  endingKind: "terminal" | "ended" | null;
  /** 第 6 幕的命名结局；当前场景为 null。 */
  endingId: string | null;
  endingText: string;
  recorded: boolean;
  recording: boolean;
  recordFailed: boolean;
  /** 这一幕可以把承诺带给谁。每一场都有——跟进卡按说话人归属，与这条线连不连续无关。 */
  carry: LoveCarryTarget;
  onRecord: () => void;
  onRestart: () => void;
  onBack: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.28 }}
        className="mt-4 rounded-[var(--radius)] border border-line-strong bg-card px-5 py-6 flex flex-col gap-4 max-w-[var(--measure)]"
      >
        <div>
          <p className="eyebrow">{t(lang, loveEndingTitleKey(outcome, endingKind, endingId))}</p>
          <p className="text-[15px] leading-relaxed text-ink mt-2">{endingText}</p>
          <p className="text-[12px] text-ink-3 mt-2">{t(lang, "love_play_ending_hint")}</p>
        </div>
        <div className="flex flex-col gap-2.5">
          <button
            onClick={onRecord}
            disabled={recorded || recording}
            aria-busy={recording || undefined}
            className="press min-h-12 rounded-[var(--radius-sm)] bg-ink text-paper text-[15px] font-semibold disabled:opacity-60"
          >
            {recorded ? t(lang, "love_play_recorded") : recording ? t(lang, "love_play_recording") : t(lang, "love_play_record")}
          </button>
          {recordFailed && (
            <p role="alert" className="text-[12px] leading-relaxed text-danger">
              {t(lang, "love_play_record_failed")}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={onRestart} className="press min-h-11 rounded-[var(--radius-sm)] border border-line-strong bg-card text-[14px] text-ink">
              {t(lang, "love_play_restart")}
            </button>
            <button onClick={onBack} className="press min-h-11 rounded-[var(--radius-sm)] border border-line-strong bg-card text-[14px] text-ink">
              {t(lang, "love_play_back_love")}
            </button>
          </div>
        </div>
        {/* 带走承诺是可选项，排在主操作之后；不记也走得掉。 */}
        {carry && <PlayCarryCapture lang={lang} target={carry} />}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * 陪伴层记忆面板（Sheet 风格对齐存档/阅读设置）：查看本线本角色的记忆，
 * 可编辑、删除、锁定；「整理」从已确认的原话里补记，失败只提示、不阻塞剧情。
 * 作用域严格 seriesId + characterKey，跨线/跨 NPC 的记忆永远不会出现在这里。
 */
export function LoveMemorySheet({
  open,
  onClose,
  lang,
  seriesId,
  scenarioId,
  characterKey,
  getQuotes,
  getBoundaries,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  seriesId: string;
  scenarioId: string;
  characterKey: string;
  /** 本幕已确认、自己打出来的学习者发言（带消息 id），由 PlayScene 从最新历史里取。 */
  getQuotes: () => { id: string; text: string }[];
  /** Rio 账本里学习者立下的边界（仅 Rio 线非空）。 */
  getBoundaries: () => { id: string; text: string }[];
}) {
  const [entries, setEntries] = useState<LoveMemoryEntry[] | null>(null);
  const [notice, setNotice] = useState<{ key: TKey; vars?: Record<string, string | number> } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // 打开面板时读一次，之后只听记忆 slot 的变更；读取走定时回调，避免 effect 体内同步级联渲染。
  useEffect(() => {
    if (!open) return;
    let timer = 0;
    const read = () => setEntries(resolveLoveMemoriesForScope(seriesId, characterKey));
    timer = window.setTimeout(read, 0);
    const unsubscribe = subscribeLoveSlots((key) => {
      if (key !== null && key !== LOVE_MEMORY_KEY) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(read, 0);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [open, seriesId, characterKey]);

  const runTidy = () => {
    const result = integrateLoveMemories({
      seriesId,
      scenarioId,
      characterKey,
      quotes: getQuotes(),
      boundaries: getBoundaries(),
    });
    setNotice(
      result.ok
        ? {
            key: result.added > 0 ? "love_play_memory_tidy_done" : "love_play_memory_tidy_none",
            vars: { n: result.added },
          }
        : { key: "love_play_memory_tidy_failed" },
    );
  };

  const saveEdit = (entry: LoveMemoryEntry) => {
    const result = updateLoveMemoryText({ seriesId, characterKey, id: entry.id, text: draft });
    if (result.ok) {
      setEditingId(null);
      setDraft("");
      setNotice({ key: "love_play_memory_saved" });
    } else {
      setNotice({ key: "love_play_memory_write_failed" });
    }
  };

  const toggleLock = (entry: LoveMemoryEntry) => {
    const result = setLoveMemoryLocked({ seriesId, characterKey, id: entry.id, locked: !entry.locked });
    setNotice(result.ok ? null : { key: "love_play_memory_write_failed" });
  };

  const remove = (entry: LoveMemoryEntry) => {
    const result = deleteLoveMemoryEntry({ seriesId, characterKey, id: entry.id });
    setNotice(result.ok ? { key: "love_play_memory_deleted" } : { key: "love_play_memory_write_failed" });
  };

  const kindLabel = (entry: LoveMemoryEntry) => t(lang, `love_play_memory_kind_${entry.kind}` as TKey);
  const valid = (entries ?? []).filter((e) => !e.invalid);
  const invalid = (entries ?? []).filter((e) => e.invalid);

  const row = (entry: LoveMemoryEntry) => {
    const editing = editingId === entry.id;
    return (
      <div key={entry.id} className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-line bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
            {kindLabel(entry)}
          </span>
          {entry.locked && (
            <span className="shrink-0 text-[10px] text-accent-deep">{t(lang, "love_play_memory_locked")}</span>
          )}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              rows={2}
              value={draft}
              maxLength={LOVE_MEMORY_TEXT_MAX}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t(lang, "love_play_memory_edit_ph")}
              aria-label={t(lang, "love_play_memory_edit")}
              className="min-h-16 resize-none rounded-[var(--radius-sm)] border border-line bg-card px-3 py-2 text-[13px] leading-snug outline-none placeholder:text-ink-3 focus:border-ink-2"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ink" onClick={() => saveEdit(entry)}>
                {t(lang, "save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                {t(lang, "cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed text-ink-2">{entry.text}</p>
        )}
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditingId(entry.id);
                setDraft(entry.text);
              }}
            >
              {t(lang, "love_play_memory_edit")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => toggleLock(entry)}>
              {t(lang, entry.locked ? "love_play_memory_unlock" : "love_play_memory_lock")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => remove(entry)}>
              {t(lang, "love_play_memory_delete")}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={t(lang, "love_play_memory_title")}>
      <div className="flex flex-col gap-3 pt-2">
        <p className="text-[12px] leading-relaxed text-ink-3">{t(lang, "love_play_memory_hint")}</p>
        {notice && (
          <p role="status" className="text-[12px] text-ink-2">
            {t(lang, notice.key, notice.vars)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={runTidy}>
            {t(lang, "love_play_memory_tidy")}
          </Button>
          {entries !== null && (
            <span className="text-[11px] text-ink-3">{t(lang, "love_play_memory_count", { n: valid.length })}</span>
          )}
        </div>
        {entries !== null && entries.length === 0 && (
          <p className="text-[13px] leading-relaxed text-ink-2">{t(lang, "love_play_memory_empty")}</p>
        )}
        {valid.map(row)}
        {invalid.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] leading-relaxed text-ink-3">{t(lang, "love_play_memory_invalid_group")}</p>
            {invalid.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-line bg-inset p-3">
                <span className="shrink-0 self-start rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
                  {kindLabel(entry)}
                </span>
                <p className="text-[13px] leading-relaxed text-ink-3 line-through decoration-line-strong">{entry.text}</p>
                <div>
                  <Button size="sm" variant="ghost" onClick={() => remove(entry)}>
                    {t(lang, "love_play_memory_delete")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * 限时选择的倒计时条（spec §4.5 / 拍板 Q6）：只出现在高潮幕、且设置里开了
 * 限时选择。只显示剩余时间与「沉默也是一种回应」的口径，不催促、不吓唬、
 * 不暗示哪个选项正确；到点由 PlayScene 走沉默分支，这里不干预。
 */
export function LoveTimedCountdown({ lang, endsAt, now }: { lang: Lang; endsAt: number; now: number }) {
  const remainingMs = loveTimedChoiceRemainingMs(endsAt, now);
  const seconds = Math.ceil(remainingMs / 1000);
  const ratio = LOVE_TIMED_CHOICE_MS > 0 ? Math.max(0, Math.min(1, remainingMs / LOVE_TIMED_CHOICE_MS)) : 0;
  return (
    <div className="mt-3 max-w-[var(--measure)]" role="timer" aria-label={t(lang, "love_play_timed_label")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-ink-3">{t(lang, "love_play_timed_label")}</span>
        <span className="num text-[11px] font-medium text-ink-2">{t(lang, "love_play_timed_seconds", { n: seconds })}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-inset">
        <div
          className="h-full rounded-full"
          style={{ width: `${ratio * 100}%`, background: "var(--clay)" }}
        />
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{t(lang, "love_play_timed_hint")}</p>
    </div>
  );
}

/** 幕首卡的自动停留时长；点击/按键可提前跳过。 */
const CHAPTER_CARD_AUTO_MS = 5200;

/**
 * 幕首卡（spec §4.5）：黑场渐入，幕号、标题、时间/地点、一句引子。
 * 覆盖整页，点击任意处或按 Enter/空格继续，超过停留时长自动放行——
 * 自动阅读的玩家不会被一张卡永远挡在门外。reduceMotion 时直接呈现，不渐入。
 */
export function LoveChapterCard({
  lang,
  card,
  reduceMotion,
  onContinue,
}: {
  lang: Lang;
  card: LoveChapterCardData;
  reduceMotion: boolean;
  onContinue: () => void;
}) {
  const [shown, setShown] = useState(reduceMotion);
  // onContinue 会随渲染重建，自动放行只该调用最新那个；ref 在 effect 里跟进。
  const continueRef = useRef(onContinue);
  useEffect(() => {
    continueRef.current = onContinue;
  });

  useEffect(() => {
    if (reduceMotion) return;
    const timer = window.setTimeout(() => setShown(true), 30);
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  useEffect(() => {
    const timer = window.setTimeout(() => continueRef.current(), CHAPTER_CARD_AUTO_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const actKey: TKey = card.continuous ? "love_series_act" : "love_series_scene";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: shown ? 1 : 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.9, ease: "easeOut" }}
      role="button"
      tabIndex={0}
      aria-label={t(lang, "love_play_chapter_skip")}
      onClick={onContinue}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onContinue();
        }
      }}
      className="fixed inset-0 z-50 flex cursor-pointer select-none flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ background: "var(--slab)", color: "var(--slab-ink)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <p className="eyebrow" style={{ color: "color-mix(in oklch, var(--slab-ink) 62%, transparent)" }}>
          {card.seriesName[lang]}
        </p>
        <p className="text-[12px] tracking-[0.2em]" style={{ color: "color-mix(in oklch, var(--slab-ink) 72%, transparent)" }}>
          {t(lang, actKey, { n: card.act })}
        </p>
        <h2 className="text-[24px] font-semibold leading-snug">{card.title[lang]}</h2>
        <p className="text-[13px]" style={{ color: "color-mix(in oklch, var(--slab-ink) 78%, transparent)" }}>
          {card.data.where[lang]} · {card.data.when[lang]}
        </p>
        <p className="mt-3 max-w-[var(--measure)] text-[15px] leading-relaxed">{card.data.hook[lang]}</p>
      </div>
      <p className="mt-8 text-[11px]" style={{ color: "color-mix(in oklch, var(--slab-ink) 52%, transparent)" }}>
        {t(lang, "love_play_chapter_skip")}
      </p>
    </motion.div>
  );
}

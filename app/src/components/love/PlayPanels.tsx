"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { Lang, L } from "@/data/taxonomy";
import type { TKey } from "@/lib/i18n";
import type { LovePlayOutcome } from "@/lib/love-play-client";
import { t } from "@/lib/i18n";
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

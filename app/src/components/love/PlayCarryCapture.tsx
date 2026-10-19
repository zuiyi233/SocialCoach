"use client";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { L, type Lang } from "@/data/taxonomy";
import { CARRY_PROMISE_LABELS, type CarryPromiseClass } from "@/data/corpus/love-carry-lines";
import { pick, t } from "@/lib/i18n";
import { LOVE_CARRY_TEXT_MAX, readLoveCarries, saveLoveCarry, type LoveCarry, type LoveCarrySave } from "@/lib/love-carry-store";

/** 这一幕可以把承诺带给谁：线（可以没有线）、说话人、以及学习者自己打出来的那些句子。 */
export interface LoveCarryTarget {
  scenarioId: string;
  /** 这一幕属于哪条剧情线；独立场景与自定义排练是 null——**记录承诺不需要有一条线**。 */
  seriesId: string | null;
  npcId: string;
  npcName: L;
  candidates: string[];
}

const CLASSES = Object.keys(CARRY_PROMISE_LABELS) as CarryPromiseClass[];

/**
 * 超长是**拒绝**，不是截断：`saveLoveCarry` 不再替学习者删字，这里也必须把原因说出来，
 * 而不是让他以为存下的就是自己打的那一整句。文案留在组件里（i18n 表这一批不动）。
 */
const CARRY_TOO_LONG: L = L(
  `这句话超过了 ${LOVE_CARRY_TEXT_MAX} 字的上限，没有存下——请自己缩短后再存，不能替你删字。`,
  `This line is over the ${LOVE_CARRY_TEXT_MAX}-character limit, so it was not kept. Shorten it yourself — nothing was cut for you.`,
);

type CarryError = Extract<LoveCarrySave, { ok: false }>["reason"] | null;

/**
 * 收束时的「带走一句话」：把本场里**学习者自己打的**某句（或现写的一句）存成承诺，
 * 之后由**接过这句话的那个人**问起它——幕内开场（同人贯穿的线）或恋爱首页的跟进卡。
 *
 * 三条纪律写在这里而不是靠口头约定：
 * - 候选只来自 `loveCarryCandidates`（点的选项进不来）；
 * - 记不记由学习者决定，整段可以关掉，关掉也不是死路；
 * - 只写这一个设备 slot，不碰任何能力数值、不发模型或后端请求。
 */
export function PlayCarryCapture({ lang, target }: { lang: Lang; target: LoveCarryTarget }) {
  const [recorded, setRecorded] = useState<LoveCarry | null>(null);
  const [editing, setEditing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [text, setText] = useState("");
  const [cls, setCls] = useState<CarryPromiseClass | null>(null);
  const [error, setError] = useState<CarryError>(null);
  // 挂载后再读存储（同 SeriesPlay）：服务端首屏没有 localStorage，同步读会 hydration 不一致。
  const [ready, setReady] = useState(false);
  // 与 `saveLoveCarry` 的归属键同一口径：同一场景里换一个 NPC，展示的必须是这个人那句。
  const count = text.trim().length;
  const overLimit = count > LOVE_CARRY_TEXT_MAX;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRecorded(
        readLoveCarries().find(
          (c) => c.scenarioId === target.scenarioId && c.npcId === target.npcId && c.state === "pending",
        ) ?? null,
      );
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [target.scenarioId, target.npcId]);

  const save = () => {
    // 存下去的就是学习者打出来的那几个字：只去首尾空白，不改写、不截断、不翻译。
    const value = text.trim();
    if (!value) return;
    // 提交前先挡一次：候选句可能是本场里打过的长句，不能等到 store 才拒绝。
    if (value.length > LOVE_CARRY_TEXT_MAX) {
      setError("too-long");
      return;
    }
    const res = saveLoveCarry({
      text: value,
      // 记录时的界面语言就是这句话被打出来的语言；除此之外没有第二处知道它的语种。
      lang,
      cls,
      npcId: target.npcId,
      npcName: target.npcName,
      scenarioId: target.scenarioId,
      seriesId: target.seriesId,
    });
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    setRecorded(res.carry);
    setError(null);
    setEditing(false);
  };

  if (!ready) return null;

  if (recorded && !editing) {
    return (
      <div className="pt-4 border-t border-line flex flex-col gap-2">
        <p className="eyebrow text-[11px] text-ink-3">{t(lang, "love_carry_title")}</p>
        {/* 原话不外加引号：台词库在引用时自己会包，这里只把这句单独起一行摆出来。 */}
        <p className="border-l-2 border-line-strong pl-3 text-[14px] leading-relaxed text-ink">{recorded.text}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-ink-3">{t(lang, "love_carry_saved")}</span>
          <button onClick={() => { setEditing(true); setDismissed(false); setText(""); setError(null); }} className="press text-[12px] underline text-ink-2">
            {t(lang, "love_carry_change")}
          </button>
        </div>
      </div>
    );
  }

  if (dismissed) {
    return (
      <div className="pt-4 border-t border-line">
        <button onClick={() => { setDismissed(false); setEditing(true); }} className="press text-[12px] underline text-ink-2">
          {t(lang, "love_carry_title")}
        </button>
      </div>
    );
  }

  return (
    <div className="pt-4 border-t border-line flex flex-col gap-3">
      <div>
        <p className="eyebrow text-[11px] text-ink-3">{t(lang, "love_carry_title")}</p>
        <p className="text-[12px] text-ink-3 leading-relaxed mt-1">{t(lang, "love_carry_sub")}</p>
      </div>

      {target.candidates.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-ink-3">{t(lang, "love_carry_from_typed")}</p>
          {target.candidates.map((candidate) => (
            <button
              key={candidate}
              onClick={() => { setText(candidate); setError(candidate.trim().length > LOVE_CARRY_TEXT_MAX ? "too-long" : null); }}
              className={clsx(
                "press min-h-11 rounded-[var(--radius-sm)] border px-3 py-2 text-left text-[13.5px] leading-snug",
                text === candidate ? "border-ink-2 bg-inset text-ink" : "border-line bg-card text-ink hover:border-line-strong",
              )}
            >
              {candidate}
            </button>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-2 text-[11px] text-ink-3">
          <span>{t(lang, "love_carry_type_own")}</span>
          {/* 计数按真正会落盘的那几个字算（去首尾空白之后），和 store 的校验同一口径。 */}
          <span className={clsx("num whitespace-nowrap", overLimit && "text-danger")}>
            {count} / {LOVE_CARRY_TEXT_MAX}
          </span>
        </span>
        <textarea
          rows={2}
          value={text}
          maxLength={LOVE_CARRY_TEXT_MAX}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          placeholder={t(lang, "love_carry_type_ph")}
          className="min-h-16 max-h-[140px] resize-none rounded-[var(--radius-sm)] border border-line bg-card px-3 py-2.5 text-[15px] leading-snug outline-none placeholder:text-ink-3 focus:border-ink-2"
        />
      </label>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-ink-3">{t(lang, "love_carry_class_label")}</p>
        <div className="flex flex-wrap gap-2">
          {CLASSES.map((c) => (
            <button
              key={c}
              onClick={() => setCls(c)}
              aria-pressed={cls === c}
              className={clsx("press min-h-9 rounded-full border px-3 text-[13px]", cls === c ? "border-ink-2 bg-inset text-ink" : "border-line bg-card text-ink-2")}
            >
              {pick(CARRY_PROMISE_LABELS[c], lang)}
            </button>
          ))}
          <button
            onClick={() => setCls(null)}
            aria-pressed={cls === null}
            className={clsx("press min-h-9 rounded-full border px-3 text-[13px]", cls === null ? "border-ink-2 bg-inset text-ink" : "border-line bg-card text-ink-2")}
          >
            {t(lang, "love_carry_class_none")}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          {error === "too-long" ? pick(CARRY_TOO_LONG, lang) : t(lang, "love_carry_full")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <button onClick={save} disabled={!text.trim()} className="press min-h-11 rounded-[var(--radius-sm)] bg-ink text-paper px-4 text-[14px] font-semibold disabled:opacity-40">
          {t(lang, "love_carry_save")}
        </button>
        {/* 已经记着的那句不会因为「不用了」消失——收起的只是这次改写。 */}
        <button onClick={() => { setDismissed(true); setEditing(false); }} className="press min-h-11 px-2 text-[13px] text-ink-2 underline">
          {t(lang, "love_carry_skip")}
        </button>
      </div>
    </div>
  );
}

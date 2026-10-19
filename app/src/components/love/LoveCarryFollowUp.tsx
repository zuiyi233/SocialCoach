"use client";
import { useEffect, useRef, useState } from "react";
import type { L, Lang } from "@/data/taxonomy";
import { AvatarFigure } from "@/data/avatars";
import { pick, t } from "@/lib/i18n";
import {
  LOVE_CARRY_KEY,
  answerLoveCarry,
  dueLoveCarry,
  loveCarryCardLine,
  loveCarryLine,
  markLoveCarryAsked,
  readLoveCarries,
  retireExhaustedLoveCarries,
  type LoveCarry,
  type LoveCarryAnswer,
} from "@/lib/love-carry-store";
import { subscribeLoveSlots } from "@/lib/love-slot-events";
import { useApp } from "@/store/useApp";
import { useLovePortrait } from "./PlaySceneFigure";

const ANSWERS: readonly LoveCarryAnswer[] = ["kept", "open", "dropped"];

/** 立绘台那两种画法的缩小版：manifest 有这张脸就竖版立绘，没有就 AvatarFigure 占位。 */
function CarryFigure({ npcId, npcName, lang }: { npcId: string; npcName: L; lang: Lang }) {
  const { src, hue } = useLovePortrait(npcId);
  const size = 52;
  if (!src) return <AvatarFigure seed={pick(npcName, lang)} hue={hue} size={size} className="shrink-0" />;
  return (
    <span
      aria-hidden
      className="shrink-0 overflow-hidden bg-inset"
      style={{
        width: size,
        height: Math.round(size * 1.46),
        borderRadius: Math.round(size * 0.07),
        backgroundImage: `url("${src}")`,
        backgroundSize: "contain",
        backgroundPosition: "center bottom",
      }}
    />
  );
}

/**
 * 恋爱首页的跟进卡——「她来找你」在这条产品线上唯一负担得起的做法：
 * 台词全部来自 `love-carry-lines.ts`，**运行时零模型调用**，无推送、无服务端、无账号。
 *
 * 三条纪律决定了这张卡长什么样：
 * - **说话人只认存储里的名字快照**，不按 `npcId` 反查语料——`tess` 在语料里是两个人，
 *   反查会把承诺安到错误的人头上（立绘例外，见 `useLovePortrait`）。
 * - **作答不产生任何分数**：三个按钮只写承接自己的 `state`，四类能力数值一个都不碰，
 *   也不留练习记录（`spec-presence-layer.md` 第一节「回答做了不产生任何分数」同口径）。
 * - **没有输入框**：这是对一件你自己说过的动作的跟进，不是一个陪伴聊天入口。
 *
 * 浮现与否、问哪一句、用哪个变体，全部由 `dueLoveCarry` / `loveCarryCardLine` 判定；
 * 台词库缺某一格时整张卡不出现——按 §10.1 P4 的判据，那是要停下来讨论，不是要现编一句。
 */
export function LoveCarryFollowUp({ lang }: { lang: Lang }) {
  const hydrated = useApp((s) => s.hydrated);
  const enabled = useApp((s) => s.settings.loveCarry !== false);
  const [shown, setShown] = useState<{ carry: LoveCarry; phase: "ask" | "kept" } | null>(null);
  /** 浮现本身就是一次提问，一个组件生命周期里只该记一次（StrictMode 会把 effect 跑两遍）。 */
  const surfacedRef = useRef(false);

  useEffect(() => {
    // 存储只在挂载后读：服务端首屏没有 localStorage，同步读会 hydration 不一致。
    if (!hydrated || !enabled || surfacedRef.current) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      retireExhaustedLoveCarries();
      const due = dueLoveCarry();
      if (!due) return;
      surfacedRef.current = true;
      // 先取这一份再计数：卡片要按「浮现之前问过几次」选词——`askCount === 0` 才是第一次那句，
      // 记完再读回来的话，第一次浮现就会开口说「我不是头一回问了」，那是另一种假话。
      markLoveCarryAsked(due.id);
      setShown({ carry: due, phase: "ask" });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [hydrated, enabled]);

  // 另一标签页（或本页别处）改了 carry slot：重新问一次「现在该问哪一句」。
  // 自己的 markLoveCarryAsked / answerLoveCarry 也会派发事件：没有 due 时只在 slot 真的空了才收卡，
  // 否则刚浮现的卡会因为「刚问过、24h 内不再问」而当场消失。
  useEffect(() => {
    if (!enabled) return;
    return subscribeLoveSlots((key) => {
      if (key !== null && key !== LOVE_CARRY_KEY) return;
      const due = dueLoveCarry();
      if (due) {
        setShown((prev) => (prev?.phase === "kept" ? prev : { carry: due, phase: "ask" }));
        return;
      }
      if (readLoveCarries().length === 0) setShown(null);
    });
  }, [enabled]);

  if (!shown) return null;
  const { carry, phase } = shown;
  const line = phase === "kept" ? loveCarryLine(carry, "kept", lang) : loveCarryCardLine(carry, lang);
  if (!line) return null;

  const answer = (value: LoveCarryAnswer) => {
    answerLoveCarry(carry.id, value);
    // 「做了」才有一句回应，那句也来自库里；「还没」与「不再问了」之后是沉默。
    const keptLine = value === "kept" ? loveCarryLine(carry, "kept", lang) : null;
    setShown(keptLine ? { carry, phase: "kept" } : null);
  };

  return (
    <section aria-label={t(lang, "love_follow_eyebrow")} className="card p-5 flex flex-col gap-3">
      <div className="flex items-start gap-4">
        <CarryFigure npcId={carry.npcId} npcName={carry.npcName} lang={lang} />
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <p className="eyebrow text-[11px] text-ink-3">{t(lang, "love_follow_eyebrow")}</p>
          <p className="text-[13px] font-semibold text-ink">{pick(carry.npcName, lang)}</p>
          <p className="text-[15px] leading-relaxed text-ink">{line}</p>
        </div>
      </div>

      {phase === "ask" ? (
        <div className="flex flex-wrap gap-2">
          {ANSWERS.map((value) => (
            <button
              key={value}
              onClick={() => answer(value)}
              className="press min-h-11 rounded-[var(--radius-sm)] border border-line-strong bg-card px-3.5 text-[14px] text-ink"
            >
              {t(lang, value === "kept" ? "love_follow_kept" : value === "open" ? "love_follow_open" : "love_follow_dropped")}
            </button>
          ))}
        </div>
      ) : (
        <button onClick={() => setShown(null)} className="press self-start min-h-11 px-2 text-[13px] text-ink-2 underline">
          {t(lang, "love_follow_ack")}
        </button>
      )}

      <p className="text-[11.5px] text-ink-3 leading-relaxed">{t(lang, "love_follow_note")}</p>
    </section>
  );
}

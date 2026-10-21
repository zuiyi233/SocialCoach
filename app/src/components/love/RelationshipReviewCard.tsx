"use client";
import type { Lang } from "@/data/taxonomy";
import type { TKey } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { stageKey, type LoveRelationshipReview } from "@/lib/love-relationship";

/** 维度 → 定性文案：不出现档位数字 / 百分比。 */
const CHANGE_KEYS: Record<LoveRelationshipReview["changes"][number]["dimension"], TKey> = {
  familiarity: "love_relationship_grew_familiarity",
  trust: "love_relationship_grew_trust",
  attraction: "love_relationship_grew_attraction",
};

/**
 * 关系回顾卡（spec-love-semi-coach §4）：可选、可跳过；只引用自由输入的原话，
 * 全程点选项时只描述剧情、不评价表达。跳过只隐藏本卡片，不写任何状态。
 */
export function RelationshipReviewCard({
  lang,
  review,
  writeFailed,
  onSkip,
}: {
  lang: Lang;
  review: LoveRelationshipReview;
  /** 结算写盘失败时的提示：只在这张卡里出现，不阻塞结局 / 记入统计。 */
  writeFailed: boolean;
  onSkip: () => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-4 rounded-[var(--radius)] border border-line-strong bg-card px-5 py-6 max-w-[var(--measure)]">
      <div>
        <p className="eyebrow">{t(lang, "love_relationship_review_title")}</p>
        <p className="text-[15px] leading-relaxed text-ink mt-2">
          {t(lang, "love_relationship_review_stage")} · {t(lang, stageKey(review.stage))}
        </p>
      </div>

      {review.changes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-ink-3">{t(lang, "love_relationship_review_changes")}</p>
          <ul className="flex flex-col gap-1.5">
            {review.changes.map((change) => (
              <li key={change.dimension} className="text-[13px] leading-relaxed text-ink-2">
                {t(lang, CHANGE_KEYS[change.dimension])}
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.hasFreeText ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-ink-3">{t(lang, "love_relationship_review_quotes")}</p>
          {review.quotes.map((quote, i) => (
            <blockquote
              key={i}
              className="rounded-[var(--radius-sm)] border border-line bg-inset px-3 py-2 text-[13px] leading-relaxed text-ink"
            >
              “{quote}”
            </blockquote>
          ))}
        </div>
      ) : (
        <p className="text-[12px] leading-relaxed text-ink-3">{t(lang, "love_relationship_review_no_quote")}</p>
      )}

      {review.hasFreeText && review.advice.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-ink-3">{t(lang, "love_relationship_review_advice")}</p>
          <ul className="flex flex-col gap-1.5">
            {review.advice.map((advice, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-ink-2">{advice}</li>
            ))}
          </ul>
        </div>
      )}

      {writeFailed && (
        <p role="alert" className="text-[12px] leading-relaxed text-danger">
          {t(lang, "love_relationship_write_failed")}
        </p>
      )}

      <button
        type="button"
        onClick={onSkip}
        className="press min-h-11 rounded-[var(--radius-sm)] border border-line-strong bg-card text-[14px] text-ink"
      >
        {t(lang, "love_relationship_review_skip")}
      </button>
    </div>
  );
}

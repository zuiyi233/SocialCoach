"use client";
import type { Lang } from "@/data/taxonomy";
import { t } from "@/lib/i18n";
import { careLine, type LoveRelationshipState } from "@/lib/love-relationship";

/**
 * 开场主动关心卡（spec-love-semi-coach §3.3）：台词库零模型调用、确定性选择。
 * 只在真正显示时由 PlayScene 调 `markCareShown` + 写盘一次；这里只展示与关闭，
 * 不写任何状态（预算与 24h 窗口由上层 `shouldOfferCare` 把关）。
 */
export function RelationshipCareCard({
  lang,
  state,
  onDismiss,
}: {
  lang: Lang;
  state: LoveRelationshipState;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="mt-3 flex flex-col gap-2 rounded-[var(--radius)] border border-line-strong bg-card px-5 py-4 max-w-[var(--measure)]"
    >
      <p className="eyebrow text-[11px]">{t(lang, "love_relationship_care_title")}</p>
      <p className="text-[14px] leading-relaxed text-ink">{careLine(state, lang)}</p>
      <p className="text-[12px] leading-relaxed text-ink-3">{t(lang, "love_relationship_care_hint")}</p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="press min-h-9 rounded-[var(--radius-sm)] border border-line px-3 text-[12px] text-ink-2"
        >
          {t(lang, "love_relationship_care_dismiss")}
        </button>
      </div>
    </div>
  );
}

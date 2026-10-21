"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Lang } from "@/data/taxonomy";
import { t } from "@/lib/i18n";
import { readLoveReaderSettings } from "@/lib/love-reader-settings";
import { readAllLoveRelationships } from "@/lib/love-story";
import {
  careLine,
  deriveStage,
  shouldOfferCare,
  stageKey,
  type LoveRelationshipState,
} from "@/lib/love-relationship";
import { LOVE_SERIES } from "@/data/corpus/love-series";

/** 从 characterKey（seriesId:characterId 或 scenarioId:characterId）推继续入口；匹配不到返回 null。 */
function relationshipHref(key: string): string | null {
  const sep = key.indexOf(":");
  if (sep <= 0) return null;
  const prefix = key.slice(0, sep);
  if (!prefix) return null;
  if (LOVE_SERIES.some((ser) => ser.id === prefix)) return `/love/play/series/${prefix}`;
  return `/love/play/${prefix}`;
}

interface Row {
  state: LoveRelationshipState;
  href: string | null;
}

/**
 * `/love` 的关系回访卡（spec-love-semi-coach §3.3）：只读展示定性状态。
 * 选 updatedAt 最新且 `shouldOfferCare` 为 true 的一条显示关心台词；再列最多 3 条关系
 * （角色名快照 + 阶段 + 继续入口）。组件自身不写状态——`markCareShown` 只在 PlayScene 做，
 * 避免每次进页都消耗主动关心的预算。
 */
export function RelationshipReturnCard({ lang }: { lang: Lang }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [careState, setCareState] = useState<LoveRelationshipState | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      const reader = readLoveReaderSettings();
      const now = Date.now();
      const states = Object.values(readAllLoveRelationships()).sort((a, b) => b.updatedAt - a.updatedAt);
      const candidate = states.find((s) => shouldOfferCare(s, { now, enabled: reader.care })) ?? null;
      const list = (candidate ? states.filter((s) => s !== candidate) : states)
        .slice(0, candidate ? 2 : 3)
        .map((state) => ({ state, href: relationshipHref(state.characterKey) }));
      setCareState(candidate);
      setRows(list);
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  if (!rows) return null;
  if (!careState && rows.length === 0) return null;
  const careHref = careState ? relationshipHref(careState.characterKey) : null;
  const careName = careState?.characterName ? careState.characterName[lang] : null;
  const stageLabel = (state: LoveRelationshipState) => t(lang, stageKey(deriveStage(state)));

  return (
    <section aria-label={t(lang, "love_relationship_return_title")} className="card p-5 flex flex-col gap-4">
      <p className="eyebrow">{t(lang, "love_relationship_return_title")}</p>

      {careState && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-line bg-inset px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {careName && <span className="text-[13px] font-semibold text-ink">{careName}</span>}
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">{stageLabel(careState)}</span>
          </div>
          <p className="text-[14px] leading-relaxed text-ink">{careLine(careState, lang)}</p>
          <p className="text-[12px] leading-relaxed text-ink-3">{t(lang, "love_relationship_return_note")}</p>
          {careHref && (
            <Link href={careHref} className="press mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-accent-deep">
              {t(lang, "love_relationship_continue")}
              <ArrowRight size={15} className="shrink-0" />
            </Link>
          )}
        </div>
      )}

      {(rows.length > 0 || careState) && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-ink-3">{t(lang, "love_relationship_list_title")}</p>
          <ul className="flex flex-col gap-2">
            {rows.map(({ state, href }) => {
              const name = state.characterName ? state.characterName[lang] : null;
              return (
                <li key={state.characterKey} className="flex flex-wrap items-center gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {name && <span className="truncate text-[13px] text-ink-2">{name}</span>}
                    <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">{stageLabel(state)}</span>
                  </span>
                  {href && (
                    <Link href={href} className="press ml-auto inline-flex items-center gap-1 text-[12px] text-accent-deep">
                      {t(lang, "love_relationship_continue")}
                      <ArrowRight size={14} className="shrink-0" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

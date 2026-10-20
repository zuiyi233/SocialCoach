"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Empty, Page } from "@/components/ui";
import { ScenarioCover } from "@/components/ScenarioCover";
import { SCENARIOS } from "@/data/corpus";
import type { Scenario } from "@/data/corpus/types";
import { buildLoveEndingGallery, loveGalleryLabel, type LoveGalleryEntry } from "@/lib/love-endings";
import { readLoveStoryStore } from "@/lib/love-story";
import { useApp, useLang } from "@/store/useApp";
import { t } from "@/lib/i18n";

/** 结局图鉴：只列已经走到过的结局，避免把未解锁的路线当提示剧透。 */
export function EndingGallery() {
  const lang = useLang();
  const customScenarios = useApp((s) => s.customScenarios);
  const [entries, setEntries] = useState<LoveGalleryEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      const read = readLoveStoryStore();
      setEntries(read.status === "ok" ? buildLoveEndingGallery(read.store.records) : []);
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  const findScenario = (id: string): Scenario | null =>
    SCENARIOS.find((s) => s.id === id) ?? customScenarios.find((s) => s.id === id) ?? null;

  const endingLabel = (entry: LoveGalleryEntry) =>
    loveGalleryLabel(entry, lang) ?? t(lang, `love_play_outcome_${entry.outcome}` as "love_play_outcome_success");

  return (
    <Shell>
      <Page className="pt-5 lg:pt-10 flex flex-col gap-6 lg:gap-8">
        <header className="pb-6 border-b border-line flex items-start gap-3">
          <Link
            href="/love"
            aria-label={t(lang, "love_play_back_love")}
            className="press h-11 w-11 -ml-2 inline-flex items-center justify-center rounded-full text-ink-2 hover:bg-inset shrink-0"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="min-w-0">
            <p className="eyebrow mb-3 text-accent-deep">{t(lang, "love_gallery_eyebrow")}</p>
            <h1 className="display text-[26px] md:text-[32px] leading-tight">{t(lang, "love_gallery_title")}</h1>
            <p className="text-[13px] text-ink-3 mt-2 max-w-[var(--measure)]">{t(lang, "love_gallery_sub")}</p>
          </div>
        </header>

        {entries === null ? (
          <p className="text-[13px] text-ink-3" role="status">{t(lang, "loading")}</p>
        ) : entries.length === 0 ? (
          <Empty
            title={t(lang, "love_gallery_empty")}
            body={t(lang, "love_gallery_empty_body")}
            action={
              <Link href="/love" className="app-button press inline-flex min-h-11 items-center rounded-[var(--radius-sm)] bg-action px-4 text-[13px] font-semibold text-accent-ink">
                {t(lang, "love_gallery_back")}
              </Link>
            }
          />
        ) : (
          <>
            <p className="text-[12px] text-ink-3">
              {t(lang, "love_gallery_count", { n: entries.length })}
            </p>
            <div className="flex flex-col gap-3">
              {entries.map((entry) => {
                const scenario = findScenario(entry.scenarioId);
                return (
                  <Link
                    key={entry.key}
                    href={`/love/play/${entry.scenarioId}`}
                    className="press group card card-link text-left p-4 md:p-5 flex items-start gap-3 md:gap-5"
                  >
                    {scenario ? (
                      <ScenarioCover scenario={scenario} size={48} />
                    ) : (
                      <span className="h-12 w-12 shrink-0 rounded-[var(--radius-sm)] bg-inset" aria-hidden />
                    )}
                    <span className="flex-1 min-w-0 flex flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-accent-soft px-2 py-0.5 text-[11px] text-accent-deep">
                          {endingLabel(entry)}
                        </span>
                        <span className="font-semibold text-[15px] leading-snug">
                          {scenario ? scenario.title[lang] : entry.scenarioId}
                        </span>
                      </span>
                      <span className="text-[12px] text-ink-3">
                        {t(lang, "love_gallery_seen_times", { n: entry.count })}
                      </span>
                    </span>
                    <ArrowRight size={17} className="shrink-0 mt-1 text-ink-3 group-hover:text-accent-deep hidden md:block" />
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </Page>
    </Shell>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Play } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Page } from "@/components/ui";
import { ScenarioCover } from "@/components/ScenarioCover";
import type { LoveSeries } from "@/data/corpus/love-series";
import { useLang } from "@/store/useApp";
import { t } from "@/lib/i18n";
import { readLoveSeriesProgress, type LoveSeriesProgress } from "@/lib/love-series-progress";

/** 剧情线入口页：线名/走向 + 线内进度 + 场景列表（已完成打勾）。进度只存在设备端。 */
export function SeriesPlay({ series }: { series: LoveSeries }) {
  const lang = useLang();
  const router = useRouter();
  // 挂载后再读 localStorage：服务端首屏渲染没有存储，统一以 null 起始避免 hydration 不一致。
  // 读取放在定时回调里（非同步 setState），同时避免渲染期直接 setState 的级联渲染。
  const [progress, setProgress] = useState<LoveSeriesProgress | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      if (alive) setProgress(readLoveSeriesProgress(series.id));
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [series.id]);

  const total = series.scenarios.length;
  const doneCount = progress ? series.scenarios.filter((s) => progress.completed.includes(s.id)).length : 0;
  // 继续入口：优先最近玩过的场景，校验它仍属于这条线；否则从头开始。
  const nextId = progress && series.scenarios.some((s) => s.id === progress.lastScene) ? progress.lastScene : series.scenarios[0].id;
  const flow = series.scenarios.map((s) => s.title[lang]).join(" → ");

  return (
    <Shell>
      <Page className="pt-5 lg:pt-10 flex flex-col gap-6 lg:gap-8">
        <header className="pb-6 border-b border-line flex items-start gap-3">
          <button
            onClick={() => router.push("/love")}
            aria-label={t(lang, "love_play_back_love")}
            className="press h-11 w-11 -ml-2 inline-flex items-center justify-center rounded-full text-ink-2 hover:bg-inset shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <p className="eyebrow mb-3 text-accent-deep">{t(lang, "love_series_arc")}</p>
            <h1 className="display text-[26px] md:text-[32px] leading-tight break-words">{series.name[lang]}</h1>
            <p className="text-[13px] text-ink-3 mt-2">{t(lang, "love_series_progress", { n: doneCount, total })}</p>
            <p className="text-[13px] text-ink-2 mt-1">{flow}</p>
          </div>
        </header>

        <Link href={`/love/play/${nextId}`} className="press card card-link text-left p-5 flex items-center gap-4">
          <span className="shrink-0 w-12 h-12 rounded-full grid place-items-center bg-accent-soft text-accent-deep">
            <Play size={22} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-[16px] leading-snug">
              {doneCount === 0 ? t(lang, "love_series_start") : doneCount >= total ? t(lang, "love_series_restart") : t(lang, "love_series_continue")}
            </span>
            <span className="block text-[12px] text-ink-3 mt-1">{series.scenarios.find((s) => s.id === nextId)?.title[lang]}</span>
          </span>
          <ArrowRight size={17} className="shrink-0 text-accent-deep" />
        </Link>

        <section aria-label={t(lang, "love_series_scenes")} className="flex flex-col gap-3">
          <h2 className="display text-[20px]">{t(lang, "love_series_scenes")}</h2>
          <div className="flex flex-col gap-3">
            {series.scenarios.map((sc, i) => {
              const isDone = !!progress?.completed.includes(sc.id);
              return (
                <Link
                  key={sc.id}
                  href={`/love/play/${sc.id}`}
                  className="press group card card-link text-left p-4 md:p-5 flex items-start gap-3 md:gap-5"
                >
                  <ScenarioCover scenario={sc} size={48} />
                  <span className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-accent-deep">{t(lang, "love_series_act", { n: i + 1 })}</span>
                      <span className="font-semibold text-[15px] leading-snug">{sc.title[lang]}</span>
                      {isDone && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-teal-soft text-teal px-2 py-0.5 text-[11px]">
                          <Check size={12} />
                          {t(lang, "love_series_done")}
                        </span>
                      )}
                    </span>
                    <span className="text-[13px] text-ink-2 leading-relaxed max-w-[var(--measure)]">{sc.hook[lang]}</span>
                  </span>
                  <ArrowRight size={17} className="shrink-0 mt-1 text-ink-3 group-hover:text-accent-deep hidden md:block" />
                </Link>
              );
            })}
          </div>
        </section>
      </Page>
    </Shell>
  );
}
"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Play } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Button, Page, Sheet } from "@/components/ui";
import { ScenarioCover } from "@/components/ScenarioCover";
import type { LoveSeries } from "@/data/corpus/love-series";
import { useLang } from "@/store/useApp";
import { t } from "@/lib/i18n";
import { readLovePlaySave, readLoveStoryStore, resetLovePlayScenes } from "@/lib/love-story";
import { pickNextLoveScene, sortLoveScenes, type PlayingSceneLike } from "@/lib/love-play-save-view";
import {
  forgetLoveSeriesScenes,
  readLoveSeriesProgressState,
  shouldRefreshLoveSlots,
  type LoveSeriesProgress,
} from "@/lib/love-series-progress";
import { RIO_SERIES_ID } from "@/lib/love-relationship-state";
import { subscribeLoveSlots } from "@/lib/love-slot-events";

/** 剧情线入口页：线名/走向 + 线内进度 + 场景列表（已完成打勾）。进度只存在设备端。 */
export function SeriesPlay({ series }: { series: LoveSeries }) {
  const lang = useLang();
  const router = useRouter();
  // 挂载后再读 localStorage：服务端首屏渲染没有存储，统一以 null 起始避免 hydration 不一致。
  // 读取放在定时回调里（非同步 setState），同时避免渲染期直接 setState 的级联渲染。
  const [progress, setProgress] = useState<LoveSeriesProgress | null>(null);
  const [progressIssue, setProgressIssue] = useState<"corrupt" | null>(null);
  const [playing, setPlaying] = useState<PlayingSceneLike[]>([]);
  /** 章节选择：选中一幕先给清除范围与警告，确认后才真正重玩。 */
  const [chapterOpen, setChapterOpen] = useState(false);
  const [chapterPick, setChapterPick] = useState<number | null>(null);
  const [chapterFailed, setChapterFailed] = useState(false);
  // 幕序以 `series.order` 为准，缺省按数组下标补在后面；不能再用 lastScene 当「下一幕」。
  const scenes = useMemo(() => sortLoveScenes(series.scenarios), [series.scenarios]);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    // 挂载与事件刷新走同一条读取路径：进度 + 排序后每一场 story save 里的 playing。
    const read = () => {
      if (!alive) return;
      const progressState = readLoveSeriesProgressState(series.id);
      setProgress(progressState.progress);
      // 坏字节不被下一次写入覆盖（G04）；页面仍可用第一条未完成幕，只把事实说清楚。
      setProgressIssue(progressState.status === "corrupt" ? "corrupt" : null);
      // 进行中的幕优先：读排序后每一场的 story save，只取 playing，交由纯函数挑最近更新的一幕。
      const active: PlayingSceneLike[] = [];
      for (const scene of scenes) {
        const readSave = readLovePlaySave(scene.id);
        if (readSave.status === "ok" && readSave.save?.status === "playing") {
          active.push({ id: scene.id, updatedAt: readSave.save.updatedAt });
        }
      }
      setPlaying(active);
    };
    // 存储只在挂载后读；同标签页写入由 CustomEvent、跨标签页由 storage 事件触发。
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, 0);
    };
    schedule();
    const unsubscribe = subscribeLoveSlots((key) => {
      if (shouldRefreshLoveSlots(key, series.id)) schedule();
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [series.id, scenes]);

  const total = scenes.length;
  // 同一人物贯穿的线才用「第 N 幕」；换人的线是主题合集，用「第 N 场」，
  // 否则用户会以为旧线也是连续剧情。
  const continuous = series.continuous;
  const doneCount = progress ? scenes.filter((s) => progress.completed.includes(s.id)).length : 0;
  const choice = pickNextLoveScene(scenes, progress?.completed ?? [], playing);
  const nextId = choice?.scene.id ?? scenes[0]?.id ?? "";
  const flow = scenes.map((s) => s.title[lang]).join(continuous ? " → " : " · ");

  // CTA 口径：有进行中 → 继续；没玩过 → 开始；全完成 → 第一幕重玩；其余 → 继续。
  const ctaLabel = !choice || choice.mode === "replay"
    ? doneCount >= total && total > 0
      ? t(lang, "love_series_restart")
      : continuous ? t(lang, "love_series_start") : t(lang, "love_pack_start")
    : choice.mode === "playing"
      ? continuous ? t(lang, "love_series_continue") : t(lang, "love_pack_continue")
      : doneCount === 0
        ? continuous ? t(lang, "love_series_start") : t(lang, "love_pack_start")
        : continuous ? t(lang, "love_series_continue") : t(lang, "love_pack_continue");

  /**
   * 从第 index 幕重玩：先删这一幕及之后的自动档/手动槽，再把系列进度里对应的完成记录抹掉。
   * 关系账本只有 Rio 用；重玩第 4 幕或更早时必须一起清掉，否则新路线会读到旧路线的事实。
   * 任一处状态不可安全写入（损坏/不可用）就不做任何改动，避免只清一半。
   */
  const replayFrom = (index: number) => {
    const progressState = readLoveSeriesProgressState(series.id);
    const story = readLoveStoryStore();
    if (
      progressState.status === "corrupt" ||
      progressState.status === "unavailable" ||
      story.status === "corrupt" ||
      story.status === "incompatible" ||
      story.status === "unavailable"
    ) {
      setChapterFailed(true);
      return;
    }
    const ids = scenes.slice(index).map((s) => s.id);
    const clearRoute = series.id === RIO_SERIES_ID && index + 1 <= 4;
    const result = resetLovePlayScenes(ids, {
      seriesId: clearRoute ? series.id : undefined,
      expectedRevision: story.status === "ok" ? story.store.revision : 0,
    });
    if (!result.ok) {
      setChapterFailed(true);
      return;
    }
    // 保留下来的完成幕里最大的幕号；一幕不剩时显式清掉 lastAct。
    const kept = progressState.progress.completed.filter((id) => !ids.includes(id));
    let lastAct: number | null = null;
    for (let i = index - 1; i >= 0; i--) {
      if (kept.includes(scenes[i].id)) {
        lastAct = i + 1;
        break;
      }
    }
    forgetLoveSeriesScenes(series.id, ids, lastAct);
    setChapterOpen(false);
    setChapterPick(null);
    setChapterFailed(false);
    router.push(`/love/play/${scenes[index].id}`);
  };

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
            <p className="eyebrow mb-3 text-accent-deep">{continuous ? t(lang, "love_series_arc") : t(lang, "love_series_theme")}</p>
            <h1 className="display text-[26px] md:text-[32px] leading-tight break-words">{series.name[lang]}</h1>
            <p className="text-[13px] text-ink-3 mt-2">{t(lang, "love_series_progress", { n: doneCount, total })}</p>
            <p className="text-[13px] text-ink-2 mt-1">{flow}</p>
          </div>
        </header>

        {progressIssue === "corrupt" && (
          <p role="status" className="rounded-[var(--radius-sm)] bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink-2">
            {t(lang, "love_series_progress_corrupt")}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Link href={`/love/play/${nextId}`} className="press card card-link text-left p-5 flex items-center gap-4">
            <span className="shrink-0 w-12 h-12 rounded-full grid place-items-center bg-accent-soft text-accent-deep">
              <Play size={22} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-[16px] leading-snug">{ctaLabel}</span>
              <span className="block text-[12px] text-ink-3 mt-1">{choice?.scene.title[lang] ?? ""}</span>
              {choice?.mode === "playing" && (
                <span className="block text-[11px] text-accent-deep mt-1">{t(lang, "love_series_in_progress")}</span>
              )}
            </span>
            <ArrowRight size={17} className="shrink-0 text-accent-deep" />
          </Link>
          <button
            type="button"
            onClick={() => {
              setChapterOpen(true);
              setChapterPick(null);
              setChapterFailed(false);
            }}
            className="press self-end min-h-11 px-2 text-[12px] text-ink-3 underline underline-offset-4 hover:text-ink"
          >
            {t(lang, "love_chapter_select")}
          </button>
        </div>

        <section aria-label={continuous ? t(lang, "love_series_scenes") : t(lang, "love_pack_scenes")} className="flex flex-col gap-3">
          <h2 className="display text-[20px]">{continuous ? t(lang, "love_series_scenes") : t(lang, "love_pack_scenes")}</h2>
          <div className="flex flex-col gap-3">
            {scenes.map((sc, i) => {
              const isDone = !!progress?.completed.includes(sc.id);
              const isPlaying = playing.some((p) => p.id === sc.id);
              return (
                <Link
                  key={sc.id}
                  href={`/love/play/${sc.id}`}
                  className="press group card card-link text-left p-4 md:p-5 flex items-start gap-3 md:gap-5"
                >
                  <ScenarioCover scenario={sc} size={48} />
                  <span className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-accent-deep">{continuous ? t(lang, "love_series_act", { n: i + 1 }) : t(lang, "love_series_scene", { n: i + 1 })}</span>
                      <span className="font-semibold text-[15px] leading-snug">{sc.title[lang]}</span>
                      {isDone && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-teal-soft text-teal px-2 py-0.5 text-[11px]">
                          <Check size={12} />
                          {t(lang, "love_series_done")}
                        </span>
                      )}
                      {isPlaying && !isDone && (
                        <span className="inline-flex items-center rounded-full border border-line-strong px-2 py-0.5 text-[11px] text-ink-3">
                          {t(lang, "love_series_in_progress")}
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

        {/* 章节选择：列出每一幕；选中后先说明会清掉什么，再确认。 */}
        <Sheet
          open={chapterOpen}
          onClose={() => {
            setChapterOpen(false);
            setChapterPick(null);
            setChapterFailed(false);
          }}
          title={t(lang, "love_chapter_select")}
        >
          <div className="flex flex-col gap-3 pt-2">
            <p className="text-[12px] leading-relaxed text-ink-3">{t(lang, "love_chapter_hint")}</p>
            {chapterFailed && (
              <p role="alert" className="rounded-[var(--radius-sm)] bg-danger-soft px-3 py-2 text-[12px] leading-relaxed text-danger">
                {t(lang, "love_chapter_failed")}
              </p>
            )}
            <div className="flex flex-col gap-2">
              {scenes.map((sc, i) => {
                const isDone = !!progress?.completed.includes(sc.id);
                const isPlaying = playing.some((p) => p.id === sc.id);
                const selected = chapterPick === i;
                return (
                  <div key={sc.id} className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-line bg-card p-3">
                    <button
                      type="button"
                      onClick={() => setChapterPick(selected ? null : i)}
                      aria-expanded={selected}
                      className="press flex min-h-11 w-full items-center gap-2 text-left"
                    >
                      <span className="text-[11px] text-accent-deep">
                        {continuous ? t(lang, "love_series_act", { n: i + 1 }) : t(lang, "love_series_scene", { n: i + 1 })}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-[13px] font-semibold">{sc.title[lang]}</span>
                      {isDone && <span className="shrink-0 text-[11px] text-teal">{t(lang, "love_series_done")}</span>}
                      {isPlaying && !isDone && (
                        <span className="shrink-0 text-[11px] text-ink-3">{t(lang, "love_series_in_progress")}</span>
                      )}
                    </button>
                    {selected && (
                      <div className="rounded-[var(--radius-sm)] bg-inset px-3 py-2" role="alertdialog" aria-label={t(lang, "love_chapter_select")}>
                        <p className="text-[12px] leading-relaxed text-ink-2">
                          {t(lang, continuous ? "love_chapter_warning_act" : "love_chapter_warning_scene", { n: i + 1 })}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="ink" onClick={() => replayFrom(i)}>
                            {t(lang, "love_chapter_confirm")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setChapterPick(null)}>
                            {t(lang, "cancel")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Sheet>
      </Page>
    </Shell>
  );
}

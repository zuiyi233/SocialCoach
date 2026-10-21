"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArrowRight, GraduationCap, Play, Trophy, UserRound } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Chip, Empty, Page } from "@/components/ui";
import { SkillTag } from "@/components/SkillBits";
import { ScenarioCover } from "@/components/ScenarioCover";
import { LoveProficiency } from "@/components/LoveProficiency";
import { LoveCarryFollowUp } from "@/components/love/LoveCarryFollowUp";
import { LoveEntry } from "@/components/love/LoveEntry";
import { RelationshipReturnCard } from "@/components/love/RelationshipReturnCard";
import { SCENARIOS, THEORIES, CASES } from "@/data/corpus";
import type { Scenario } from "@/data/corpus/types";
import { LOVE_TOPICS, loveTopicById, type LoveTopicId } from "@/data/corpus/love-topics";
import { LOVE_SERIES } from "@/data/corpus/love-series";
import { readLoveSeriesProgress } from "@/lib/love-series-progress";
import { buildLoveEndingGallery } from "@/lib/love-endings";
import { readLoveStoryStore, type LovePlayRecord } from "@/lib/love-story";
import { useApp, useLang, useLoveProficiency } from "@/store/useApp";
import { t } from "@/lib/i18n";
import { buildSession } from "@/lib/session-utils";

export default function Love() {
  const lang = useLang();
  const router = useRouter();
  const { sessions, customScenarios, addSession } = useApp();
  const love = useLoveProficiency();
  const [topic, setTopic] = useState<LoveTopicId | null>(null);
  const starting = useRef(false);
  /** 设备端剧情记录：完成数与真实分钟只从这里来，不等同于练习 session。 */
  const [records, setRecords] = useState<LovePlayRecord[] | null>(null);

  const loveScenarios = useMemo(
    () => [...customScenarios.filter((s) => s.context === "romantic"), ...SCENARIOS.filter((s) => s.context === "romantic" && !s.custom)],
    [customScenarios],
  );
  const loveTheories = useMemo(() => THEORIES.filter((t) => t.loveTopic), []);
  const loveCases = useMemo(() => CASES.filter((c) => c.loveTopic || c.context === "romantic"), []);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) if (s.status === "assessed") map.set(s.scenario.id, (map.get(s.scenario.id) ?? 0) + 1);
    // 剧情局只写记录、不写练习 session；推荐「还没练过」时必须把记录并进来，
    // 否则刚走完的剧情仍被当成没玩过（G21）。
    for (const r of records ?? []) map.set(r.scenarioId, (map.get(r.scenarioId) ?? 0) + 1);
    return map;
  }, [sessions, records]);
  /** Unfiltered list grouped by love topic so sibling scenes sit together; scenes without a topic go last. */
  const ordered = useMemo(() => {
    const order = new Map(LOVE_TOPICS.map((t, i) => [t.id, i]));
    return [...loveScenarios].sort((a, b) => {
      if (a.loveTopic === b.loveTopic) return 0;
      if (!a.loveTopic) return 1;
      if (!b.loveTopic) return -1;
      return (order.get(a.loveTopic) ?? 0) - (order.get(b.loveTopic) ?? 0);
    });
  }, [loveScenarios]);
  const list = useMemo(() => (topic ? ordered.filter((s) => s.loveTopic === topic) : ordered), [topic, ordered]);
  const stats = useMemo(() => {
    // 完成数 / 分钟来自设备端 `LovePlayRecord`（G21）：剧情局不再生成练习
    // session，用 session 快照算会把「记入统计」后的数字停在原地。分钟按
    // 真实开局到收尾的时间取整，至少 1 分钟，与练习页口径一致。
    // 星级仍只能来自经教练复盘的 assessed session —— 记录里没有星级。
    const recorded = records ?? [];
    const assessed = sessions.filter((s) => s.status === "assessed" && s.scenario.context === "romantic");
    return {
      count: recorded.length,
      minutes: recorded.reduce((a, r) => a + Math.max(1, Math.round((r.endedAt - r.startedAt) / 60000)), 0),
      stars: assessed.reduce((a, s) => a + (s.report && s.report.scoringVersion === 2 ? s.report.stars : 0), 0),
    };
  }, [sessions, records]);
  const gallery = useMemo(() => buildLoveEndingGallery(records ?? []), [records]);
  /** Least-practiced topic with an unseen scene: a gentle "what to do next". */
  const nextPick = useMemo(() => {
    const unseen = loveScenarios.filter((s) => !counts.has(s.id) && s.loveTopic);
    if (!unseen.length) return null;
    return [...unseen].sort((a, b) => (love[a.loveTopic!] ?? 2.5) - (love[b.loveTopic!] ?? 2.5))[0];
  }, [loveScenarios, counts, love]);
  /** 教练带练是次要入口：主入口进剧情，只有明确点「教练带练」才建练习 session。 */
  const startCoach = (scenario: Scenario) => {
    if (starting.current) return;
    starting.current = true;
    const session = buildSession(scenario, scenario.custom ? "rehearse" : "arena", lang);
    addSession(session);
    router.push(`/practice/${session.id}`);
  };
  /**
   * 记录与各剧情线的完成数都在挂载后再读 localStorage：服务端首屏没有存储，
   * 统一以 null 起始避免 hydration 不一致（与 SeriesPlay 同一口径）。
   * 记录槽损坏/不可用时只是没有记录可算，不阻断页面。
   */
  const [seriesDone, setSeriesDone] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      const story = readLoveStoryStore();
      setRecords(story.status === "ok" ? story.store.records : []);
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      const map: Record<string, number> = {};
      for (const ser of LOVE_SERIES) {
        const p = readLoveSeriesProgress(ser.id);
        map[ser.id] = ser.scenarios.filter((s) => p.completed.includes(s.id)).length;
      }
      setSeriesDone(map);
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <Shell>
      <Page className="pt-5 lg:pt-10 flex flex-col gap-7 lg:gap-9">
        <header className="pb-6 border-b border-line">
          <p className="eyebrow mb-3 text-accent-deep">{t(lang, "love_eyebrow")}</p>
          <h1 className="display text-[29px] md:text-[34px] lg:text-[38px] leading-tight whitespace-pre-line">{t(lang, "love_heading")}</h1>
          <p className="text-[14px] text-ink-3 mt-3 max-w-[var(--measure)]">{t(lang, "love_sub")}</p>
        </header>

        {/* 跟进卡排在最上面：这一趟来访要问的那一句，比列表里还有什么可练更近。 */}
        <LoveCarryFollowUp lang={lang} />

        {/* 两个主入口并列：Studio（初始实践）与剧情模式（继续关系）。 */}
        <LoveEntry lang={lang} />

        {/* 关系回访卡：最近一段关系的近况 + 主动关心；只读展示，不消耗预算。 */}
        <RelationshipReturnCard lang={lang} />

        {/* 人设编辑器：与两个入口同级的一张卡，排在入口段下面。 */}
        <Link href="/love/persona" className="press card card-link p-4 flex items-center gap-3">
          <span className="shrink-0 w-10 h-10 rounded-full grid place-items-center bg-accent-soft text-accent-deep">
            <UserRound size={19} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-[14px]">{t(lang, "love_persona_entry_title")}</span>
            <span className="block text-[12px] text-ink-3 mt-0.5">{t(lang, "love_persona_entry_sub")}</span>
          </span>
          <ArrowRight size={17} className="shrink-0 text-accent-deep" />
        </Link>

        <Link href="/love/archive" className="press card card-link p-4 flex items-center gap-3">
          <span className="shrink-0 w-10 h-10 rounded-full grid place-items-center bg-accent-soft text-accent-deep">
            <Archive size={19} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-[14px]">{t(lang, "love_archive_entry_title")}</span>
            <span className="block text-[12px] text-ink-3 mt-0.5">{t(lang, "love_archive_entry_sub")}</span>
          </span>
          <ArrowRight size={17} className="shrink-0 text-accent-deep" />
        </Link>

        {LOVE_SERIES.length > 0 && (
          <section id="love-series" aria-label={t(lang, "love_mode_title")} className="flex flex-col gap-3 scroll-mt-24">
            <div>
              <h2 className="display text-[20px]">{t(lang, "love_mode_title")}</h2>
              <p className="text-[12px] text-ink-3 mt-1">{t(lang, "love_mode_sub")}</p>
            </div>
            <div className="flex flex-col gap-3">
              {LOVE_SERIES.map((ser) => {
                const total = ser.scenarios.length;
                const done = seriesDone?.[ser.id] ?? 0;
                return (
                  <Link
                    key={ser.id}
                    href={`/love/play/series/${ser.id}`}
                    className="press card card-link text-left p-5 flex items-center gap-4"
                  >
                    <span className="shrink-0 w-12 h-12 rounded-full grid place-items-center bg-accent-soft text-accent-deep">
                      <Play size={22} />
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="block font-semibold text-[16px] leading-snug">{ser.name[lang]}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${ser.continuous ? "border-accent-soft text-accent-deep" : "border-line text-ink-3"}`}>
                          {ser.continuous ? t(lang, "love_series_cast") : t(lang, "love_series_theme")}
                        </span>
                      </span>
                      <span className="block text-[12px] text-ink-3">{t(lang, "love_series_progress", { n: done, total })}</span>
                      <span className="block text-[12px] text-ink-2 leading-relaxed">
                        {ser.scenarios.map((s) => s.title[lang]).join(ser.continuous ? " → " : " · ")}
                      </span>
                    </span>
                    <ArrowRight size={17} className="shrink-0 text-accent-deep" />
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <section aria-label={t(lang, "love_topics")} className="flex flex-col gap-3">
          <h2 className="display text-[20px]">{t(lang, "love_topics")}</h2>
          <div className="flex gap-2 flex-wrap">
            <Chip active={topic === null} onClick={() => setTopic(null)}>
              {t(lang, "love_all")}
              <span className="num opacity-70">{loveScenarios.length}</span>
            </Chip>
            {LOVE_TOPICS.map((top) => (
              <Chip key={top.id} active={topic === top.id} onClick={() => setTopic(topic === top.id ? null : top.id)}>
                {top.name[lang]}
                <span className="num opacity-70">{loveScenarios.filter((s) => s.loveTopic === top.id).length}</span>
              </Chip>
            ))}
          </div>
        </section>

        {nextPick && (
          <Link href={`/love/play/${nextPick.id}`} className="press card card-link text-left p-5 flex items-center gap-4">
            <ScenarioCover scenario={nextPick} size={48} />
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] text-ink-3 mb-1">{t(lang, "love_next")}</span>
              <span className="block font-semibold text-[16px] leading-snug">{nextPick.title[lang]}</span>
            </span>
            <ArrowRight size={17} className="shrink-0 text-accent-deep" />
          </Link>
        )}

        <section aria-label={t(lang, "love_stats")} className="grid grid-cols-3 gap-3">
          <div className="card p-4 flex flex-col gap-1">
            <span className="num text-[22px] leading-none">{stats.count}</span>
            <span className="text-[12px] text-ink-3">{t(lang, "love_practices", { n: stats.count })}</span>
          </div>
          <div className="card p-4 flex flex-col gap-1">
            <span className="num text-[22px] leading-none">{stats.minutes}</span>
            <span className="text-[12px] text-ink-3">{t(lang, "love_minutes", { n: stats.minutes })}</span>
          </div>
          <div className="card p-4 flex flex-col gap-1">
            <span className="num text-[22px] leading-none">{stats.stars}</span>
            <span className="text-[12px] text-ink-3">{t(lang, "love_stars", { n: stats.stars })}</span>
          </div>
        </section>

        <Link href="/love/endings" className="press card card-link p-4 flex items-center gap-3">
          <span className="shrink-0 w-10 h-10 rounded-full grid place-items-center bg-accent-soft text-accent-deep">
            <Trophy size={19} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-[14px]">{t(lang, "love_gallery_title")}</span>
            <span className="block text-[12px] text-ink-3 mt-0.5">
              {t(lang, "love_gallery_count", { n: gallery.length })}
            </span>
          </span>
          <ArrowRight size={17} className="shrink-0 text-accent-deep" />
        </Link>

        <section aria-labelledby="proficiency-title" className="flex flex-col gap-3">
          <div>
            <h2 id="proficiency-title" className="display text-[20px]">{t(lang, "love_proficiency")}</h2>
            <p className="text-[12px] text-ink-3 mt-1">{t(lang, "love_proficiency_hint")}</p>
            {stats.count === 0 && <p className="text-[12px] text-ink-3 mt-1">{t(lang, "love_no_progress")}</p>}
          </div>
          <div className="card p-5 flex flex-col gap-3">
            <LoveProficiency love={love} lang={lang} />
          </div>
        </section>

        <section aria-labelledby="scenarios-title">
          <div className="pb-4 border-b border-line-strong">
            <h2 id="scenarios-title" className="display text-[20px]">{t(lang, "love_scenarios")}</h2>
          </div>
          {list.length === 0 && (
            <Empty
              title={t(lang, "love_empty")}
              body=""
              action={
                <Chip active onClick={() => setTopic(null)}>
                  {t(lang, "love_all")}
                </Chip>
              }
            />
          )}
          <div className="flex flex-col">
            {list.map((sc) => {
              const count = counts.get(sc.id) ?? 0;
              return (
                <div
                  key={sc.id}
                  className="notebook-row group flex items-start gap-2 md:gap-4 py-5 md:p-5 -mx-1 px-1"
                >
                  {/* 主入口：剧情模式。教练带练只作为右侧的次要动作，不再抢走默认点击。 */}
                  <Link
                    href={`/love/play/${sc.id}`}
                    className="flex flex-1 min-w-0 items-start gap-3 md:gap-5 text-left"
                  >
                    <ScenarioCover scenario={sc} size={48} />
                    <span className="flex-1 min-w-0 flex flex-col gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[16px] leading-snug">{sc.title[lang]}</span>
                        {sc.series && (
                          <span className="rounded-full border border-accent-soft text-accent-deep px-2 py-0.5 text-[11px]">{sc.series.name[lang]}</span>
                        )}
                        {sc.custom && (
                          <span className="rounded-full bg-accent-soft text-accent-deep px-2 py-0.5 text-[11px]">{t(lang, "custom_badge")}</span>
                        )}
                      </span>
                      <span className="text-[13px] text-ink-2 leading-relaxed max-w-[var(--measure)]">{sc.hook[lang]}</span>
                      <span className="flex flex-wrap items-center gap-2 mt-0.5">
                        {sc.skills.slice(0, 2).map((id) => (
                          <SkillTag key={id} id={id} lang={lang} small />
                        ))}
                        {sc.loveTopic && <span className="text-[12px] text-ink-3">{loveTopicById(sc.loveTopic)?.name[lang]}</span>}
                        <span className="text-[12px] text-ink-3 md:hidden">
                          {sc.minutes} {t(lang, "min")} · {t(lang, `diff_${sc.difficulty}` as "diff_1")}
                        </span>
                        {count > 0 && <span className="text-[11px] text-teal">{t(lang, "arena_practiced", { n: count })}</span>}
                      </span>
                    </span>
                    <span className="hidden md:flex flex-col items-end gap-2 shrink-0 text-[12px] text-ink-3 pt-0.5">
                      <span className="num">
                        {sc.minutes} {t(lang, "min")}
                      </span>
                      <span>{t(lang, `diff_${sc.difficulty}` as "diff_1")}</span>
                    </span>
                    <ArrowRight size={17} className="shrink-0 mt-1 text-ink-3 group-hover:text-accent-deep hidden md:block" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => startCoach(sc)}
                    aria-label={`${t(lang, "love_coach_mode")} · ${sc.title[lang]}`}
                    title={t(lang, "love_coach_mode")}
                    className="press shrink-0 inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-line px-2 text-[11px] text-ink-3 hover:border-line-strong hover:text-ink-2 md:px-3"
                  >
                    <GraduationCap size={16} />
                    <span className="hidden lg:inline">{t(lang, "love_coach_mode")}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="theories-title" className="flex flex-col gap-3">
          <h2 id="theories-title" className="display text-[20px]">{t(lang, "love_theories")}</h2>
          <div className="flex flex-col gap-3">
            {loveTheories.map((th) => (
              <article key={th.id} className="card p-5 flex flex-col gap-2">
                <h3 className="font-semibold text-[15px] leading-snug">{th.title[lang]}</h3>
                <p className="text-[13px] text-ink-2 leading-relaxed max-w-[var(--measure)]">{th.principle[lang]}</p>
                <p className="text-[12px] text-ink-3">
                  {th.source.book}
                  {th.source.author ? ` · ${th.source.author}` : ""}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="cases-title" className="flex flex-col gap-3">
          <h2 id="cases-title" className="display text-[20px]">{t(lang, "love_cases")}</h2>
          <div className="flex flex-col gap-3">
            {loveCases.map((c) => (
              <article key={c.id} className="card p-5 flex flex-col gap-2">
                <h3 className="font-semibold text-[15px] leading-snug">{c.title[lang]}</h3>
                <p className="text-[13px] text-ink-2 leading-relaxed max-w-[var(--measure)]">{c.takeaway[lang]}</p>
                <p className="text-[12px] text-ink-3">
                  {c.source.book}
                  {c.source.author ? ` · ${c.source.author}` : ""}
                </p>
              </article>
            ))}
          </div>
        </section>
      </Page>
    </Shell>
  );
}

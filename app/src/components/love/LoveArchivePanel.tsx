"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Download, FileUp, Trash2 } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Button, Empty, Page } from "@/components/ui";
import { SCENARIOS } from "@/data/corpus";
import { LOVE_SERIES } from "@/data/corpus/love-series";
import type { Scenario } from "@/data/corpus/types";
import { t, type TKey } from "@/lib/i18n";
import { useApp, useLang } from "@/store/useApp";
import {
  addUnlocks,
  appendStoryRecord,
  archiveKey,
  deleteCharacterArchive,
  deleteStoryRecord,
  deriveNarrativeStage,
  readLoveArchive,
  setCanonicalStory,
  upsertCharacterArchive,
  type CharacterArchive,
  type LoveArchive,
  type StoryRecord,
} from "@/lib/love-archive";
import { emptyRelationship, stageKey, type LoveRelationshipTier } from "@/lib/love-relationship";
import {
  buildStoryPack,
  parseStoryPack,
  storyPackFileName,
  storyPackJson,
  type StoryPack,
} from "@/lib/love-story-pack";

const SOURCE_KEY: Record<CharacterArchive["personaSnapshot"]["source"], TKey> = {
  builtin: "love_archive_source_builtin",
  studio: "love_archive_source_studio",
  "love-custom": "love_archive_source_love",
};

const DIMENSION_KEYS = [
  ["familiarity", "love_archive_dim_familiarity"],
  ["trust", "love_archive_dim_trust"],
  ["attraction", "love_archive_dim_attraction"],
] as const;

/** 只有自由输入的原话才会进档案；选项点击不算（spec §4/§6）。 */
function quoteOf(choice: StoryRecord["keyChoices"][number], lang: "zh" | "en"): string | null {
  return choice.quote ? choice.quote[lang] || choice.quote.zh || choice.quote.en : null;
}

function downloadJson(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 把 characterKey 前缀映射回可继续的场景/系列；找不到就不给链接。 */
function continueHref(characterPackId: string): string | null {
  const [prefix] = characterPackId.split(":");
  if (!prefix) return null;
  if (LOVE_SERIES.some((s) => s.id === prefix)) return `/love/play/series/${prefix}`;
  if (SCENARIOS.some((s) => s.id === prefix)) return `/love/play/${prefix}`;
  return null;
}

function sourceName(entry: CharacterArchive, lang: "zh" | "en"): string {
  return entry.personaSnapshot.name[lang] || entry.personaSnapshot.name.zh || entry.characterPackId;
}

/** 从故事包里的 Tavern 卡快照建一个最小档案；关系从陌生开始，导入不替用户涨关系。 */
function characterFromPack(pack: StoryPack, story: StoryRecord, now: number): CharacterArchive | null {
  const card = pack.character as { name?: unknown; description?: unknown } | undefined;
  if (!card || typeof card.name !== "string" || !card.name.trim()) return null;
  const name = card.name.trim();
  const bio = typeof card.description === "string" ? card.description.trim() : story.summary.zh;
  const characterPackId = pack.manifest.characterPackId ?? story.characterPackIds[0] ?? story.id;
  const branchId = story.branchId ?? "main";
  const key = archiveKey(characterPackId, branchId);
  return {
    characterPackId,
    branchId,
    personaSnapshot: {
      name: { zh: name, en: name },
      bio: { zh: bio || name, en: bio || name },
      source: pack.manifest.origin === "studio" ? "studio" : "love-custom",
    },
    relationship: emptyRelationship(key, now, { zh: name, en: name }),
    memoryIds: [],
    activeStoryId: story.id,
  };
}

/** 从一段已导入的故事生成一条 afterstory 自定义场景（续写，不覆盖原故事）。 */
function afterstoryScenario(story: StoryRecord, character: CharacterArchive | null): Scenario {
  const npcId = (character?.characterPackId ?? story.characterPackIds[0] ?? "them").replace(/[^a-zA-Z0-9_-]/g, "-");
  const name = character?.personaSnapshot.name ?? { zh: "对方", en: "Them" };
  return {
    id: `afterstory-${story.id}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    title: { zh: `续写：${story.title.zh}`, en: `Afterstory: ${story.title.en}` },
    hook: { zh: "从上次停下的地方继续。", en: "Continue where you left off." },
    background: story.summary,
    context: "romantic",
    contextType: { zh: "恋爱", en: "Romance" },
    competencies: ["relationship-skills"],
    skills: ["empathy"],
    relationship: ["partner"],
    difficulty: 2,
    minutes: 10,
    characters: [
      {
        id: "you",
        name: { zh: "你", en: "You" },
        role: { zh: "你自己", en: "Yourself" },
        personality: { zh: "按你自己的方式回应。", en: "Respond in your own way." },
        stance: { zh: "想把这段关系继续下去。", en: "You want to keep this relationship going." },
        playable: true,
        hue: 210,
      },
      {
        id: npcId,
        name,
        role: { zh: "故事里的对方", en: "The other person from the story" },
        personality: { zh: "延续之前故事里的性格与说话方式。", en: "Same personality and way of speaking as before." },
        stance: { zh: "愿意把上次没说完的话说完。", en: "Willing to finish what was left unsaid." },
        playable: false,
        hue: 320,
      },
    ],
    objectives: [
      { zh: "把上次没说完的话说完", en: "Finish what was left unsaid" },
      { zh: "给这段关系一个下一步", en: "Agree on a next step" },
    ],
    success: { zh: "你们把话接上了。", en: "You picked the conversation back up." },
    failure: { zh: "这次没有接上，但门还开着。", en: "It didn't land this time, but the door is still open." },
    maxTurns: 8,
    opening: {
      characterId: npcId,
      text: { zh: "上次之后，我一直想着你那句话。", en: "Since last time, I keep thinking about what you said." },
    },
    source: "SocialCoach relationship archive afterstory",
    keywords: ["afterstory", ...story.characterPackIds],
    custom: true,
  };
}

export function LoveArchivePanel() {
  const lang = useLang();
  const router = useRouter();
  const addCustomScenario = useApp((s) => s.addCustomScenario);
  const [archive, setArchive] = useState<LoveArchive | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "empty" | "corrupt" | "incompatible" | "unavailable">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [pack, setPack] = useState<StoryPack | null>(null);
  const [packWarnings, setPackWarnings] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<"full" | "public">("full");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reload = () => {
    const read = readLoveArchive();
    setStatus(read.status);
    setArchive(read.status === "ok" ? read.archive : null);
  };

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      reload();
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  const fail = (reason: string) => setNotice(t(lang, "love_archive_write_failed") + ` (${reason})`);

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setNotice(null);
    try {
      const text = await file.text();
      const parsed = parseStoryPack(text);
      if (!parsed.ok) {
        setNotice(t(lang, "love_archive_import_failed", { reason: parsed.errors.join("; ") }));
        return;
      }
      setPack(parsed.pack);
      setPackWarnings(parsed.warnings);
      setImportMode("full");
    } catch (e) {
      setNotice(t(lang, "love_archive_import_failed", { reason: e instanceof Error ? e.message : String(e) }));
    }
  };

  const applyImport = () => {
    if (!pack || !archive) return;
    setBusy(true);
    setNotice(null);
    try {
      const story: StoryRecord =
        importMode === "public"
          ? { ...pack.story, keyChoices: [] }
          : pack.story;
      const appended = appendStoryRecord(story, archive.revision);
      if (!appended.ok) {
        setNotice(
          appended.reason === "conflict"
            ? t(lang, "love_archive_import_conflict")
            : t(lang, "love_archive_import_failed", { reason: appended.reason }),
        );
        if (appended.reason === "conflict") reload();
        return;
      }
      let revision = appended.archive.revision;
      const character = characterFromPack(pack, story, Date.now());
      if (character) {
        const upserted = upsertCharacterArchive(character, revision);
        if (upserted.ok) revision = upserted.archive.revision;
      }
      const unlocked = addUnlocks(
        {
          characters: character ? [character.characterPackId] : [],
          endings: story.endingId ? [story.endingId] : [],
        },
        revision,
      );
      if (!unlocked.ok) {
        setNotice(t(lang, "love_archive_write_failed"));
        reload();
        return;
      }
      setArchive(unlocked.archive);
      setStatus("ok");
      setPack(null);
      setPackWarnings([]);
      setNotice(t(lang, "love_archive_import_done"));
    } finally {
      setBusy(false);
    }
  };

  const exportStory = (story: StoryRecord) => {
    try {
      const next = buildStoryPack({ story, origin: "love", source: "SocialCoach relationship archive", license: "CC-BY-4.0" });
      downloadJson(storyPackFileName(next), storyPackJson(next));
      setNotice(t(lang, "love_archive_export_done"));
    } catch (e) {
      setNotice(t(lang, "love_archive_import_failed", { reason: e instanceof Error ? e.message : String(e) }));
    }
  };

  const forgetCharacter = (entry: CharacterArchive) => {
    if (!archive) return;
    const name = sourceName(entry, lang);
    if (!window.confirm(t(lang, "love_archive_forget_confirm", { name }))) return;
    const result = deleteCharacterArchive(entry.characterPackId, entry.branchId, archive.revision);
    if (!result.ok) return fail(result.reason);
    setArchive(result.archive);
  };

  const removeStory = (story: StoryRecord) => {
    if (!archive) return;
    if (!window.confirm(t(lang, "love_archive_delete_story_confirm", { title: story.title[lang] }))) return;
    const result = deleteStoryRecord(story.id, archive.revision);
    if (!result.ok) return fail(result.reason);
    setArchive(result.archive);
  };

  const makeCanonical = (story: StoryRecord) => {
    if (!archive) return;
    const result = setCanonicalStory(story.id, true, archive.revision);
    if (!result.ok) return fail(result.reason);
    setArchive(result.archive);
  };

  const startAfterstory = (story: StoryRecord, entry: CharacterArchive | null) => {
    const scenario = afterstoryScenario(story, entry);
    addCustomScenario(scenario);
    router.push(`/love/play/${scenario.id}`);
  };

  const stageLabel = (tier: LoveRelationshipTier) => t(lang, stageKey(tier));
  const characters = archive ? Object.values(archive.characters) : [];
  const stories = archive?.stories ?? [];
  const storyCountFor = (entry: CharacterArchive) =>
    stories.filter(
      (s) =>
        s.characterPackIds.includes(entry.characterPackId) &&
        (s.branchId ?? "main") === entry.branchId,
    );
  const characterForStory = (story: StoryRecord) =>
    characters.find(
      (c) =>
        story.characterPackIds.includes(c.characterPackId) &&
        (story.branchId ?? "main") === c.branchId,
    ) ?? null;

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
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-3 text-accent-deep">{t(lang, "love_archive_eyebrow")}</p>
            <h1 className="display text-[26px] md:text-[32px] leading-tight">{t(lang, "love_archive_title")}</h1>
            <p className="text-[13px] text-ink-3 mt-2 max-w-[var(--measure)]">{t(lang, "love_archive_sub")}</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = "";
              void onPickFile(file);
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            <FileUp size={15} />
            {t(lang, "love_archive_import")}
          </Button>
        </header>

        {notice && (
          <p role="status" className="rounded-[var(--radius-sm)] border border-line bg-card px-4 py-2 text-[13px] leading-relaxed text-ink-2">
            {notice}
          </p>
        )}

        {status === "loading" && <p role="status" className="text-[13px] text-ink-3">{t(lang, "love_archive_loading")}</p>}
        {status === "corrupt" || status === "incompatible" ? (
          <p role="alert" className="text-[13px] text-danger">{t(lang, "love_archive_corrupt")}</p>
        ) : null}
        {status === "empty" && (
          <Empty
            title={t(lang, "love_archive_empty")}
            body={t(lang, "love_archive_empty_body")}
            action={
              <Button size="sm" variant="ink" onClick={() => fileRef.current?.click()}>
                {t(lang, "love_archive_import")}
              </Button>
            }
          />
        )}

        {pack && (
          <section className="card p-5 flex flex-col gap-3" aria-label={t(lang, "love_archive_import_preview")}>
            <p className="eyebrow">{t(lang, "love_archive_import_preview")}</p>
            <p className="text-[15px] font-semibold text-ink">{pack.story.title[lang]}</p>
            <p className="text-[13px] leading-relaxed text-ink-2">{pack.story.summary[lang]}</p>
            <p className="text-[12px] text-ink-3">
              {t(lang, "love_archive_key_choices")}: {pack.story.keyChoices.length} · {pack.story.endingId ?? "—"}
            </p>
            {packWarnings.length > 0 && (
              <div className="rounded-[var(--radius-sm)] bg-inset px-3 py-2">
                <p className="text-[11px] text-ink-3">{t(lang, "love_archive_import_warnings")}</p>
                <ul className="mt-1 list-disc pl-4 text-[12px] text-ink-2">
                  {packWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <label className="flex items-start gap-2 text-[13px] text-ink-2">
              <input type="radio" checked={importMode === "full"} onChange={() => setImportMode("full")} />
              {t(lang, "love_archive_import_mode_full")}
            </label>
            <label className="flex items-start gap-2 text-[13px] text-ink-2">
              <input type="radio" checked={importMode === "public"} onChange={() => setImportMode("public")} />
              {t(lang, "love_archive_import_mode_public")}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ink" loading={busy} onClick={applyImport}>
                {t(lang, "love_archive_import_confirm")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPack(null)}>
                {t(lang, "love_archive_import_cancel")}
              </Button>
            </div>
          </section>
        )}

        {archive && (
          <>
            <section aria-label={t(lang, "love_archive_characters")} className="flex flex-col gap-3">
              <h2 className="display text-[20px]">{t(lang, "love_archive_characters")}</h2>
              {characters.length === 0 && <p className="text-[13px] text-ink-3">{t(lang, "love_archive_no_stories")}</p>}
              <div className="flex flex-col gap-3">
                {characters.map((entry) => {
                  const stage = deriveNarrativeStage(entry.relationship);
                  const href = continueHref(entry.characterPackId);
                  return (
                    <article key={archiveKey(entry.characterPackId, entry.branchId)} className="card p-5 flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[16px] font-semibold text-ink">{sourceName(entry, lang)}</span>
                        <span className="rounded-full border border-accent-soft px-2 py-0.5 text-[11px] text-accent-deep">{stageLabel(stage)}</span>
                        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">
                          {t(lang, SOURCE_KEY[entry.personaSnapshot.source])}
                        </span>
                        <span className="text-[12px] text-ink-3">
                          {t(lang, "love_archive_stories_count", { n: storyCountFor(entry).length })}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {DIMENSION_KEYS.map(([dimension, key]) => (
                          <span key={dimension} className="rounded-full border border-line bg-inset px-2.5 py-1 text-[12px] text-ink-2">
                            {t(lang, key)} · {stageLabel(entry.relationship[dimension])}
                          </span>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {href && (
                          <Link href={href} className="press inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-sm)] border border-line-strong px-3 text-[13px] text-ink">
                            {t(lang, "love_archive_continue")}
                            <ArrowRight size={14} />
                          </Link>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => forgetCharacter(entry)}>
                          <Trash2 size={14} />
                          {t(lang, "love_archive_forget")}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section aria-label={t(lang, "love_archive_stories")} className="flex flex-col gap-3">
              <h2 className="display text-[20px]">{t(lang, "love_archive_stories")}</h2>
              {stories.length === 0 && <p className="text-[13px] text-ink-3">{t(lang, "love_archive_no_stories")}</p>}
              <div className="flex flex-col gap-3">
                {stories.map((story) => {
                  const entry = characterForStory(story);
                  return (
                    <article key={story.id} className="card p-5 flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold text-ink">{story.title[lang]}</span>
                        {story.canonical && (
                          <span className="rounded-full border border-accent-soft px-2 py-0.5 text-[11px] text-accent-deep">
                            {t(lang, "love_archive_canonical")}
                          </span>
                        )}
                        <span className="text-[12px] text-ink-3">
                          {new Date(story.createdAt).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US")}
                        </span>
                      </div>
                      <p className="text-[13px] leading-relaxed text-ink-2">{story.summary[lang]}</p>
                      {story.endingId && <p className="text-[12px] text-ink-3">ending: {story.endingId}</p>}
                      {story.keyChoices.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <p className="text-[11px] text-ink-3">{t(lang, "love_archive_key_choices")}</p>
                          {story.keyChoices.slice(0, 5).map((choice, i) => (
                            <div key={i} className="rounded-[var(--radius-sm)] border border-line bg-inset px-3 py-2">
                              <p className="text-[13px] text-ink-2">{choice.choice[lang]}</p>
                              {quoteOf(choice, lang) && (
                                <p className="mt-1 text-[12px] italic text-ink-3">“{quoteOf(choice, lang)}”</p>
                              )}
                            </div>
                          ))}
                          <p className="text-[11px] text-ink-3">{t(lang, "love_archive_quote_note")}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => startAfterstory(story, entry)}>
                          {t(lang, "love_archive_afterstory")}
                        </Button>
                        {!story.canonical && (
                          <Button size="sm" variant="ghost" onClick={() => makeCanonical(story)}>
                            {t(lang, "love_archive_set_canonical")}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => exportStory(story)}>
                          <Download size={14} />
                          {t(lang, "love_archive_export")}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => removeStory(story)}>
                          <Trash2 size={14} />
                          {t(lang, "love_archive_delete_story")}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section aria-label={t(lang, "love_archive_unlocks")} className="flex flex-col gap-3">
              <h2 className="display text-[20px]">{t(lang, "love_archive_unlocks")}</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(
                  [
                    ["endings", "love_gallery_title"],
                    ["characters", "love_archive_characters"],
                    ["scenes", "love_scenarios"],
                    ["cgs", "love_archive_unlocks"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="card p-4 flex flex-col gap-1">
                    <span className="num text-[22px] leading-none">{archive.unlocks[key].length}</span>
                    <span className="text-[12px] text-ink-3">{t(lang, label)}</span>
                  </div>
                ))}
              </div>
              {archive.unlocks.endings.length === 0 &&
                archive.unlocks.characters.length === 0 &&
                archive.unlocks.scenes.length === 0 &&
                archive.unlocks.cgs.length === 0 && (
                  <p className="text-[12px] text-ink-3">{t(lang, "love_archive_no_unlocks")}</p>
                )}
            </section>
          </>
        )}
      </Page>
    </Shell>
  );
}

/** 供 `/love/archive` 页面直接渲染。 */
export default LoveArchivePanel;

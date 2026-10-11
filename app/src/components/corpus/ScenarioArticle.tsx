import Link from "next/link";
import { notFound } from "next/navigation";
import { scenarioById } from "@/data/corpus";
import type { Theory } from "@/data/corpus";
import type { L, Lang } from "@/data/taxonomy";
import { contextById } from "@/data/taxonomy";
import { hueColor } from "@/lib/format";
import { corpusHref, relatedTheories, scenarioJsonLd } from "@/lib/corpus";
import { ArticleShell, JsonLd, MetaChip, PICK, Section, SkillRow } from "@/components/corpus/ArticleShell";

/* ── 场景落地页文案（双语）── */
const KIND: L = { zh: "场景练习", en: "Practice scenario" };
const SECTION_BACKGROUND: L = { zh: "背景", en: "Background" };
const SECTION_OBJECTIVES: L = { zh: "你需要达成", en: "Your objectives" };
const SECTION_CHARACTERS: L = { zh: "人物", en: "Who you’re talking with" };
const SECTION_RELATED: L = { zh: "相关理论", en: "Related principles" };
const DIFF: Record<1 | 2 | 3, L> = {
  1: { zh: "入门", en: "Easy" },
  2: { zh: "进阶", en: "Medium" },
  3: { zh: "挑战", en: "Hard" },
};

/**
 * 场景落地页正文（纯 server 组件）。剧透边界是硬约束：
 * characters[].hidden、success、failure、simulationFacts、simulationDirection 一律不渲染。
 */
export function ScenarioArticle({ slug, lang }: { slug: string; lang: Lang }) {
  const scenario = scenarioById(slug);
  if (!scenario) notFound();

  // 学习者自己（SCENARIOS 统一注入的 "you"）不是「要打交道的人」，不列进人物。
  const characters = scenario.characters.filter((character) => character.id !== "you");
  const related = relatedTheories(scenario, 3);

  return (
    <ArticleShell
      lang={lang}
      eyebrow={[
        <MetaChip key="kind">{PICK(KIND, lang)}</MetaChip>,
        <MetaChip key="context">{PICK(contextById(scenario.context).name, lang)}</MetaChip>,
      ]}
      title={PICK(scenario.title, lang)}
      lead={PICK(scenario.hook, lang)}
      meta={
        <>
          <MetaChip>{PICK(scenario.contextType, lang)}</MetaChip>
          <MetaChip>{`${scenario.minutes} ${PICK({ zh: "分钟", en: "min" }, lang)}`}</MetaChip>
          <MetaChip>{PICK(DIFF[scenario.difficulty], lang)}</MetaChip>
        </>
      }
    >
      <JsonLd data={scenarioJsonLd(scenario, lang)} />

      <Section title={PICK(SECTION_BACKGROUND, lang)}>
        <p className="text-[14.5px] lg:text-[15.5px] text-ink leading-[1.8]">{PICK(scenario.background, lang)}</p>
      </Section>

      <Section title={PICK(SECTION_OBJECTIVES, lang)}>
        <ol className="flex flex-col gap-2.5">
          {scenario.objectives.map((objective, index) => (
            <li key={index} className="flex gap-3 text-[14px] leading-relaxed text-ink">
              <span aria-hidden className="num text-[13px] text-ink-3 mt-0.5 shrink-0 w-5">{index + 1}.</span>
              <span>{PICK(objective, lang)}</span>
            </li>
          ))}
        </ol>
      </Section>

      {characters.length > 0 && (
        <Section title={PICK(SECTION_CHARACTERS, lang)}>
          <ul className="flex flex-col gap-2">
            {characters.map((character) => (
              <li key={character.id} className="card p-4 flex items-center gap-3">
                <span aria-hidden className="h-9 w-9 shrink-0 rounded-full" style={{ background: hueColor(character.hue) }} />
                <span className="min-w-0 flex flex-col">
                  <span className="text-[14px] font-semibold leading-snug">{PICK(character.name, lang)}</span>
                  <span className="text-[13px] text-ink-3 leading-snug mt-0.5">{PICK(character.role, lang)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={PICK(SECTION_RELATED, lang)}>
        <SkillRow ids={scenario.skills} lang={lang} />
        {related.length > 0 && <RelatedTheoriesList related={related} lang={lang} />}
      </Section>
    </ArticleShell>
  );
}

function RelatedTheoriesList({ related, lang }: { related: Theory[]; lang: Lang }) {
  return (
    <ul className="flex flex-col gap-2 mt-1">
      {related.map((theory) => (
        <li key={theory.id}>
          <Link
            href={corpusHref(lang, "theory", theory.id)}
            className="press card card-link p-4 flex items-center justify-between gap-3"
          >
            <span className="min-w-0 flex flex-col">
              <span className="text-[14px] font-medium leading-snug">{PICK(theory.title, lang)}</span>
              <span className="text-[12px] text-ink-3 leading-snug mt-1 truncate">{theory.source.book}</span>
            </span>
            <span aria-hidden className="text-ink-3 shrink-0">→</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
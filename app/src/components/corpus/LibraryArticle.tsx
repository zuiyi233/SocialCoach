import { notFound } from "next/navigation";
import { caseById, theoryById } from "@/data/corpus";
import type { Case, Theory } from "@/data/corpus";
import type { CompetencyId, L, Lang } from "@/data/taxonomy";
import { competencyById, contextById } from "@/data/taxonomy";
import { compColor, compSoft } from "@/lib/format";
import { caseJsonLd, theoryJsonLd } from "@/lib/corpus";
import { ArticleShell, JsonLd, MetaChip, PICK, Section, SkillRow } from "@/components/corpus/ArticleShell";

/* ── 理论 / 案例落地页文案（双语）── */
const KIND_THEORY: L = { zh: "理论", en: "Theory" };
const KIND_CASE: L = { zh: "案例", en: "Case study" };
const SECTION_PRINCIPLE: L = { zh: "核心原则", en: "The principle" };
const SECTION_HOWTO: L = { zh: "怎么用", en: "How to apply" };
const SECTION_SITUATION: L = { zh: "情境", en: "Situation" };
const SECTION_HAPPENED: L = { zh: "发生了什么", en: "What happened" };
const SECTION_TAKEAWAY: L = { zh: "启发", en: "Takeaway" };
const SECTION_STRENGTHS: L = { zh: "能力与技能", en: "Competencies & skills" };

/**
 * 理论 / 案例落地页正文（纯 server 组件）。剧透边界：案例页只用 Case 类型
 * 展示字段（situation / whatHappened / takeaway），不碰 hidden 类内容。
 */
export function LibraryArticle({ slug, lang }: { slug: string; lang: Lang }) {
  const theory = theoryById(slug);
  if (theory) return <TheoryArticle theory={theory} lang={lang} />;

  const caseItem = caseById(slug);
  if (caseItem) return <CaseArticle caseItem={caseItem} lang={lang} />;

  notFound();
}

function TheoryArticle({ theory, lang }: { theory: Theory; lang: Lang }) {
  return (
    <ArticleShell
      lang={lang}
      eyebrow={
        <>
          <MetaChip>{PICK(KIND_THEORY, lang)}</MetaChip>
          {theory.context && <MetaChip>{PICK(contextById(theory.context).name, lang)}</MetaChip>}
        </>
      }
      title={PICK(theory.title, lang)}
      meta={<SkillRow ids={theory.skills} lang={lang} />}
    >
      <JsonLd data={theoryJsonLd(theory, lang)} />

      <Section title={PICK(SECTION_PRINCIPLE, lang)}>
        <p className="card p-5 text-[14.5px] lg:text-[15.5px] leading-[1.8]">{PICK(theory.principle, lang)}</p>
      </Section>

      <Section title={PICK(SECTION_HOWTO, lang)}>
        <ol className="flex flex-col gap-3">
          {theory.howTo.map((step, index) => (
            <li key={index} className="flex gap-3 text-[14px] leading-relaxed text-ink">
              <span aria-hidden className="num text-[13px] text-ink-3 mt-0.5 shrink-0 w-5">{index + 1}.</span>
              <span>{PICK(step, lang)}</span>
            </li>
          ))}
        </ol>
      </Section>

      {theory.competencies.length > 0 && (
        <Section title={PICK(SECTION_STRENGTHS, lang)}>
          <CompetencyRow ids={theory.competencies} lang={lang} />
        </Section>
      )}

      <SourceBlock source={theory.source} lang={lang} />
    </ArticleShell>
  );
}

function CaseArticle({ caseItem, lang }: { caseItem: Case; lang: Lang }) {
  return (
    <ArticleShell
      lang={lang}
      eyebrow={
        <>
          <MetaChip>{PICK(KIND_CASE, lang)}</MetaChip>
          <MetaChip>{PICK(contextById(caseItem.context).name, lang)}</MetaChip>
        </>
      }
      title={PICK(caseItem.title, lang)}
      meta={<SkillRow ids={caseItem.skills} lang={lang} />}
    >
      <JsonLd data={caseJsonLd(caseItem, lang)} />

      <Section title={PICK(SECTION_SITUATION, lang)}>
        <p className="text-[14.5px] lg:text-[15.5px] text-ink leading-[1.8]">{PICK(caseItem.situation, lang)}</p>
      </Section>

      <Section title={PICK(SECTION_HAPPENED, lang)}>
        <p className="text-[14.5px] lg:text-[15.5px] text-ink leading-[1.8]">{PICK(caseItem.whatHappened, lang)}</p>
      </Section>

      <Section title={PICK(SECTION_TAKEAWAY, lang)}>
        <p className="card p-5 text-[14.5px] lg:text-[15.5px] leading-[1.8] bg-accent-soft">{PICK(caseItem.takeaway, lang)}</p>
      </Section>

      {caseItem.competencies.length > 0 && (
        <Section title={PICK(SECTION_STRENGTHS, lang)}>
          <CompetencyRow ids={caseItem.competencies} lang={lang} />
        </Section>
      )}

      <SourceBlock source={caseItem.source} lang={lang} />
    </ArticleShell>
  );
}

function CompetencyRow({ ids, lang }: { ids: CompetencyId[]; lang: Lang }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="competencies">
      {ids.map((id) => (
        <span
          key={id}
          className="inline-flex items-center h-7 px-2.5 rounded-full text-[12px] font-medium"
          style={{ background: compSoft(id), color: compColor(id, 0.38, 0.09) }}
        >
          {PICK(competencyById(id).name, lang)}
        </span>
      ))}
    </div>
  );
}

function SourceBlock({ source, lang }: { source: Case["source"]; lang: Lang }) {
  return (
    <Section title={PICK({ zh: "出处", en: "Source" }, lang)}>
      <p className="text-[13.5px] text-ink-2 leading-relaxed">
        <span className="font-medium text-ink">{source.book}</span>
        <span className="text-ink-3"> — {source.author}</span>
        {source.url && (
          <>
            {" · "}
            <a href={source.url} className="underline decoration-line-strong underline-offset-2 hover:decoration-ink-2" target="_blank" rel="noopener noreferrer">
              link
            </a>
          </>
        )}
      </p>
    </Section>
  );
}
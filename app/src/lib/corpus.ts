import type { Metadata } from "next";
import { THEORIES, caseById, scenarioById, theoryById } from "@/data/corpus";
import type { Case, Scenario, Theory } from "@/data/corpus";
import type { Lang } from "@/data/taxonomy";
import { pick } from "@/lib/i18n";
import { SITE_URL } from "@/lib/site-url";

/**
 * 语料落地页（Stage C：C1/C4/C6）的共享服务端逻辑。
 * 纯 server 端：路径 / canonical / hreflang / OG / JSON-LD，不含任何剧透字段
 * （characters[].hidden、success、failure、simulationFacts、simulationDirection）。
 */

export type CorpusKind = "scenario" | "theory" | "case";

/** 落地页的规范路径（不含语言前缀）。 */
export function corpusPath(kind: CorpusKind, slug: string): string {
  return kind === "scenario" ? `/scenarios/${slug}` : `/library/${slug}`;
}

/** 站点相对路径；英文版统一加 /en 前缀，中文在根。 */
export function corpusHref(lang: Lang, kind: CorpusKind, slug: string): string {
  return `${lang === "en" ? "/en" : ""}${corpusPath(kind, slug)}`;
}

/** 绝对 URL（canonical / hreflang / OG 用，方案见 site-url.ts）。 */
export function corpusUrl(lang: Lang, kind: CorpusKind, slug: string): string {
  return `${SITE_URL}${corpusHref(lang, kind, slug)}`;
}

/** 动态 OG 图的口径固定为 /og/{kind}/{slug}（C3 由另一路由提供）。 */
export function corpusOgUrl(kind: CorpusKind, slug: string): string {
  return `${SITE_URL}/og/${kind}/${slug}`;
}

/** 按 kind + id 取语料；场景在 scenarios，理论与案例共享 library，id 全域无冲突。 */
export function findCorpus(kind: CorpusKind, slug: string): Scenario | Theory | Case | null {
  if (kind === "scenario") return scenarioById(slug) ?? null;
  return theoryById(slug) ?? caseById(slug) ?? null;
}

/** /library/[slug] 的语料归类：理论或案例（存在即唯一，不用前缀猜）。 */
export function libraryKindOf(slug: string): "theory" | "case" | null {
  if (theoryById(slug)) return "theory";
  if (caseById(slug)) return "case";
  return null;
}

/** 每类语料的「一句话介绍」，用于 meta description：hook / principle / situation。 */
function leadOf(kind: CorpusKind, item: Scenario | Theory | Case, lang: Lang): string {
  if (kind === "scenario") return pick((item as Scenario).hook, lang);
  if (kind === "theory") return pick((item as Theory).principle, lang);
  return pick((item as Case).situation, lang);
}

/** 截到搜索引擎建议的 description 长度，避免被硬截断。 */
function clipTo(text: string, max = 156): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

const META_OG_IMAGE_SIZE = { width: 1200, height: 630 };

/** 每页独立 title/description/canonical/hreflang/OG。 */
export function corpusMeta(kind: CorpusKind, slug: string, lang: Lang): Metadata {
  const item = findCorpus(kind, slug);
  if (!item) return {};
  const title = pick(item.title, lang);
  const description = clipTo(leadOf(kind, item, lang));
  const url = corpusUrl(lang, kind, slug);
  const zhUrl = corpusUrl("zh", kind, slug);
  const enUrl = corpusUrl("en", kind, slug);
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: { zh: zhUrl, en: enUrl, "x-default": zhUrl },
    },
    openGraph: {
      title,
      description,
      url,
      siteName: "SocialCoach",
      locale: lang === "zh" ? "zh_CN" : "en_US",
      type: "website",
      images: [{ url: corpusOgUrl(kind, slug), ...META_OG_IMAGE_SIZE, alt: title }],
    },
  };
}

/**
 * 与场景同主题的理论（2–3 条）：优先同 loveTopic，其次按 skills 重叠计分。
 * 供落地页相关链接与 JSON-LD citation 共用，结果稳定（sort 稳定）。
 */
export function relatedTheories(scenario: Scenario, limit = 3): Theory[] {
  return THEORIES.map((theory) => {
    let score = 0;
    if (scenario.loveTopic && theory.loveTopic === scenario.loveTopic) score += 4;
    const overlap = theory.skills.filter((skill) => scenario.skills.includes(skill)).length;
    score += overlap * 2;
    // 恋爱场景优先同话题：跨话题理论只靠技能关联时降低一档，避免串台。
    if (scenario.loveTopic && theory.loveTopic && theory.loveTopic !== scenario.loveTopic) score -= 1;
    return { theory, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.theory);
}

type BookCitation = { "@type": "Book"; name: string; author: { "@type": "Person"; name: string } };
function bookCitation(author: string, book: string): BookCitation {
  return { "@type": "Book", name: book, author: { "@type": "Person", name: author } };
}

/** 场景页：Article（C4），citation 指向同主题理论的 source 书目，不含剧透字段。 */
export function scenarioJsonLd(scenario: Scenario, lang: Lang): object {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: pick(scenario.title, lang),
    description: pick(scenario.hook, lang),
    articleSection: pick(scenario.contextType, lang),
    about: pick(scenario.background, lang),
    citation: relatedTheories(scenario, 3).map((t) => bookCitation(t.source.author, t.source.book)),
  };
}

/** 理论页：ScholarlyArticle 语义，citation 即自身 source 书目。 */
export function theoryJsonLd(theory: Theory, lang: Lang): object {
  const author = { "@type": "Person" as const, name: theory.source.author };
  return {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    headline: pick(theory.title, lang),
    description: pick(theory.principle, lang),
    author,
    citation: { "@type": "Book", name: theory.source.book, author },
  };
}

/** 案例页：Article 语义，citation 即自身 source 书目。 */
export function caseJsonLd(caseItem: Case, lang: Lang): object {
  const author = { "@type": "Person" as const, name: caseItem.source.author };
  return {
    "@context": "https://schema.org",
    "@type": ["Article", "LearningResource"],
    headline: pick(caseItem.title, lang),
    description: pick(caseItem.situation, lang),
    author,
    citation: { "@type": "Book", name: caseItem.source.book, author },
  };
}
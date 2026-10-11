import type { Metadata } from "next";
import { CASES, THEORIES } from "@/data/corpus";
import type { Lang } from "@/data/taxonomy";
import { corpusMeta, libraryKindOf } from "@/lib/corpus";
import { LibraryArticle } from "@/components/corpus/LibraryArticle";

/** 理论 + 案例落地页（中文）：slug = 语料 id，理论与案例 id 全域无冲突。 */
const LANG: Lang = "zh";

export const dynamicParams = false;

export function generateStaticParams() {
  return [...THEORIES, ...CASES].map((item) => ({ slug: item.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const kind = libraryKindOf(slug);
  return kind ? corpusMeta(kind, slug, LANG) : {};
}

export default async function LibraryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LibraryArticle slug={slug} lang={LANG} />;
}
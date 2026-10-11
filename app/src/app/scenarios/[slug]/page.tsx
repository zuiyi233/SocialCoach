import type { Metadata } from "next";
import { SCENARIOS } from "@/data/corpus";
import type { Lang } from "@/data/taxonomy";
import { corpusMeta } from "@/lib/corpus";
import { ScenarioArticle } from "@/components/corpus/ScenarioArticle";

/** 场景落地页（中文）：SSG 全量导出，slug = 语料 id，全库无冲突。 */
const LANG: Lang = "zh";

export const dynamicParams = false;

export function generateStaticParams() {
  return SCENARIOS.map((scenario) => ({ slug: scenario.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return corpusMeta("scenario", slug, LANG);
}

export default async function ScenarioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ScenarioArticle slug={slug} lang={LANG} />;
}
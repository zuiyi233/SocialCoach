import type { Metadata } from "next";
import { SCENARIOS } from "@/data/corpus";
import type { Lang } from "@/data/taxonomy";
import { corpusMeta } from "@/lib/corpus";
import { ScenarioArticle } from "@/components/corpus/ScenarioArticle";

/** 场景落地页（英文）：/en/scenarios/[slug]，hreflang 互指见 generateMetadata。 */
const LANG: Lang = "en";

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
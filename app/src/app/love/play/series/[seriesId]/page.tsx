import { notFound } from "next/navigation";
import { loveSeriesById } from "@/data/corpus/love-series";
import { SeriesPlay } from "@/components/love/SeriesPlay";

/**
 * 恋爱剧情线入口：按 seriesId 取语料里聚合好的剧情线。
 * 用静态段 /love/play/series/... 与单场景 /love/play/[scenarioId] 并存，
 * 避免两个动态段互相竞态；未知的 seriesId 走最近的 not-found 边界。
 */
export default async function LoveSeriesPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params;
  const series = loveSeriesById(seriesId);
  if (!series) notFound();
  return <SeriesPlay series={series} />;
}
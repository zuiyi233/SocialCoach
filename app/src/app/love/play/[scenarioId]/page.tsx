import { SCENARIOS } from "@/data/corpus";
import { PlayScene } from "@/components/love/PlayScene";

/**
 * 恋爱剧情模式入口：按 scenarioId 取内置场景。
 * 自定义场景只存在客户端 store（useApp.customScenarios），这里传 null，
 * 由 PlayScene 在 hydration 后自行解析；真正找不到时由 PlayScene 调 notFound()。
 */
export default async function LovePlayPage({ params }: { params: Promise<{ scenarioId: string }> }) {
  const { scenarioId } = await params;
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? null;
  return <PlayScene scenario={scenario} scenarioId={scenarioId} />;
}

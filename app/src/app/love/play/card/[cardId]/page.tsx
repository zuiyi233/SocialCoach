import { PlayScene } from "@/components/love/PlayScene";

/**
 * 卡驱动游玩（spec-love-user-cards §2.3/§2.4）：/love/play/card/[cardId]。
 *
 * 卡只存在设备端（localStorage），服务端首帧读不到，所以 `scenario` 传 null，
 * 由 PlayScene 在 hydration 后从 `readLoveCards()` 解析合成场景；真正找不到时
 * PlayScene 显示「这张卡不在这台设备上」，不调 notFound。
 */
export default async function LoveCardPlayPage({ params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  return <PlayScene scenario={null} scenarioId={cardId} cardId={cardId} />;
}

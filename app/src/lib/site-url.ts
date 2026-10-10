/**
 * 对外规范地址：canonical / robots / sitemap 都以它为准。
 * 地域分流短域名跳转时会丢掉子路径（见 wiki/80-known-pitfalls「地域分流短域名
 * 不保留深链接」），所以爬虫与深链落在直连域名上；自部署方用
 * NEXT_PUBLIC_SITE_URL 覆盖。
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://socialcoach-ai.vercel.app").replace(/\/+$/, "");

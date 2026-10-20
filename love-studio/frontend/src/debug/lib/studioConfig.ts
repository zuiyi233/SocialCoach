/**
 * Love Studio 前端用的几个「配置常量」集中在这里 —— 需要改一处就能改全。
 *
 * 注意:后端的地址不在这里 —— 那是 lib/api.ts 的 BASE_URL(读 VITE_API_BASE_URL,
 * 默认跟地址栏主机 + :8000)。这里只放前端的本地偏好键和主站回链。
 */

/** 创作者模式偏好存的 localStorage 键(见 lib/creatorMode.ts) */
export const STUDIO_CREATOR_KEY = 'studio.creatorMode';

/**
 * 主站恋爱域的返回地址(局内菜单的「回到 SocialCoach」要跳的页面)。
 *
 * 部署到别处的主站用 `VITE_MAIN_SITE_URL` 覆盖;不设就用本机 dev 的 :3000。
 * 别处不要写死这个地址,一律从这里取。
 */
const DEFAULT_MAIN_SITE_LOVE_URL = 'http://localhost:3000/love';
export const MAIN_SITE_LOVE_URL: string =
  (import.meta.env.VITE_MAIN_SITE_URL ?? '').trim() || DEFAULT_MAIN_SITE_LOVE_URL;
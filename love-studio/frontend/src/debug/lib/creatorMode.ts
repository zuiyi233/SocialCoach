/**
 * 创作者模式 —— 决定这台机器上打开的是「玩家界面」还是「完整调试台」。
 *
 * 玩家界面(关):只剩视觉小说(封面 / 对白 / 存档 / 设置),看不到提示词调试台、
 * 提示词检查器、插件页、预设页、立绘包编辑这些创作工具。
 * 创作者模式(开):调试台原样回来,调试台菜单里的导入 / 卡编辑 / 插件都能用。
 *
 * 和字号、预算旋钮一样是本机偏好,存在 localStorage(按设备记住,不入库)。
 * 打开方式:
 *   - 设置里「创作者模式」开关(见 components/SettingsDrawer.tsx),或
 *   - 地址栏加 ?creator=1 打开、?creator=0 关掉(会写回 localStorage)。
 * 默认是**关** —— 新用户/普通玩家进来不该直接落在调试台上。
 */

import { STUDIO_CREATOR_KEY } from './studioConfig';

const TRUE = '1';
const FALSE = '0';

function envOverride(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('creator')) return null;
    const raw = (params.get('creator') ?? '').toLowerCase();
    // ?creator(裸参数)、?creator=1、?creator=true 都算开;=0 / =false 关
    if (raw === '' || raw === TRUE || raw === 'true' || raw === 'on' || raw === 'yes') return TRUE;
    return FALSE;
  } catch {
    return null;
  }
}

/** 读:地址栏 ?creator 优先(顺手写回),否则看本机记着的,默认关 */
export function loadCreatorMode(): boolean {
  const url = envOverride();
  if (url !== null) {
    saveCreatorMode(url === TRUE);
    return url === TRUE;
  }
  try {
    return window.localStorage.getItem(STUDIO_CREATOR_KEY) === TRUE;
  } catch {
    // 隐私模式 / 存储被禁:当没开过
    return false;
  }
}

export function saveCreatorMode(on: boolean): void {
  try {
    window.localStorage.setItem(STUDIO_CREATOR_KEY, on ? TRUE : FALSE);
  } catch {
    // 存不进去就算了 —— 这次会话里照样生效,只是不记住
  }
}
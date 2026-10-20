/**
 * Love Studio 的本地地址与健康检查（spec-love-studio §3.2 方案 A、§5 P1）。
 *
 * Studio 是独立运行时（AnimaVN fork，Python + SQLite），v1 本地伴生：主站只链接
 * 它，不共享存储、不带账号。主站必须能在 Studio 没启动时正常工作——所以这里
 * 只做一次短超时的探测，任何失败都只是「没运行」，不是错误。
 *
 * 探测分两步，先连通性、后版本：先用 no-cors 请求 `/api/health`——只要端口有
 * 服务在听就算在运行（响应不可读，但连接本身足够）。确认在运行后再用普通
 * CORS 请求读正文拿版本；读不到只是没有版本，不是失败。
 *
 * 顺序刻意如此：Studio 没启动时浏览器必然记一条 ERR_CONNECTION_REFUSED，这是
 * 浏览器对连不上的网络请求的日志，不是页面报错。先连通性后版本能把这条降到
 * 一次；反过来（先 CORS）在没启动时要试两次，控制台就多一条。
 */

/** Studio 的固定端口；与其健康检查同源，便于主站只记住一个地址。 */
export const LOVE_STUDIO_PORT = 5180;
export const LOVE_STUDIO_HOST = "127.0.0.1";
export const LOVE_STUDIO_URL = `http://${LOVE_STUDIO_HOST}:${LOVE_STUDIO_PORT}`;
export const LOVE_STUDIO_HEALTH_PATH = "/api/health";
export const LOVE_STUDIO_HEALTH_URL = `${LOVE_STUDIO_URL}${LOVE_STUDIO_HEALTH_PATH}`;

/** 探测超时：本机端口，1.5s 足够；超过就是不在了，不要让入口卡挂着。 */
export const LOVE_STUDIO_PROBE_TIMEOUT_MS = 1500;

export type LoveStudioProbe =
  /** 有服务在监听，且健康检查答了「ok」。`version` 只在能读到正文时有值。 */
  | { kind: "up"; version: string | null }
  /** 端口有服务，但健康检查没答 ok —— 通常是前端起来了、后端没起来。
   *  对用户来说这不是「能玩」：给的是「去看后端窗口的报错」，不是「打开 Studio」。 */
  | { kind: "degraded" }
  | { kind: "down" };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LoveStudioProbeOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** 带超时的单次请求；超时、网络失败、被 CORS 拦都返回 null。 */
async function attempt(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 探测本地 Studio。永不抛错：任何异常都折算成 `down`，入口卡据此显示安装说明。
 */
export async function probeLoveStudio(options: LoveStudioProbeOptions = {}): Promise<LoveStudioProbe> {
  const fetchImpl =
    options.fetchImpl ?? (typeof fetch === "function" ? (fetch.bind(globalThis) as FetchLike) : null);
  if (!fetchImpl) return { kind: "down" };
  const timeoutMs = options.timeoutMs ?? LOVE_STUDIO_PROBE_TIMEOUT_MS;

  // 连通性：no-cors 下响应不可读（status 0 / ok false），有响应就说明端口有服务，
  // 所以这里只判「有没有答」——守卫回的 503、反代回的 404 都算在运行。
  const reachable = await attempt(
    LOVE_STUDIO_HEALTH_URL,
    { method: "GET", mode: "no-cors", cache: "no-store" },
    timeoutMs,
    fetchImpl,
  );
  if (!reachable) return { kind: "down" };

  // 版本：只有本地桥放行了主站源才读得到；读不到时端口确实有服务，但健康状态未知，
  // 按「在运行」处理（不读正文就不能凭空判它不健康）。
  const readable = await attempt(
    LOVE_STUDIO_HEALTH_URL,
    { method: "GET", mode: "cors", headers: { accept: "application/json" }, cache: "no-store" },
    timeoutMs,
    fetchImpl,
  );
  if (!readable) return { kind: "up", version: null };
  try {
    const body: unknown = await readable.json();
    const record = (body && typeof body === "object" ? body : {}) as { status?: unknown; version?: unknown };
    const version = typeof record.version === "string" ? record.version : null;
    // 健康检查自己的口径：2xx 且答 ok（或至少带了版本）才算真的就绪。
    if (readable.ok && (record.status === "ok" || version !== null)) return { kind: "up", version };
    return { kind: "degraded" };
  } catch {
    // 正文不是 JSON（反代给的 HTML 错误页一类）：端口有服务，但健康检查没答成，
    // 算「起了一半」，不报「已运行」。
    return readable.ok ? { kind: "up", version: null } : { kind: "degraded" };
  }
}

/** 打开 Studio 的地址：其根路径会转到主界面。 */
export function loveStudioOpenUrl(): string {
  return `${LOVE_STUDIO_URL}/`;
}
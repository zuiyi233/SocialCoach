import { LOVE_PLAY_PREFIX } from "./love-carry-store";

/**
 * G04：恋爱独立 slot 的跨标签页/同标签页变更通知。
 *
 * 浏览器只在**别的**标签页写 localStorage 时派发 `storage` 事件；同标签页的写入
 * 不会触发它。所以写路径成功后显式派发一个本地 CustomEvent，读路径只订阅这一个入口，
 * 不再各自轮询或各写一份比较逻辑。
 *
 * 只关心 `socialcoach.love-play.` 前缀（含 `key === null` 的 clear）。
 */
export const LOVE_SLOTS_CHANGED = "socialcoach:love-slots-changed";

type Listener = (key: string | null) => void;

function bus(): EventTarget | null {
  if (typeof window === "undefined") return null;
  // 浏览器 window 同时有 add/remove/dispatch；Node 的 globalThis 不是完整事件总线，
  // 不能只凭 addEventListener 就把它当 window 用。
  if (typeof window.addEventListener !== "function" || typeof window.dispatchEvent !== "function") return null;
  return window;
}

/** 写成功后调用；key 是本次写入的 slot。不读写 localStorage，失败也不抛错。 */
export function notifyLoveSlotsChanged(key: string): void {
  const target = bus();
  if (!target) return;
  try {
    target.dispatchEvent(new CustomEvent(LOVE_SLOTS_CHANGED, { detail: { key } }));
  } catch {
    // 没有 CustomEvent（老环境）不阻断剧情；跨标签页仍会收到原生 storage 事件。
  }
}

/** 订阅恋爱 slot 变化；返回取消函数。非恋爱 key 的 storage 事件被忽略。 */
export function subscribeLoveSlots(listener: Listener): () => void {
  const target = bus();
  if (!target) return () => {};

  const onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    // key === null 是 storage.clear()：所有 slot 都可能没了，必须通知。
    if (key !== null && !key.startsWith(LOVE_PLAY_PREFIX)) return;
    listener(key);
  };
  const onLocal = (event: Event) => {
    const detail = (event as CustomEvent<{ key?: unknown }>).detail;
    listener(typeof detail?.key === "string" ? detail.key : null);
  };

  target.addEventListener("storage", onStorage);
  target.addEventListener(LOVE_SLOTS_CHANGED, onLocal);
  return () => {
    target.removeEventListener("storage", onStorage);
    target.removeEventListener(LOVE_SLOTS_CHANGED, onLocal);
  };
}

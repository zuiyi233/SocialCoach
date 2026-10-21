/**
 * 恋爱半教练结算时的 Rio 承诺/边界信号（spec-love-semi-coach §3.2）。
 *
 * PlayScene 开局时把当前 Rio 账本里的承诺/边界状态快照成一行签名（promise id→status、
 * boundary id→status），结算时对幕前/幕后两个签名做差，得出本幕「新兑现 / 新越界 /
 * 边界被尊重」三个布尔信号，喂给 `applySceneEnd`。
 *
 * 纪律：
 * - 只统计**本幕新增**的状态变化——幕前已经 kept/broken/agreed 的不重复计入；
 * - promiseKept / promiseBroken 只认 learner 立下的承诺；Rio 自己的承诺不计；
 * - boundaryRespected 认「新 agreed」或「crossed → repaired」；其余状态不算；
 * - 没有 Rio 账本（非 Rio 场景）时幕前幕后都是空签名，三个信号全为 false。
 * 纯函数：不读 localStorage、不依赖 React。
 */

import type { RioBoundaryStatus, RioPromiseStatus, RioRelationshipState } from "./love-relationship-state";

/** 只存承诺/边界的 id→status 签名；不含证据、quotes 等大块，快照与差分的开销都很小。 */
export function rioSceneSignature(state: RioRelationshipState | null | undefined): string {
  if (!state) return "";
  const promises = state.promises
    .filter((p) => p.by === "learner")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => `${p.id}:${p.status}`)
    .join(",");
  const boundaries = [...state.boundaries]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((b) => `${b.id}:${b.status}`)
    .join(",");
  return `${promises}::${boundaries}`;
}

export interface RioSceneSignals {
  promiseKept: boolean;
  promiseBroken: boolean;
  boundaryRespected: boolean;
}

type SigMaps = { promises: Map<string, RioPromiseStatus>; boundaries: Map<string, RioBoundaryStatus> };

/** 把签名解析回两个 id→status 映射；空签名得到空映射。 */
function parseSig(sig: string): SigMaps {
  const [promisePart = "", boundaryPart = ""] = sig.split("::");
  const promises = new Map<string, RioPromiseStatus>();
  for (const pair of promisePart.split(",").filter(Boolean)) {
    const sep = pair.indexOf(":");
    promises.set(pair.slice(0, sep), pair.slice(sep + 1) as RioPromiseStatus);
  }
  const boundaries = new Map<string, RioBoundaryStatus>();
  for (const pair of boundaryPart.split(",").filter(Boolean)) {
    const sep = pair.indexOf(":");
    boundaries.set(pair.slice(0, sep), pair.slice(sep + 1) as RioBoundaryStatus);
  }
  return { promises, boundaries };
}

/**
 * 幕前/幕后两个签名 → 本幕的结算信号。
 *
 * - `promiseKept`：本幕新增 status=kept 的 learner 承诺（幕前 open/… → 幕后 kept）；
 * - `promiseBroken`：本幕新增 status=broken 的 learner 承诺；
 * - `boundaryRespected`：本幕新增 status=agreed 的 boundary，或 crossed → repaired。
 * 状态没变（含幕前已经是该状态）一律不计；空签名两边都空，信号全为 false。
 */
export function rioSceneSignals(beforeSig: string, afterSig: string): RioSceneSignals {
  const before = parseSig(beforeSig);
  const after = parseSig(afterSig);
  let promiseKept = false;
  let promiseBroken = false;
  let boundaryRespected = false;

  for (const [id, status] of after.promises) {
    if (before.promises.get(id) === status) continue;
    if (status === "kept") promiseKept = true;
    if (status === "broken") promiseBroken = true;
  }
  for (const [id, status] of after.boundaries) {
    const prev = before.boundaries.get(id);
    if (prev === status) continue;
    if (status === "agreed") boundaryRespected = true;
    if (prev === "crossed" && status === "repaired") boundaryRespected = true;
  }

  return { promiseKept, promiseBroken, boundaryRespected };
}

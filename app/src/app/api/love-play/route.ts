import { readTaskBody, TaskInputSchemas } from "@/lib/task-input";
import { taskLLM } from "@/lib/task-runtime";
import { FAST_MODEL, serverLLM } from "@/lib/llm";
import { checkRateLimit } from "@/lib/rate-limit";
import { fail } from "@/lib/api-utils";
import { runLovePlay } from "@/lib/tasks/love-play";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    checkRateLimit(req);
    const input = await readTaskBody(req, TaskInputSchemas["love-play"]);
    // 非流式：一次 chatText 得一次完整 JSON，交由 runLovePlay 校验/修复。
    // 预算沿用 roleplay 的 [55s, 2 次调用]（一次主调用 + 一次有界修复）。
    const output = await runLovePlay(input, taskLLM(serverLLM, "roleplay", req.signal, (event) => console.info("[model_task]", event), input.language), FAST_MODEL);
    return Response.json(output);
  } catch (e) {
    return fail(e);
  }
}
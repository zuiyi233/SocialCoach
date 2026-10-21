/**
 * 一句话生成角色（角色生成向导，Love Studio 创作者模式）。
 *
 * 表单 → POST /api/character/generate（后端 job）→ 每 2 秒轮询
 * GET /api/character/generate/{job_id}。后端用 1 次文本模型生成 Tavern V2 卡 +
 * 世界书，再用设置里配置的 OpenAI 兼容图片后端生成立绘与场景图，落库并绑卡。
 *
 * 前端只负责表单、进度、结果与错误；不接触 API key，也不显示后端内部路径。
 * 轮询上限 10 分钟，超时提示可稍后重试；关闭弹窗不取消后端任务（v1 进程内 job）。
 */

import { useEffect, useRef, useState } from 'react';
import { debugApi, type CharacterGenerateJob, type CharacterGeneratePayload } from '../lib/api';
import { Btn, Modal } from './ui';
import {
  JOB_MAX_WAIT_MS,
  JOB_POLL_MS,
  clampExpressions,
  clampScenes,
  imageBreakdown,
  jobProgress,
  validateDescription,
} from './characterGenerateModel';

type Lang = 'zh' | 'en';

const COPY = {
  zh: {
    title: '一句话生成角色',
    subtitle: '描述一个角色，模型会写卡、世界书与外观标签，再画立绘和场景。',
    description: '角色描述',
    descriptionPh: '例如：老城区书店的夜班店员，说话很轻，喜欢在书页里夹便签。',
    descriptionHint: '1–2000 字。默认全年龄；不要写真实人物。',
    name: '角色名（可选）',
    namePh: '留空就让模型起名',
    language: '角色卡语言',
    style: '画风（可选）',
    stylePh: '例如：anime visual novel, soft lighting',
    expressions: '表情数量',
    scenes: '场景数量',
    cost: '会调用 1 次文本模型 + {n} 张图片（立绘 {e} 张 + 场景 {s} 张）。预计 1–5 分钟，取决于图片服务；使用你在设置里配置的图片后端。',
    start: '开始生成',
    running: '正在生成…',
    step: '第 {step}/{total} 步',
    done: '生成完成',
    open: '打开角色',
    again: '再生成一个',
    close: '关闭',
    failed: '生成失败',
    retry: '重试',
    timeout: '等了 10 分钟还没完成。任务可能仍在后台跑；可以关掉稍后再看，或重新生成。',
    expired: '任务已过期，请重新生成。',
    warnings: '部分图片没生成成功：',
    images: '立绘 {ok} 张，场景图 {ok2} 张',
    count: '张',
    validation: '请先写一段角色描述（1–2000 字）。',
    descriptionTooLong: '角色描述最多 2000 字。',
  },
  en: {
    title: 'Generate a character',
    subtitle: 'Describe a character. The model writes the card, worldbook and appearance tags, then paints portraits and scenes.',
    description: 'Character description',
    descriptionPh: 'e.g. a night-shift clerk at an old-town bookshop, soft-spoken, leaves notes between pages.',
    descriptionHint: '1–2000 characters. SFW by default; no real people.',
    name: 'Name (optional)',
    namePh: 'Leave blank to let the model name them',
    language: 'Card language',
    style: 'Art style (optional)',
    stylePh: 'e.g. anime visual novel, soft lighting',
    expressions: 'Expressions',
    scenes: 'Scenes',
    cost: 'This calls the text model once and generates {n} images ({e} portraits + {s} scenes). Expect 1–5 minutes depending on the image service; it uses the image backend configured in Settings.',
    start: 'Start generating',
    running: 'Generating…',
    step: 'Step {step}/{total}',
    done: 'Done',
    open: 'Open character',
    again: 'Generate another',
    close: 'Close',
    failed: 'Generation failed',
    retry: 'Retry',
    timeout: 'Still not done after 10 minutes. The job may still be running; close this and check later, or start again.',
    expired: 'This job has expired. Please generate again.',
    warnings: 'Some images failed:',
    images: '{ok} portraits, {ok2} scene backgrounds',
    count: '',
    validation: 'Write a character description first (1–2000 characters).',
    descriptionTooLong: 'The description is limited to 2000 characters.',
  },
} as const;

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}

export interface CharacterGenerateProps {
  onClose: () => void;
  /** 生成成功：父组件刷新卡列表并打开新卡。 */
  onOpen: (cardId: string) => void | Promise<void>;
  notify: (kind: 'ok' | 'error', text: string) => void;
}

export function CharacterGenerate({ onClose, onOpen, notify }: CharacterGenerateProps) {
  const [lang, setLang] = useState<Lang>('zh');
  const c = COPY[lang];
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [style, setStyle] = useState('');
  const [expressions, setExpressions] = useState(4);
  const [scenes, setScenes] = useState(3);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<CharacterGenerateJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef(0);

  const running = job?.status === 'running';
  const done = job?.status === 'done' && job.result;
  const totalImages = expressions + scenes;

  // 轮询：只在 running 时起表；done/error/关闭都停。
  useEffect(() => {
    if (!jobId || !running) return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      if (Date.now() - startedAtRef.current > JOB_MAX_WAIT_MS) {
        setError(c.timeout);
        return;
      }
      try {
        const next = await debugApi.getCharacterGeneration(jobId);
        if (!alive) return;
        setJob(next);
        setError(null);
      } catch (e) {
        if (!alive) return;
        const status = (e as { status?: number }).status;
        if (status === 404) {
          setError(c.expired);
          return;
        }
        // 网络抖动：保留 jobId，下一次继续轮询；不把进度清空。
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const timer = window.setInterval(tick, JOB_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [jobId, running, c.expired, c.timeout]);

  const start = async () => {
    const text = description.trim();
    const problem = validateDescription(text, lang);
    if (problem) {
      setError(problem);
      return;
    }
    setStarting(true);
    setError(null);
    setJob(null);
    try {
      const payload: CharacterGeneratePayload = {
        description: text,
        language: lang,
        expression_count: expressions,
        scene_count: scenes,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(style.trim() ? { style: style.trim() } : {}),
      };
      const res = await debugApi.startCharacterGeneration(payload);
      startedAtRef.current = Date.now();
      setJobId(res.job_id);
      setJob({ status: 'running', step: 0, total: 0, message: c.running, result: null, error: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const reset = () => {
    setJobId(null);
    setJob(null);
    setError(null);
  };

  const open = async () => {
    if (!done) return;
    try {
      await onOpen(done.card_id);
      onClose();
    } catch (e) {
      notify('error', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      title={
        <span className="st-inline-gap">
          {c.title}
          <span className="st-chip">
            <button type="button" className="st-link" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
              {lang === 'zh' ? 'EN' : '中文'}
            </button>
          </span>
        </span>
      }
      onCancel={onClose}
      footer={
        <>
          <Btn onClick={onClose}>{c.close}</Btn>
          {!jobId && (
            <Btn kind="primary" disabled={starting} onClick={start}>
              {starting ? c.running : c.start}
            </Btn>
          )}
          {jobId && job?.status === 'error' && (
            <>
              <Btn onClick={reset}>{c.retry}</Btn>
              <Btn kind="primary" onClick={start}>
                {c.start}
              </Btn>
            </>
          )}
          {done && (
            <>
              <Btn onClick={reset}>{c.again}</Btn>
              <Btn kind="primary" onClick={open}>
                {c.open}
              </Btn>
            </>
          )}
        </>
      }
    >
      <p className="st-modal-hint">{c.subtitle}</p>

      {!jobId && (
        <>
          <label className="st-label" htmlFor="cg-desc">
            {c.description}
          </label>
          <textarea
            id="cg-desc"
            className="st-textarea"
            rows={5}
            maxLength={2000}
            value={description}
            placeholder={c.descriptionPh}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="st-row-note">{c.descriptionHint}</p>

          <div className="st-row">
            <label className="st-row-label" htmlFor="cg-name">
              {c.name}
            </label>
            <input
              id="cg-name"
              className="st-input"
              value={name}
              placeholder={c.namePh}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="st-row">
            <label className="st-row-label" htmlFor="cg-lang">
              {c.language}
            </label>
            <select id="cg-lang" className="st-input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="st-row">
            <label className="st-row-label" htmlFor="cg-style">
              {c.style}
            </label>
            <input
              id="cg-style"
              className="st-input"
              value={style}
              placeholder={c.stylePh}
              onChange={(e) => setStyle(e.target.value)}
            />
          </div>

          <div className="st-row">
            <label className="st-row-label" htmlFor="cg-exp">
              {c.expressions}
            </label>
            <input
              id="cg-exp"
              className="st-input"
              type="number"
              min={2}
              max={8}
              value={expressions}
              onChange={(e) => setExpressions(clampExpressions(Number(e.target.value)))}
            />
          </div>

          <div className="st-row">
            <label className="st-row-label" htmlFor="cg-scenes">
              {c.scenes}
            </label>
            <input
              id="cg-scenes"
              className="st-input"
              type="number"
              min={0}
              max={6}
              value={scenes}
              onChange={(e) => setScenes(clampScenes(Number(e.target.value)))}
            />
          </div>

          <p className="st-row-note">{fill(c.cost, { n: totalImages, e: expressions, s: scenes })}</p>
        </>
      )}

      {jobId && job && (
        <div className="st-gen-progress" role="status" aria-live="polite">
          <div className="st-gen-bar">
            <span style={{ width: `${jobProgress(job)}%` }} />
          </div>
          <p className="st-gen-message">
            {job.status === 'running' ? job.message || c.running : job.status === 'done' ? c.done : c.failed}
          </p>
          {job.total > 0 && (
            <p className="st-row-note">{fill(c.step, { step: job.step, total: job.total })}</p>
          )}

          {job.status === 'error' && job.error && (
            <p className="st-gen-error" role="alert">
              {job.error}
            </p>
          )}

          {done && (
            <div className="st-gen-result">
              <p className="st-gen-name">{done.card_name}</p>
              <p className="st-row-note">
                {(() => {
                  const split = imageBreakdown(done.images_ok, expressions);
                  return fill(c.images, { ok: split.portraits, ok2: split.scenes });
                })()}
              </p>
              {done.warnings.length > 0 && (
                <div className="st-gen-warn">
                  <p>{c.warnings}</p>
                  <ul>
                    {done.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="st-gen-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

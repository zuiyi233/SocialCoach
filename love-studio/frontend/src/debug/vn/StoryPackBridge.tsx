/**
 * 「把这段关系带回半教练」——故事包（`socialcoach.love-story.v1`）的导出与导入。
 *
 * 桥的纪律（spec-love-bridge §2/§5）：
 * - 每次交接都由用户显式触发，没有后台同步；导出前不调用模型，只读本地这一局。
 * - 只带故事事实（标题、摘要、玩家的关键选择），不带关系状态——关系归主站写。
 * - 主站侧解析器会剥 `hidden` / `secret` / 结局谓词；这里只负责产出主站认得的形状。
 * - 单语原文同时填进 zh / en（显式复用，不是偷偷机翻），玩家可以在导出前自己改。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { debugApi, type StoryPackApplyResult, type StoryPackPreview } from '../lib/api';
import { MAIN_SITE_LOVE_URL } from '../lib/studioConfig';
import './storyPackBridge.css';

interface Props {
  cardId: string | null;
  chatId: string | null;
  charName: string;
  /** 当前对话的名字，导出时当标题初值 */
  chatName?: string;
}

type Mode = 'idle' | 'export' | 'import';

const ARCHIVE_URL = `${MAIN_SITE_LOVE_URL.replace(/\/$/, '')}/archive`;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function storyOf(pack: Record<string, unknown> | null): Record<string, unknown> | null {
  const story = pack?.story;
  return story && typeof story === 'object' ? (story as Record<string, unknown>) : null;
}

function locText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const loc = value as { zh?: unknown; en?: unknown };
  return (typeof loc.zh === 'string' && loc.zh) || (typeof loc.en === 'string' && loc.en) || '';
}

export function StoryPackBridge({ cardId, chatId, charName, chatName }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<{ name: string; hash: string } | null>(null);
  const [preview, setPreview] = useState<StoryPackPreview | null>(null);
  const [applied, setApplied] = useState<StoryPackApplyResult | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // 换一局/换角色时把上一局的结果清掉，免得把 A 的导出结果读成 B 的
  useEffect(() => {
    setMode('idle');
    setExported(null);
    setPreview(null);
    setApplied(null);
    setError(null);
  }, [chatId, cardId]);

  const defaultTitle = useMemo(() => {
    const name = chatName?.trim();
    return name || `${charName || '这段关系'} · 故事`;
  }, [chatName, charName]);

  const openExport = () => {
    setMode('export');
    setError(null);
    setExported(null);
    setTitle((current) => current || defaultTitle);
  };

  const onExport = async () => {
    if (!chatId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await debugApi.exportStory({
        chat_id: chatId,
        title: title.trim() || undefined,
        summary: summary.trim() || undefined,
      });
      downloadText(result.json, result.file_name);
      setExported({ name: result.file_name, hash: result.hash.slice(0, 8) });
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setPreview(null);
    setApplied(null);
    try {
      setPreview(await debugApi.importStory(file));
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const onApply = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setApplied(await debugApi.applyStoryImport(preview.pack, cardId));
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const previewStory = storyOf(preview?.pack ?? null);
  const canContinueHere = Boolean(preview?.can_create_card || cardId);

  return (
    <section className="spb" aria-label="把这段关系带回半教练">
      <header className="spb-head">
        <div className="spb-copy">
          <h3>把这段关系带回半教练</h3>
          <p>
            导出一份故事包，在 SocialCoach 的关系档案里导入：人物、关键选择与结局会留在那边。
            这里不带关系数值——关系状态只在半教练里按故事节点推进。
          </p>
        </div>
        <div className="spb-actions">
          <button
            className="vn-pill accent"
            onClick={openExport}
            disabled={busy || !chatId || mode === 'export'}
            title={chatId ? '把当前这一局导出成故事包' : '先点下面的「在这里存档」，有了对话才能导出'}
          >
            导出故事包
          </button>
          <button
            className="vn-pill"
            onClick={() => {
              setMode('import');
              setError(null);
              setPreview(null);
              setApplied(null);
            }}
            disabled={busy}
            title="把一份故事包变成可以续写的一局"
          >
            导入故事包
          </button>
        </div>
      </header>

      {mode === 'export' && (
        <div className="spb-body">
          <label className="spb-field">
            <span>标题</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder={defaultTitle}
            />
          </label>
          <label className="spb-field">
            <span>摘要（留空则用最后一句自动写）</span>
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="用户可见的摘要；不会包含角色隐藏设定或结局条件"
            />
          </label>
          <div className="spb-row">
            <button className="vn-pill accent" onClick={() => void onExport()} disabled={busy || !chatId}>
              {busy ? '生成中…' : '生成并下载'}
            </button>
            <button className="vn-pill" onClick={() => setMode('idle')} disabled={busy}>
              收起
            </button>
            <span className="spb-hint">只读本地这一局，不调用模型。</span>
          </div>
          {exported && (
            <div className="spb-ok">
              <p>
                已下载 <code>{exported.name}</code>（校验前缀 {exported.hash}）。
              </p>
              <p>
                下一步：打开{' '}
                <a href={ARCHIVE_URL} target="_blank" rel="noreferrer">
                  SocialCoach 关系档案
                </a>{' '}
                点「导入故事包」，选这份文件。也可以把文件带到装了 SocialCoach 的别的设备上。
              </p>
            </div>
          )}
        </div>
      )}

      {mode === 'import' && (
        <div className="spb-body">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onPickFile(file);
              event.target.value = '';
            }}
          />
          <div className="spb-row">
            <button className="vn-pill accent" onClick={() => fileInput.current?.click()} disabled={busy}>
              {busy ? '读取中…' : '选择故事包'}
            </button>
            <button className="vn-pill" onClick={() => setMode('idle')} disabled={busy}>
              收起
            </button>
            <span className="spb-hint">支持半教练导出的 socialcoach.love-story.v1 JSON。</span>
          </div>

          {previewStory && (
            <div className="spb-preview">
              <p className="spb-preview-title">{locText(previewStory.title)}</p>
              <p className="spb-preview-summary">{locText(previewStory.summary)}</p>
              <p className="spb-hint">
                关键选择 {Array.isArray(previewStory.keyChoices) ? previewStory.keyChoices.length : 0} 条
                {preview?.can_create_card ? ' · 会新建角色' : cardId ? ' · 会挂到当前角色' : ' · 包里没有角色快照'}
              </p>
              {preview && preview.warnings.length > 0 && (
                <ul className="spb-warn">
                  {preview.warnings.slice(0, 6).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              <div className="spb-row">
                <button className="vn-pill accent" onClick={() => void onApply()} disabled={busy || !canContinueHere}>
                  {busy ? '创建中…' : '从这里续写'}
                </button>
                <span className="spb-hint">会新建一局，开头带上这段前情；不会覆盖原来的故事。</span>
              </div>
            </div>
          )}

          {applied && (
            <div className="spb-ok">
              <p>
                已新建一局{applied.created_card ? '，并建好了角色' : ''}。到「历史」里打开
                「{locText(storyOf(preview?.pack ?? null)?.title) || '续写'}」就能接着写。
              </p>
              <p className="spb-hint">前情开头：{applied.recap.split('\n')[0]}</p>
            </div>
          )}
        </div>
      )}

      {error && <p className="spb-error">失败：{error}</p>}
    </section>
  );
}

/**
 * 玩家模式(创作者模式关)的语音设置面板。
 *
 * 创作者模式里,换声音、试音、调参数进插件抽屉的完整语音页;玩家模式不开放创作工具,
 * 这里用一个极简面板顶上三件事:
 *   - 语音服务:列出已有的连接(名字 / 类型 / 地址),能测试连通(通 xx ms / 失败原因)、
 *     新增、删除(二次确认)。声音档案本身在创作者模式里建,这里只填服务地址。
 *   - 音色:列出已有的声音档案,展示名字、所属连接、是否绑到当前卡;玩家把某个声音
 *     设成这张卡的主声音,或解除。
 *   - 开关和音量:和设置页「声音」栏、右上角快捷面板同一份状态(voiceConfig.enabled、
 *     voicePlayer.setVolume / setMuted),不另造一套。
 *
 * Esc / 点遮罩关(Esc 在捕获阶段拦下,别让它再打开下面的菜单)。键盘操作和 VoiceQuick 一致。
 */

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  debugApi,
  type CardVoices,
  type TtsConnection,
  type TtsApiType,
  type VoiceProfile,
} from '../lib/api';
import { castOf, normalizeVoiceConfig, type VoiceCast, type VoicePluginConfig } from '../plugins/voice';
import { useVoice, voicePlayer } from './voice';
import { Seg } from './VNSettingsPage';
import {
  bindMainRequest,
  describeConnTest,
  PVS_EMPTY,
  unbindRequest,
  voiceListNote,
  type ConnTest,
} from './playerVoice';

const API_NAMES: Record<TtsConnection['api_type'], string> = {
  gpt_sovits: 'GPT-SoVITS',
  indextts: 'IndexTTS',
  openai_audio: 'OpenAI 兼容',
};

const API_TYPES: { value: TtsApiType; name: string }[] = [
  { value: 'gpt_sovits', name: 'GPT-SoVITS' },
  { value: 'indextts', name: 'IndexTTS' },
  { value: 'openai_audio', name: 'OpenAI 兼容' },
];

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Props {
  /** 当前卡;没选角色是 null(绑定按钮也一起禁用) */
  cardId: string | null;
  voiceConfig: VoicePluginConfig;
  onChangeVoiceConfig: (next: VoicePluginConfig) => void;
  /** 面板里把声音绑到 / 解绑当前卡之后,把新的 cast 交给 VN 界面立刻换声音(不用等插件重读) */
  onCastChange: (cast: VoiceCast) => void;
  onClose: () => void;
}

export function PlayerVoiceSheet({ cardId, voiceConfig, onChangeVoiceConfig, onCastChange, onClose }: Props) {
  const voice = useVoice();
  // 每次成功增删连接、改绑定后 +1,重新拉连接 / 声音 / 当前卡绑定
  const [revision, setRevision] = useState(0);
  const [connections, setConnections] = useState<TtsConnection[] | null>(null);
  const [profiles, setProfiles] = useState<VoiceProfile[] | null>(null);
  const [binding, setBinding] = useState<CardVoices | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 逐连接的测试结果(id → 状态)
  const [tests, setTests] = useState<Record<string, ConnTest>>({});
  const testSeq = useRef(0);

  // 新增连接的临时表单
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<TtsApiType>('gpt_sovits');
  const [newUrl, setNewUrl] = useState('');
  // OpenAI 兼容端点必须有 model / voice 才存得下;key 可选,只写不读
  const [newModel, setNewModel] = useState('tts-1');
  const [newVoice, setNewVoice] = useState('alloy');
  const [newKey, setNewKey] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // 删除连接的二次确认:记着按下去的是哪个
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // 正在改的连接(OpenAI 兼容端点换地址 / 模型 / 音色 / key);null = 没有在改
  const [editing, setEditing] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editVoice, setEditVoice] = useState('');
  const [editKey, setEditKey] = useState('');
  // 绑定 / 删除这类写操作进行中
  const [opBusy, setOpBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  // 打开面板:把连接、声音、当前卡的绑定一次拉齐
  useEffect(() => {
    let live = true;
    setLoadError(null);
    (async () => {
      try {
        const [conns, voices] = await Promise.all([
          debugApi.listTtsConnections(),
          debugApi.listVoices(),
        ]);
        if (!live) return;
        setConnections(conns);
        setProfiles(voices);
      } catch (e) {
        if (live) setLoadError(`读语音配置失败:${errText(e)}`);
        return;
      }
      if (!cardId) {
        if (live) setBinding(null);
        return;
      }
      try {
        const b = await debugApi.getCardVoices(cardId);
        if (live) setBinding(b);
      } catch (e) {
        if (live) setLoadError(`读这张卡的声音失败:${errText(e)}`);
      }
    })();
    return () => {
      live = false;
    };
  }, [revision, cardId]);

  // Esc 关面板。捕获阶段拦下:下面菜单的 Esc 别被触发(VoiceQuick 同一套)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const setVoice = <K extends keyof VoicePluginConfig>(k: K, v: VoicePluginConfig[K]) =>
    onChangeVoiceConfig(normalizeVoiceConfig({ ...voiceConfig, [k]: v }));

  const runTest = async (id: string) => {
    const seq = ++testSeq.current;
    setTests((t) => ({ ...t, [id]: { state: 'testing' } }));
    try {
      const r = await debugApi.testTtsConnection(id);
      if (seq !== testSeq.current) return;
      setTests((t) => ({ ...t, [id]: { state: 'ok', ms: r.ms } }));
    } catch (e) {
      if (seq !== testSeq.current) return;
      setTests((t) => ({ ...t, [id]: { state: 'fail', error: errText(e) } }));
    }
  };

  const addConn = async () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) {
      setAddError('名字和地址都要填');
      return;
    }
    if (newType === 'openai_audio' && (!newModel.trim() || !newVoice.trim())) {
      setAddError('OpenAI 兼容端点要填模型和音色');
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      await debugApi.createTtsConnection(
        newType === 'openai_audio'
          ? {
              name,
              api_type: newType,
              base_url: url,
              model: newModel.trim(),
              voice: newVoice.trim(),
              api_key: newKey.trim() || undefined,
            }
          : { name, api_type: newType, base_url: url },
      );
      setNewName('');
      setNewUrl('');
      setNewKey('');
      setAdding(false);
      setRevision((r) => r + 1);
    } catch (e) {
      setAddError(errText(e));
    } finally {
      setAddBusy(false);
    }
  };

  const deleteConn = async (id: string) => {
    // 第一次按是确认,第二次才真的删
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setOpBusy(true);
    setOpError(null);
    try {
      await debugApi.deleteTtsConnection(id);
      setConfirmId(null);
      setRevision((r) => r + 1);
    } catch (e) {
      setOpError(errText(e));
    } finally {
      setOpBusy(false);
    }
  };

  const startEdit = (c: TtsConnection) => {
    setEditing(c.id);
    setEditUrl(c.base_url);
    setEditModel(c.model);
    setEditVoice(c.voice);
    setEditKey('');
    setOpError(null);
  };

  const saveConn = async (id: string) => {
    if (!editUrl.trim() || !editModel.trim() || !editVoice.trim()) {
      setOpError('地址、模型和音色都要填');
      return;
    }
    setOpBusy(true);
    setOpError(null);
    try {
      await debugApi.updateTtsConnection(id, {
        base_url: editUrl.trim(),
        model: editModel.trim(),
        voice: editVoice.trim(),
        // 空着 = 不改 key(只写不读,界面上也拿不回原来的)
        api_key: editKey.trim() || undefined,
      });
      setEditing(null);
      setEditKey('');
      setRevision((r) => r + 1);
    } catch (e) {
      setOpError(errText(e));
    } finally {
      setOpBusy(false);
    }
  };

  const bindVoice = async (profileId: string, isMain: boolean) => {
    if (!cardId || !binding || !profiles) return;
    setOpBusy(true);
    setOpError(null);
    try {
      const next = isMain ? unbindRequest(binding, profileId) : bindMainRequest(binding, profileId);
      const saved = await debugApi.setCardVoices(cardId, next);
      setBinding(saved);
      onCastChange(castOf(profiles, saved.main, saved.extras));
      setRevision((r) => r + 1);
    } catch (e) {
      setOpError(errText(e));
    } finally {
      setOpBusy(false);
    }
  };

  const stop = (e: SyntheticEvent) => e.stopPropagation();
  const note = voiceListNote({ cardId, connections, profiles });

  return (
    <div className="vn-pvs-layer" onClick={onClose}>
      <div className="vn-pvs-sheet" role="dialog" aria-modal="true" aria-label="语音设置" onClick={stop}>
        <header className="vn-pvs-head">
          <h2>语音设置</h2>
          <span className="vn-page-note">玩家模式:只调服务、音色和音量,声音档案本身在创作者模式里建</span>
          <button className="vn-pvs-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="vn-pvs-body">
          {loadError && <p className="vn-set-error">{loadError}</p>}
          {opError && <p className="vn-set-error">{opError}</p>}

          <div className="vn-set-group">
            语音服务
            <button className="vn-pill" onClick={() => setAdding((a) => !a)}>
              {adding ? '收起' : '新增'}
            </button>
          </div>
          {adding && (
            <div className="vn-pvs-add">
              <label className="vn-pvs-field">
                <span>名字</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="比如 本地 GPT-SoVITS"
                />
              </label>
              <label className="vn-pvs-field">
                <span>类型</span>
                <select value={newType} onChange={(e) => setNewType(e.target.value as TtsApiType)}>
                  {API_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="vn-pvs-field">
                <span>地址</span>
                <input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder={
                    newType === 'openai_audio'
                      ? 'https://host/v1'
                      : newType === 'indextts'
                        ? 'http://127.0.0.1:9890'
                        : 'http://127.0.0.1:9880'
                  }
                  inputMode="url"
                />
              </label>
              {newType === 'openai_audio' && (
                <>
                  <label className="vn-pvs-field">
                    <span>模型</span>
                    <input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="tts-1" />
                  </label>
                  <label className="vn-pvs-field">
                    <span>音色</span>
                    <input value={newVoice} onChange={(e) => setNewVoice(e.target.value)} placeholder="alloy" />
                  </label>
                  <label className="vn-pvs-field">
                    <span>密钥</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder="可留空;只写不读"
                    />
                  </label>
                </>
              )}
              <div className="vn-pvs-add-acts">
                <button className="vn-pill accent" disabled={addBusy} onClick={addConn}>
                  {addBusy ? '正在新增…' : '新增'}
                </button>
                {addError && <span className="vn-pvs-add-error">{addError}</span>}
              </div>
            </div>
          )}
          {connections === null ? (
            <p className="vn-set-note">读取中…</p>
          ) : connections.length === 0 ? (
            <p className="vn-set-note">{PVS_EMPTY.noConnections}</p>
          ) : (
            connections.map((c) => {
              const t = tests[c.id] ?? { state: 'idle' };
              const text = describeConnTest(t);
              return (
                <div className="vn-pvs-conn" key={c.id}>
                  <div className="vn-pvs-conn-main">
                    <span className="vn-pvs-conn-name">{c.name}</span>
                    <span className="vn-pvs-dim">
                      {API_NAMES[c.api_type]}
                      {c.api_type === 'openai_audio' && (
                        <> · {c.model}/{c.voice}{c.has_key ? '' : ' · 没设 key'}</>
                      )}
                      <span className="vn-pvs-url">{c.base_url}</span>
                    </span>
                  </div>
                  <div className="vn-pvs-conn-acts">
                    <span className={`vn-pvs-test${t.state === 'fail' ? ' fail' : ''}`}>{text}</span>
                    <button
                      className="vn-pill vn-pvs-test-btn"
                      disabled={t.state === 'testing'}
                      onClick={() => runTest(c.id)}
                    >
                      测试
                    </button>
                    {c.api_type === 'openai_audio' && (
                      <button
                        className="vn-pill"
                        disabled={opBusy}
                        onClick={() => (editing === c.id ? setEditing(null) : startEdit(c))}
                      >
                        {editing === c.id ? '收起' : '修改'}
                      </button>
                    )}
                    <button
                      className="vn-pill"
                      disabled={opBusy}
                      onClick={() => deleteConn(c.id)}
                    >
                      {confirmId === c.id ? '确认删除?' : '删除'}
                    </button>
                  </div>
                  {editing === c.id && (
                    <div className="vn-pvs-add">
                      <label className="vn-pvs-field">
                        <span>地址</span>
                        <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} inputMode="url" />
                      </label>
                      <label className="vn-pvs-field">
                        <span>模型</span>
                        <input value={editModel} onChange={(e) => setEditModel(e.target.value)} />
                      </label>
                      <label className="vn-pvs-field">
                        <span>音色</span>
                        <input value={editVoice} onChange={(e) => setEditVoice(e.target.value)} />
                      </label>
                      <label className="vn-pvs-field">
                        <span>密钥</span>
                        <input
                          type="password"
                          autoComplete="off"
                          value={editKey}
                          onChange={(e) => setEditKey(e.target.value)}
                          placeholder={c.has_key ? '已设置;空着 = 不改' : '没设 key'}
                        />
                      </label>
                      <div className="vn-pvs-add-acts">
                        <button className="vn-pill accent" disabled={opBusy} onClick={() => void saveConn(c.id)}>
                          {opBusy ? '正在保存…' : '保存'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          <div className="vn-set-group">
            音色
            <span className="vn-set-note">把已有的声音绑到这张卡,角色说话就用它</span>
          </div>
          {note && note !== PVS_EMPTY.noConnections && <p className="vn-set-note">{note}</p>}
          {profiles === null ? (
            <p className="vn-set-note">读取中…</p>
          ) : (
            profiles.map((p) => {
              const conn = connections?.find((c) => c.id === p.connection_id);
              const isMain = binding?.main === p.id;
              const isExtra = Boolean(binding && !isMain && binding.extras.includes(p.id));
              return (
                <div className="vn-pvs-voice" key={p.id}>
                  <div className="vn-pvs-voice-main">
                    <span className="vn-pvs-voice-name">{p.name}</span>
                    {isMain && <span className="vn-pvs-badge main">主声音</span>}
                    {isExtra && <span className="vn-pvs-badge">备用</span>}
                    <span className="vn-pvs-dim">{conn ? conn.name : '服务没找到'}</span>
                  </div>
                  <button
                    className="vn-pill"
                    disabled={!cardId || binding === null || opBusy}
                    onClick={() => bindVoice(p.id, isMain)}
                  >
                    {isMain ? '解除' : '设为主声音'}
                  </button>
                </div>
              );
            })
          )}

          <div className="vn-set-group">开关和音量</div>
          <div className="vn-pvs-row">
            <span className="vn-pvs-label">语音合成</span>
            <Seg
              options={[
                { value: true, name: '开' },
                { value: false, name: '关' },
              ]}
              value={voiceConfig.enabled}
              onPick={(v) => setVoice('enabled', v)}
            />
          </div>
          {voiceConfig.enabled && (
            <div className="vn-pvs-row">
              <span className="vn-pvs-label">语音音量</span>
              <div className="vn-pvs-volume">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(voice.volume * 100)}
                  aria-label="语音音量"
                  onChange={(e) => {
                    voicePlayer.setVolume(Number(e.target.value) / 100);
                    if (voice.muted) voicePlayer.setMuted(false);
                  }}
                />
                <button
                  className={`vn-pill vn-pvs-mute${voice.muted ? ' on' : ''}`}
                  onClick={() => voicePlayer.setMuted(!voice.muted)}
                  aria-pressed={voice.muted}
                >
                  {voice.muted ? '静音' : `${Math.round(voice.volume * 100)}%`}
                </button>
              </div>
            </div>
          )}
          {voice.lastError && <p className="vn-set-error">语音最近一次失败:{voice.lastError}</p>}
          <p className="vn-pvs-note">
            更细的念法(等不等语音、情绪、翻页)在设置 → 声音;声音档案的参考音频、情绪表、参数在创作者模式里调
          </p>
        </div>
      </div>
    </div>
  );
}

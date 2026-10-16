import { useEffect, useState } from 'react';
import { Icon, Wave } from './icons';
import type { Live } from './useLive';
import type { ModelStatus } from './types';
const languages = [{ code: 'en', name: 'English' }, { code: 'ja', name: '日本語' }, { code: 'de', name: 'Deutsch' }, { code: 'fr', name: 'Français' }, { code: 'es', name: 'Español' }, { code: 'it', name: 'Italiano' }, { code: 'pt', name: 'Português' }, { code: 'zh', name: '中文' }, { code: 'ko', name: '한국어' }];
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span className="switch" aria-hidden="true"/></label>;
}
function ModelRow({ title, status }: { title: string; status?: ModelStatus }) {
  return <div className="model-row"><span>{title}</span><span className={`model-state ${status?.ready ? 'ready' : ''}`} title={status?.detail}><i/>{status ? status.ready ? '準備完了' : '要準備' : '未確認'}</span></div>;
}
export function Controls({ live }: { live: Live }) {
  const { settings, save, state, latest, history, visible, locked, error, setError, message, partial, readiness, checking, check, start, stop } = live;
  const active = state !== 'stopped';
  const [tab, setTab] = useState('live');
  useEffect(() => { void check(); }, []);
  async function updateSource(source: string) { await save({ ...settings, source, target: source === settings.target ? settings.source : settings.target }); }
  async function updateTarget(target: string) { await save({ ...settings, target, source: target === settings.source ? settings.target : settings.source }); }
  return <main className="controller">
    <header className="titlebar"><span className="wordmark">kotoba</span><span className="titlebar-caption">ライブ字幕翻訳</span></header>
    <div className="control-body">
      <div className="tabs" aria-label="表示"><button className={tab === 'live' ? 'selected' : ''} onClick={() => setTab('live')}>ライブ翻訳</button><button className={tab === 'history' ? 'selected' : ''} onClick={() => setTab('history')}>履歴<span>{history.length || ''}</span></button></div>
      {tab === 'live' ? <>
        <h1>音声を、あなたの言葉に。</h1>
        <p className="intro">動画はそのまま。翻訳字幕を、もうひとつのウィンドウに。</p>
        <div className="audio-source"><Wave/><div><strong>Macのシステム音声</strong><span>YouTube・ブラウザ・動画アプリ</span></div><span className={`audio-dot ${state === 'listening' ? 'listening' : ''}`}/></div>
        <div className="language-row"><label>音声の言語<select aria-label="音声の言語" disabled={active} value={settings.source} onChange={(event) => updateSource(event.target.value)}>{languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}</select></label><span className="language-arrow">→</span><label>字幕の言語<select aria-label="字幕の言語" disabled={active} value={settings.target} onChange={(event) => updateTarget(event.target.value)}>{languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}</select></label></div>
        <button className={`primary start ${active ? 'active' : ''}`} onClick={active ? stop : start} disabled={!window.kotoba || state === 'starting' || state === 'stopping'}><Icon name={active ? 'stop' : 'play'}/>{state === 'starting' ? 'モデルを読み込み中…' : state === 'stopping' ? '字幕を確定中…' : state === 'listening' ? '翻訳を停止' : '翻訳を開始'}</button>
        <p className="session-status" role="status">{message || (state === 'listening' ? partial || '再生中の音声を翻訳しています' : '初回の開始時はモデルの読み込みに時間がかかります')}</p>
        {error ? <div className="error" role="alert"><span>{error}</span><button aria-label="エラーを閉じる" onClick={() => setError('')}><Icon name="close"/></button></div> : null}
        <section className="settings-section" aria-label="字幕設定">
          <Toggle label="字幕ウィンドウを表示" checked={visible} onChange={(value) => { void window.kotoba?.overlay(value); }}/>
          <label className="slider-label"><span>字幕の文字サイズ</span><output>{settings.fontSize} <small>px</small></output><input aria-label="字幕の文字サイズ" type="range" min="24" max="72" step="2" value={settings.fontSize} onChange={(event) => save({ ...settings, fontSize: Number(event.target.value) })}/></label>
          <Toggle label="原文も表示" checked={settings.showOriginal} onChange={(value) => save({ ...settings, showOriginal: value })}/>
          <details><summary>表示を調整</summary><div className="advanced">
            <label className="slider-label"><span>背景の濃さ</span><output>{Math.round(settings.background * 100)}%</output><input type="range" aria-label="背景の濃さ" min="0" max="0.85" step="0.05" value={settings.background} onChange={(event) => save({ ...settings, background: Number(event.target.value) })}/></label>
            <label className="expiry-label">字幕を消すまで<select aria-label="字幕を消すまで" value={settings.expiry} onChange={(event) => save({ ...settings, expiry: Number(event.target.value) })}>{[6, 12, 20, 30].map((value) => <option key={value} value={value}>{value}秒</option>)}</select></label>
            <Toggle label="クリックを動画に通す" checked={locked} onChange={(value) => { void window.kotoba?.lock(value); }}/><p className="hint">⌘⇧Lで解除すると字幕を移動できます。</p>
          </div></details>
          <button className="secondary full" onClick={() => { void window.kotoba?.hideController(); }}><Icon name="external"/>字幕だけにする<span className="shortcut">⌘⇧Kで戻る</span></button>
        </section>
        <section className="models"><div className="section-heading"><h2>ローカルモデル</h2><button aria-label="準備状況を確認" title="準備状況を確認" disabled={checking} onClick={check}><Icon name="refresh"/></button></div><div className="model-list"><ModelRow title="Nemotron 3.5" status={readiness?.asr}/><ModelRow title="TranslateGemma 4B" status={readiness?.translation}/></div>
          {readiness ? <details className="diagnostics"><summary>準備状況の詳細</summary><ul>{[['音声取得', readiness.capture], ['文字起こし', readiness.asr], ['翻訳', readiness.translation]].map(([name, item]) => <li key={name as string}><strong>{name as string}</strong><p>{(item as ModelStatus).detail}</p></li>)}</ul></details> : null}
        </section>
        {latest ? <section className="last-caption"><span>最新の字幕</span><p>{latest.text}</p></section> : null}
        <footer><Icon name="lock"/><span>音声と字幕は、このMacの中だけに。</span></footer>
      </> : <section className="history"><div className="history-header"><h1>この起動中の履歴</h1><div className="export-buttons"><button className="secondary" disabled={!history.length} onClick={() => { void window.kotoba?.export('txt'); }}><Icon name="download"/>TXT</button><button className="secondary" disabled={!history.length} onClick={() => { void window.kotoba?.export('srt'); }}>SRT</button></div></div><p className="intro">直近1,000件を保持します。アプリの終了時に消去されます。</p>{history.length ? <ol className="transcript">{history.map((item, index) => <li key={`${item.id}-${index}`}><time>{new Date(item.receivedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><p>{item.text}</p><p className="source-text">{item.source}</p></li>)}</ol> : <div className="empty"><Wave/><p>会話はここに記録されます。</p><span>翻訳を開始して、動画を再生してください。</span></div>}</section>}
    </div>
  </main>;
}

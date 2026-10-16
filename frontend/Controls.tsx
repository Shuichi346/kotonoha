import { useEffect, useState } from 'react';
import { Icon, Wave } from './icons';
import type { Live } from './useLive';
import type { ModelStatus } from './types';
import { labels, uiLanguage } from './i18n';
const languages = [{ code: 'en', name: 'English' }, { code: 'ja', name: '日本語' }, { code: 'de', name: 'Deutsch' }, { code: 'fr', name: 'Français' }, { code: 'es', name: 'Español' }, { code: 'it', name: 'Italiano' }, { code: 'pt', name: 'Português' }, { code: 'zh', name: '中文' }, { code: 'ko', name: '한국어' }];
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span className="switch" aria-hidden="true"/></label>;
}
function ModelRow({ title, status, text }: { title: string; status?: ModelStatus; text: ReturnType<typeof labels> }) {
  return <div className="model-row"><span>{title}</span><span className={`model-state ${status?.ready ? 'ready' : ''}`} title={status?.detail}><i/>{status ? status.ready ? text.ready : text.needsSetup : text.unchecked}</span></div>;
}
export function Controls({ live }: { live: Live }) {
  const { settings, save, state, latest, history, visible, locked, error, setError, message, partial, readiness, checking, check, start, stop } = live;
  const text = labels(settings.uiLanguage);
  const active = state !== 'stopped';
  const [tab, setTab] = useState('live');
  useEffect(() => { void check(); }, [settings.uiLanguage]);
  async function updateSource(source: string) { await save({ ...settings, source, target: source === settings.target ? settings.source : settings.target }); }
  async function updateTarget(target: string) { await save({ ...settings, target, source: target === settings.source ? settings.target : settings.source }); }
  return <main className="controller">
    <header className="titlebar"><span className="wordmark">kotonoha</span><span className="titlebar-caption">{text.tagline}</span></header>
    <div className="control-body">
      <label className="interface-language">{text.interfaceLanguage}<select aria-label={text.interfaceLanguage} value={uiLanguage(settings.uiLanguage)} onChange={(event) => save({ ...settings, uiLanguage: uiLanguage(event.target.value) })}><option value="ja">日本語</option><option value="en">English</option></select></label>
      <div className="tabs" aria-label={text.view}><button className={tab === 'live' ? 'selected' : ''} onClick={() => setTab('live')}>{text.live}</button><button className={tab === 'history' ? 'selected' : ''} onClick={() => setTab('history')}>{text.history}<span>{history.length || ''}</span></button></div>
      {tab === 'live' ? <>
        <h1>{text.headline}</h1>
        <p className="intro">{text.intro}</p>
        <div className="audio-source"><Wave/><div><strong>{text.systemAudio}</strong><span>{text.audioApps}</span></div><span className={`audio-dot ${state === 'listening' ? 'listening' : ''}`}/></div>
        <div className="language-row"><label>{text.sourceLanguage}<select aria-label={text.sourceLanguage} disabled={active} value={settings.source} onChange={(event) => updateSource(event.target.value)}>{languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}</select></label><span className="language-arrow">→</span><label>{text.targetLanguage}<select aria-label={text.targetLanguage} disabled={active} value={settings.target} onChange={(event) => updateTarget(event.target.value)}>{languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}</select></label></div>
        <button className={`primary start ${active ? 'active' : ''}`} onClick={active ? stop : start} disabled={!window.kotonoha || state === 'starting' || state === 'stopping'}><Icon name={active ? 'stop' : 'play'}/>{state === 'starting' ? text.loading : state === 'stopping' ? text.stopping : state === 'listening' ? text.stop : text.start}</button>
        <p className="session-status" role="status">{message || (state === 'listening' ? partial || text.listening : text.firstStart)}</p>
        {error ? <div className="error" role="alert"><span>{error}</span><button aria-label={text.dismissError} onClick={() => setError('')}><Icon name="close"/></button></div> : null}
        <section className="settings-section" aria-label={text.subtitleSettings}>
          <Toggle label={text.showOverlay} checked={visible} onChange={(value) => { void window.kotonoha?.overlay(value); }}/>
          <label className="slider-label"><span>{text.fontSize}</span><output>{settings.fontSize} <small>px</small></output><input aria-label={text.fontSize} type="range" min="24" max="72" step="2" value={settings.fontSize} onChange={(event) => save({ ...settings, fontSize: Number(event.target.value) })}/></label>
          <Toggle label={text.showOriginal} checked={settings.showOriginal} onChange={(value) => save({ ...settings, showOriginal: value })}/>
          <details><summary>{text.adjustDisplay}</summary><div className="advanced">
            <label className="slider-label"><span>{text.background}</span><output>{Math.round(settings.background * 100)}%</output><input type="range" aria-label={text.background} min="0" max="0.85" step="0.05" value={settings.background} onChange={(event) => save({ ...settings, background: Number(event.target.value) })}/></label>
            <label className="expiry-label">{text.expiry}<select aria-label={text.expiry} value={settings.expiry} onChange={(event) => save({ ...settings, expiry: Number(event.target.value) })}>{[6, 12, 20, 30].map((value) => <option key={value} value={value}>{value}{text.seconds}</option>)}</select></label>
            <Toggle label={text.clickThrough} checked={locked} onChange={(value) => { void window.kotonoha?.lock(value); }}/><p className="hint">{text.unlockHint}</p>
          </div></details>
          <button className="secondary full" onClick={() => { void window.kotonoha?.hideController(); }}><Icon name="external"/>{text.subtitlesOnly}<span className="shortcut">{text.returnShortcut}</span></button>
        </section>
        <section className="models"><div className="section-heading"><h2>{text.models}</h2><button aria-label={text.checkReadiness} title={text.checkReadiness} disabled={checking} onClick={check}><Icon name="refresh"/></button></div><div className="model-list"><ModelRow text={text} title="Nemotron 3.5" status={readiness?.asr}/><ModelRow text={text} title="TranslateGemma 4B" status={readiness?.translation}/></div>
          {readiness ? <details className="diagnostics"><summary>{text.readinessDetails}</summary><ul>{[[text.capture, readiness.capture], [text.transcription, readiness.asr], [text.translation, readiness.translation]].map(([name, item]) => <li key={name as string}><strong>{name as string}</strong><p>{(item as ModelStatus).detail}</p></li>)}</ul></details> : null}
        </section>
        {latest ? <section className="last-caption"><span>{text.latestCaption}</span><p>{latest.text}</p></section> : null}
        <footer><Icon name="lock"/><span>{text.privacy}</span></footer>
      </> : <section className="history"><div className="history-header"><h1>{text.sessionHistory}</h1><div className="export-buttons"><button className="secondary" disabled={!history.length} onClick={() => { void window.kotonoha?.export('txt'); }}><Icon name="download"/>TXT</button><button className="secondary" disabled={!history.length} onClick={() => { void window.kotonoha?.export('srt'); }}>SRT</button></div></div><p className="intro">{text.historyIntro}</p>{history.length ? <ol className="transcript">{history.map((item, index) => <li key={`${item.id}-${index}`}><time>{new Date(item.receivedAt).toLocaleTimeString(settings.uiLanguage === 'en' ? 'en-US' : 'ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><p>{item.text}</p><p className="source-text">{item.source}</p></li>)}</ol> : <div className="empty"><Wave/><p>{text.historyEmpty}</p><span>{text.historyEmptyHint}</span></div>}</section>}
    </div>
  </main>;
}

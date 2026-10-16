import { useEffect, useState } from 'react';
import { Icon } from './icons';
import type { Live } from './useLive';
export function Overlay({ live }: { live: Live }) {
  const { latest, settings, state, locked } = live;
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!latest) { setFresh(false); return; }
    const remaining = settings.expiry * 1000 - (Date.now() - latest.receivedAt);
    setFresh(remaining > 0);
    const timer = setTimeout(() => setFresh(false), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [latest, settings.expiry]);
  return <main className={`overlay ${locked ? 'is-locked' : ''}`} aria-label="字幕ウィンドウ">
    <div className="overlay-controls">
      <span className="drag-handle" title="ドラッグして字幕を移動"><Icon name="drag"/></span>
      <button title="操作画面を表示 (⌘⇧K)" aria-label="操作画面を表示" onClick={() => window.kotoba?.showController()}><Icon name="settings"/></button>
      <button title="クリックを透過 (⌘⇧Lで解除)" aria-label="字幕へのクリックを透過" onClick={() => window.kotoba?.lock(true)}><Icon name="lock"/></button>
      <button title="字幕を隠す" aria-label="字幕を隠す" onClick={() => window.kotoba?.overlay(false)}><Icon name="close"/></button>
    </div>
    <div className="caption-area" aria-live="polite" aria-atomic="true" style={{ fontSize: settings.fontSize }}>
      {fresh && latest ? <div className="caption-lines" style={{ backgroundColor: `rgba(0,0,0,${settings.background})` }}>
        {settings.showOriginal ? <p className="caption-original">{latest.source}</p> : null}
        <p className="caption-text">{latest.text}</p>
      </div> : null}
    </div>
    {!fresh ? <div className="overlay-hint">{state === 'listening' ? '音声を待っています' : 'ここに翻訳字幕が表示されます'}<span>ドラッグで移動 · ⌘⇧Kで操作画面</span></div> : null}
    <div className="resize-corner" aria-hidden="true"/>
  </main>;
}

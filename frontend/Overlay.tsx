import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { labels } from './i18n';
import type { Live } from './useLive';
export function Overlay({ live }: { live: Live }) {
  const { latest, settings, state, locked } = live;
  const text = labels(settings.uiLanguage);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!latest) { setFresh(false); return; }
    const remaining = settings.expiry * 1000 - (Date.now() - latest.receivedAt);
    setFresh(remaining > 0);
    const timer = setTimeout(() => setFresh(false), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [latest, settings.expiry]);
  return <main className={`overlay ${locked ? 'is-locked' : ''} ${!fresh ? 'is-empty' : ''}`} aria-label={text.overlay}>
    <div className="overlay-controls">
      <span className="drag-handle" title={text.drag}><Icon name="drag"/></span>
      <button title={text.showControllerTitle} aria-label={text.showController} onClick={() => window.kotonoha?.showController()}><Icon name="settings"/></button>
      <button title={text.lockOverlayTitle} aria-label={text.lockOverlay} onClick={() => window.kotonoha?.lock(true)}><Icon name="lock"/></button>
      <button title={text.hideOverlay} aria-label={text.hideOverlay} onClick={() => window.kotonoha?.overlay(false)}><Icon name="close"/></button>
    </div>
    <div className="caption-area" aria-live="polite" aria-atomic="true" style={{ fontSize: settings.fontSize }}>
      {fresh && latest ? <div className="caption-lines" style={{ backgroundColor: `rgba(0,0,0,${settings.background})` }}>
        {settings.showOriginal ? <p className="caption-original">{latest.source}</p> : null}
        <p className="caption-text">{latest.text}</p>
      </div> : null}
    </div>
    {!fresh ? <div className="overlay-hint">{state === 'listening' ? text.waitingForAudio : text.overlayEmpty}<span>{locked ? text.overlayLockedHint : text.overlayHint}</span></div> : null}
    <div className="resize-corner" aria-hidden="true"/>
  </main>;
}

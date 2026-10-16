import { useEffect, useState } from 'react';
import { labels, uiLanguage } from './i18n';
import type { Readiness, SessionState, Settings, Subtitle } from './types';
export const defaults: Settings = { source: 'en', target: 'ja', uiLanguage: 'ja', fontSize: 40, showOriginal: true, background: 0, expiry: 12 };
export function useLive() {
  const [settings, setSettings] = useState(defaults);
  const [state, setState] = useState<SessionState>('stopped');
  const [latest, setLatest] = useState<Subtitle | null>(null);
  const [history, setHistory] = useState<Subtitle[]>([]);
  const [visible, setVisible] = useState(false);
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [partial, setPartial] = useState('');
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [checking, setChecking] = useState(false);
  async function check() {
    if (!window.kotonoha) return;
    setChecking(true);
    try { setReadiness(await window.kotonoha.status()); } catch (error) { setError(String(error)); }
    finally { setChecking(false); }
  }
  useEffect(() => {
    if (!window.kotonoha) return;
    let mounted = true;
    const unsubscribe = window.kotonoha.subscribe((event) => {
      if (event.type === 'subtitle') { setLatest(event); setPartial(''); setHistory((previous) => [...previous.slice(-999), event]); }
      if (event.type === 'partial') setPartial(event.text);
      if (event.type === 'clear') { setLatest(null); setPartial(''); }
      if (event.type === 'settings') { setSettings({ ...event.settings, uiLanguage: uiLanguage(event.settings.uiLanguage) }); setMessage(''); }
      if (event.type === 'overlay') { setVisible(event.visible); setLocked(event.locked); }
      if (event.type === 'status') { setState(event.state); setMessage(event.message ?? ''); if (event.state === 'stopped') setPartial(''); }
      if (event.type === 'error') setError(event.message);
    });
    window.kotonoha.snapshot().then((snapshot) => {
      if (mounted) { setSettings({ ...snapshot.settings, uiLanguage: uiLanguage(snapshot.settings.uiLanguage) }); setState(snapshot.state); setLatest(snapshot.latest); setHistory(snapshot.history); setVisible(snapshot.visible); setLocked(snapshot.locked); }
    }).catch((error) => mounted && setError(String(error)));
    return () => { mounted = false; unsubscribe(); };
  }, []);
  async function save(value: Settings) {
    try { const result = await window.kotonoha?.settings(value); if (result) setSettings({ ...result, uiLanguage: uiLanguage(result.uiLanguage) }); }
    catch (error) { setError(String(error)); }
  }
  async function start() {
    setError(''); setMessage(''); setState('starting'); setLatest(null);
    try { await window.kotonoha?.start(); } catch (error) { setError(String(error)); setState('stopped'); }
  }
  async function stop() {
    setState('stopping');
    try { await window.kotonoha?.stop(); } catch (error) { setError(String(error)); setState('stopped'); }
  }
  return { settings, save, state, latest, history, visible, locked, error: window.kotonoha ? error : labels(settings.uiLanguage).desktopRequired, setError, message, partial, readiness, checking, check, start, stop };
}
export type Live = ReturnType<typeof useLive>;

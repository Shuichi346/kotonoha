import { useEffect, useState } from 'react';
import type { Readiness, SessionState, Settings, Subtitle } from './types';
export const defaults: Settings = { source: 'en', target: 'ja', fontSize: 40, showOriginal: true, background: 0, expiry: 12 };
export function useLive() {
  const [settings, setSettings] = useState(defaults);
  const [state, setState] = useState<SessionState>('stopped');
  const [latest, setLatest] = useState<Subtitle | null>(null);
  const [history, setHistory] = useState<Subtitle[]>([]);
  const [visible, setVisible] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [partial, setPartial] = useState('');
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [checking, setChecking] = useState(false);
  async function check() {
    if (!window.kotoba) return;
    setChecking(true);
    try { setReadiness(await window.kotoba.status()); } catch (error) { setError(String(error)); }
    finally { setChecking(false); }
  }
  useEffect(() => {
    if (!window.kotoba) { setError('デスクトップアプリで開いてください。ターミナルで npm start を実行できます。'); return; }
    let mounted = true;
    const unsubscribe = window.kotoba.subscribe((event) => {
      if (event.type === 'subtitle') { setLatest(event); setPartial(''); setHistory((previous) => [...previous.slice(-999), event]); }
      if (event.type === 'partial') setPartial(event.text);
      if (event.type === 'clear') { setLatest(null); setPartial(''); }
      if (event.type === 'settings') setSettings(event.settings);
      if (event.type === 'overlay') { setVisible(event.visible); setLocked(event.locked); }
      if (event.type === 'status') { setState(event.state); setMessage(event.message ?? ''); if (event.state === 'stopped') setPartial(''); }
      if (event.type === 'error') setError(event.message);
    });
    window.kotoba.snapshot().then((snapshot) => {
      if (mounted) { setSettings(snapshot.settings); setState(snapshot.state); setLatest(snapshot.latest); setHistory(snapshot.history); setVisible(snapshot.visible); setLocked(snapshot.locked); }
    }).catch((error) => mounted && setError(String(error)));
    return () => { mounted = false; unsubscribe(); };
  }, []);
  async function save(value: Settings) {
    try { const result = await window.kotoba?.settings(value); if (result) setSettings(result); }
    catch (error) { setError(String(error)); }
  }
  async function start() {
    setError(''); setMessage(''); setState('starting'); setLatest(null);
    try { await window.kotoba?.start(); } catch (error) { setError(String(error)); setState('stopped'); }
  }
  async function stop() {
    setState('stopping');
    try { await window.kotoba?.stop(); } catch (error) { setError(String(error)); setState('stopped'); }
  }
  return { settings, save, state, latest, history, visible, locked, error, setError, message, partial, readiness, checking, check, start, stop };
}
export type Live = ReturnType<typeof useLive>;

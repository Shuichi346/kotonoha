import { useEffect, useRef, useState } from 'react';
import { labels, uiLanguage } from './i18n';
import type { Readiness, SessionState, Settings, Subtitle } from './types';
export const defaults: Settings = { source: 'en', target: 'ja', uiLanguage: 'ja', fontSize: 30, showOriginal: false, background: 0, expiry: 12 };
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
  const [initialized, setInitialized] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [permissionAttempted, setPermissionAttempted] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [permissionIssue, setPermissionIssue] = useState<'' | 'permissionCheckFailed' | 'permissionRequestFailed' | 'permissionSettingsFailed'>('');
  const actionPending = useRef(false);
  const checkSequence = useRef(0);
  function openPermissionGuide() { setError(''); setMessage(''); setPermissionIssue(''); setPermissionOpen(true); }
  async function check(showGuide = false) {
    if (!window.kotonoha) return;
    const sequence = ++checkSequence.current;
    setChecking(true);
    try {
      const result = await window.kotonoha.status();
      if (sequence === checkSequence.current) {
        setReadiness(result);
        setPermissionIssue(result.capture.permission === 'unknown' ? 'permissionCheckFailed' : '');
        if (showGuide && result.capture.permission === 'required') openPermissionGuide();
      }
      return result;
    } catch {
      if (sequence === checkSequence.current) setPermissionIssue('permissionCheckFailed');
    } finally { if (sequence === checkSequence.current) setChecking(false); }
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
      if (event.type === 'error') {
        if (event.code === 'capture_permission_required') {
          setReadiness((previous) => previous ? { ...previous, capture: { ready: false, permission: 'required', detail: '' } } : previous);
          setState('stopped'); openPermissionGuide();
        } else setError(event.message);
      }
    });
    window.kotonoha.snapshot().then((snapshot) => {
      if (mounted) { setSettings({ ...snapshot.settings, uiLanguage: uiLanguage(snapshot.settings.uiLanguage) }); setState(snapshot.state); setLatest(snapshot.latest); setHistory(snapshot.history); setVisible(snapshot.visible); setLocked(snapshot.locked); setInitialized(true); }
    }).catch((error) => mounted && setError(String(error)));
    return () => { mounted = false; unsubscribe(); };
  }, []);
  async function save(value: Settings) {
    try { const result = await window.kotonoha?.settings(value); if (result) setSettings({ ...result, uiLanguage: uiLanguage(result.uiLanguage) }); }
    catch (error) { setError(String(error)); }
  }
  async function start() {
    if (actionPending.current || state !== 'stopped' || !window.kotonoha) return;
    actionPending.current = true;
    setError(''); setMessage('');
    try {
      const status = await check(true);
      if (!status) return;
      if (!status.capture.ready) {
        if (status.capture.permission !== 'required') setError(status.capture.detail);
        return;
      }
      setState('starting'); setLatest(null);
      await window.kotonoha.start();
    } catch (error) { setError(String(error)); setState('stopped'); }
    finally { actionPending.current = false; }
  }
  async function requestCapturePermission() {
    if (actionPending.current || !window.kotonoha) return;
    actionPending.current = true;
    setRequestingPermission(true); setPermissionAttempted(true); setPermissionIssue(''); setError('');
    try {
      const capture = await window.kotonoha.requestCapturePermission();
      setReadiness((previous) => previous ? { ...previous, capture } : previous);
      if (capture.permission === 'unknown' || capture.permission === undefined) setPermissionIssue('permissionRequestFailed');
    } catch { setPermissionIssue('permissionRequestFailed'); }
    finally { actionPending.current = false; setRequestingPermission(false); }
  }
  async function openCaptureSettings() {
    try { await window.kotonoha?.openCaptureSettings(); setPermissionAttempted(true); }
    catch { setPermissionIssue('permissionSettingsFailed'); }
  }
  async function stop() {
    setState('stopping');
    try { await window.kotonoha?.stop(); } catch (error) { setError(String(error)); setState('stopped'); }
  }
  return { settings, save, state, latest, history, visible, locked, error: window.kotonoha ? error : labels(settings.uiLanguage).desktopRequired, setError, message, partial, readiness, checking, initialized, check, start, stop, permissionOpen, setPermissionOpen, permissionAttempted, requestingPermission, permissionIssue, openPermissionGuide, requestCapturePermission, openCaptureSettings };
}
export type Live = ReturnType<typeof useLive>;

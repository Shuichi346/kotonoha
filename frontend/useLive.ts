import { useEffect, useRef, useState } from 'react';
import { labels, uiLanguage } from './i18n';
import type { ModelStatus, Readiness, ServiceFailure, SessionState, Settings, Subtitle } from './types';
export const defaults: Settings = { source: 'en', target: 'ja', uiLanguage: 'ja', commitIntervalSeconds: 15, fontSize: 30, showOriginal: false, background: 0, expiry: 12 };
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
  const [models, setModels] = useState<Pick<Readiness, 'asr' | 'translation'> | null>(null);
  const [capture, setCapture] = useState<ModelStatus | null>(null);
  const readiness = models && capture ? { ...models, capture } : null;
  const [checking, setChecking] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [permissionAttempted, setPermissionAttempted] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [permissionIssue, setPermissionIssue] = useState<'' | 'permissionCheckFailed' | 'permissionRequestFailed' | 'permissionSettingsFailed'>('');
  const [serviceFailure, setServiceFailure] = useState<ServiceFailure['error'] | null>(null);
  const actionPending = useRef(false);
  const checkSequence = useRef(0);
  function showServiceFailure(failure: ServiceFailure['error']) {
    setServiceFailure(failure); setCapture(null); setPermissionIssue(''); setPermissionOpen(false); setError(''); setMessage('');
  }
  function openPermissionGuide() { setError(''); setMessage(''); setPermissionOpen(true); }
  async function check(showGuide = false) {
    if (!window.kotonoha) return;
    const sequence = ++checkSequence.current;
    setChecking(true);
    try {
      const result = await window.kotonoha.status();
      if ('error' in result) {
        if (sequence === checkSequence.current) showServiceFailure(result.error);
        return;
      }
      if (sequence === checkSequence.current) {
        setServiceFailure(null);
        setModels({ asr: result.asr, translation: result.translation });
        setCapture(result.capture);
        setPermissionIssue(result.capture.permission === 'unknown' ? 'permissionCheckFailed' : '');
        if (showGuide && !result.capture.ready) openPermissionGuide();
      }
      return result;
    } catch {
      if (sequence === checkSequence.current) {
        setCapture({ ready: false, permission: 'unknown', detail: '' });
        setPermissionIssue('permissionCheckFailed');
        if (showGuide) openPermissionGuide();
      }
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
        if (event.code === 'runtime_missing' || event.code === 'backend_unavailable') {
          showServiceFailure({ code: event.code, message: event.message });
        } else if (event.code === 'capture_permission_required') {
          setServiceFailure(null);
          setCapture({ ready: false, permission: 'required', detail: '' });
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
      const result = await window.kotonoha.requestCapturePermission();
      if ('error' in result) { showServiceFailure(result.error); return; }
      setServiceFailure(null);
      setCapture(result);
      if (result.permission === 'unknown' || result.permission === undefined) setPermissionIssue('permissionRequestFailed');
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
  return { settings, save, state, latest, history, visible, locked, error: window.kotonoha ? error : labels(settings.uiLanguage).desktopRequired, setError, message, partial, readiness, capture, serviceFailure, checking, initialized, check, start, stop, permissionOpen, setPermissionOpen, permissionAttempted, requestingPermission, permissionIssue, openPermissionGuide, requestCapturePermission, openCaptureSettings };
}
export type Live = ReturnType<typeof useLive>;

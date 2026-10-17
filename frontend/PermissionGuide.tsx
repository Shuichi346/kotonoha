import { useEffect, useRef } from 'react';
import { labels } from './i18n';
import { Icon } from './icons';
import type { Live } from './useLive';

export function PermissionGuide({ live }: { live: Live }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const text = labels(live.settings.uiLanguage);
  const granted = live.readiness?.capture.ready === true;
  const busy = live.requestingPermission || live.checking;
  useEffect(() => {
    if (live.permissionOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!live.permissionOpen && dialog.current?.open) dialog.current?.close();
  }, [live.permissionOpen]);
  function close() { if (!busy) live.setPermissionOpen(false); }
  return <dialog ref={dialog} className="permission-dialog" aria-labelledby="permission-title" aria-describedby="permission-intro" onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="permission-heading"><span className="permission-icon"><Icon name="lock"/></span><h2 id="permission-title">{text.permissionTitle}</h2></div>
    <p id="permission-intro" className="permission-intro">{text.permissionIntro}</p>
    <ol className="permission-steps">
      {[[text.permissionStep1, text.permissionStep1Hint], [text.permissionStep2, text.permissionStep2Hint], [text.permissionStep3, text.permissionStep3Hint]].map(([title, hint]) => <li key={title}><strong>{title}</strong><p>{hint}</p></li>)}
    </ol>
    <p className="permission-privacy">{text.permissionPrivacy}</p>
    <div className={`permission-feedback ${granted ? 'granted' : ''}`} role="status" aria-live="polite">
      {live.permissionIssue ? text[live.permissionIssue] : live.requestingPermission ? text.requestingPermission : granted ? text.permissionGranted : live.permissionAttempted ? text.permissionPending : ''}
    </div>
    {!granted && live.permissionAttempted ? <p className="permission-restart">{text.permissionRestart}</p> : null}
    {granted ? <><p className="permission-next">{text.permissionReadyHint}</p><button className="primary" onClick={close} disabled={busy}>{text.permissionContinue}</button></> : <>
      <button className={`primary ${live.permissionAttempted ? '' : 'permission-request'}`} disabled={busy} onClick={() => { if (live.permissionAttempted) void live.check(); else void live.requestCapturePermission(); }}>{live.requestingPermission ? text.requestingPermission : live.checking ? text.checkingAccess : live.permissionAttempted ? text.checkPermission : text.requestPermission}</button>
      {live.permissionAttempted ? <button className="primary permission-request" disabled={busy} onClick={() => { void live.requestCapturePermission(); }}>{text.requestPermission}</button> : null}
      <div className="permission-actions"><button className="secondary" disabled={busy} onClick={() => { void live.openCaptureSettings(); }}>{text.openSettings}</button><button className="permission-later" disabled={busy} onClick={close}>{text.permissionLater}</button></div>
    </>}
  </dialog>;
}

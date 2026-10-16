import type { CSSProperties } from 'react';
export function Wave({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <svg className={className} style={style} width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true"><path d="M3 11v4m5-8v12m5-17v22m5-17v12m5-8v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}
export function Icon({ name }: { name: 'play' | 'stop' | 'close' | 'drag' | 'lock' | 'settings' | 'external' | 'download' | 'refresh' }) {
  const paths = {
    play: <path d="m7 4 13 8-13 8Z" fill="currentColor" stroke="none"/>,
    stop: <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    drag: <><path d="M9 5v.01M15 5v.01M9 12v.01M15 12v.01M9 19v.01M15 19v.01" strokeWidth="3.5"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 1 3h4l2-3 3-1 2-3-2-2 1-3-3-2-1-3Z"/></>,
    external: <><path d="M14 3h7v7m0-7L11 13M10 4H4v16h16v-6"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    refresh: <><path d="M20 9a8 8 0 1 0 0 7M20 3v6h-6"/></>
  };
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export type Settings = { source: string; target: string; fontSize: number; showOriginal: boolean; background: number; expiry: number };
export type SessionState = 'starting' | 'listening' | 'stopping' | 'stopped';
export type Subtitle = { type: 'subtitle'; id: string; source: string; text: string; start: number; end: number; latency_ms: number; receivedAt: number };
export type ModelStatus = { ready: boolean; detail: string };
export type Readiness = { capture: ModelStatus; asr: ModelStatus; translation: ModelStatus };
export type LiveEvent = Subtitle | { type: 'status'; state: SessionState; message?: string } | { type: 'partial'; text: string } | { type: 'level'; value: number } | { type: 'error'; message: string } | { type: 'settings'; settings: Settings } | { type: 'overlay'; visible: boolean; locked: boolean } | { type: 'clear' };
export type Snapshot = { settings: Settings; state: SessionState; latest: Subtitle | null; history: Subtitle[]; visible: boolean; locked: boolean };
export interface Bridge {
  snapshot(): Promise<Snapshot>;
  status(): Promise<Readiness>;
  settings(value: Settings): Promise<Settings>;
  start(): Promise<void>;
  stop(): Promise<void>;
  overlay(value: boolean): Promise<void>;
  lock(value: boolean): Promise<void>;
  showController(): Promise<void>;
  hideController(): Promise<void>;
  export(format: 'srt' | 'txt'): Promise<boolean>;
  subscribe(callback: (event: LiveEvent) => void): () => void;
}
declare global { interface Window { kotoba?: Bridge } }

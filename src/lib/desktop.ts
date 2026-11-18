type DesktopEvent<T> = { payload: T };
type GameDesktopBridge = {
  isDesktop: boolean;
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(channel: string, callback: (event: DesktopEvent<T>) => void): () => void;
};

declare global {
  interface Window { gameDesktop?: GameDesktopBridge; }
}

export function isDesktop(): boolean {
  return Boolean(window.gameDesktop?.isDesktop);
}

export async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.gameDesktop) throw new Error('Bridge desktop GAME belum tersedia.');
  return window.gameDesktop.invoke<T>(command, args);
}

export async function listen<T>(channel: string, callback: (event: DesktopEvent<T>) => void): Promise<() => void> {
  if (!window.gameDesktop) throw new Error('Bridge desktop GAME belum tersedia.');
  return window.gameDesktop.listen<T>(channel, callback);
}

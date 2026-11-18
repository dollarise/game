export type DesktopRecordingInput = {
  eventType: 'click' | 'board';
  x: number | null;
  y: number | null;
  button: number | null;
  pageUrl: string;
  label: string | null;
};

type DesktopBridge = {
  isDesktop: true;
  browser: {
    navigate(url: string): Promise<boolean>;
    back(): Promise<boolean>;
    forward(): Promise<boolean>;
    reload(): Promise<boolean>;
    setVisible(visible: boolean): Promise<boolean>;
    setBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<boolean>;
    startRecording(): Promise<{ stages: string[]; browser_error: string | null }>;
  };
  onBrowserUrlChanged(callback: (url: string) => void): () => void;
  onBrowserError(callback: (payload: { message: string }) => void): () => void;
  onRecordingInput(callback: (payload: DesktopRecordingInput) => void): () => void;
  onRecordingDiagnostic(callback: (payload: { stage: string }) => void): () => void;
};

declare global {
  interface Window { gameDesktop?: DesktopBridge; }
}

export function isDesktop() {
  return Boolean(window.gameDesktop?.isDesktop);
}

export function desktopInvoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = window.gameDesktop;
  if (!bridge) return Promise.reject(new Error('Fitur ini hanya tersedia pada aplikasi desktop GAME.'));
  let result: Promise<unknown>;
  switch (command) {
    case 'browser_start_recording': result = bridge.browser.startRecording(); break;
    case 'browser_navigate': result = bridge.browser.navigate(String(args?.url ?? '')); break;
    case 'browser_back': result = bridge.browser.back(); break;
    case 'browser_forward': result = bridge.browser.forward(); break;
    case 'browser_reload': result = bridge.browser.reload(); break;
    case 'browser_set_visible': result = bridge.browser.setVisible(Boolean(args?.visible)); break;
    case 'browser_set_bounds': result = bridge.browser.setBounds({
      x: Number(args?.x), y: Number(args?.y), width: Number(args?.width), height: Number(args?.height)
    }); break;
    default: return Promise.reject(new Error('Perintah desktop tidak dikenal: ' + command));
  }
  return result as Promise<T>;
}

export function desktopListen<T>(eventName: string, callback: (event: { payload: T }) => void): Promise<() => void> {
  const bridge = window.gameDesktop;
  if (!bridge) return Promise.resolve(() => undefined);
  let unsubscribe: () => void;
  switch (eventName) {
    case 'recording-diagnostic':
      unsubscribe = bridge.onRecordingDiagnostic((payload) => callback({ payload: payload as T }));
      break;
    case 'recording-input':
      unsubscribe = bridge.onRecordingInput((payload) => callback({
        payload: {
          type: payload.eventType, x: payload.x, y: payload.y, button: payload.button,
          pageUrl: payload.pageUrl, label: payload.label
        } as T
      }));
      break;
    case 'browser-url-changed':
      unsubscribe = bridge.onBrowserUrlChanged((url) => callback({ payload: url as T }));
      break;
    default: return Promise.resolve(() => undefined);
  }
  return Promise.resolve(unsubscribe);
}

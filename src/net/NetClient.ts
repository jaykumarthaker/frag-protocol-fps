import type { ClientMsg, ServerMsg } from './protocol';

/**
 * Thin WebSocket client for online play. Connects and dispatches decoded
 * server messages to the handler the Game installs on `onMessage`. The Game
 * sends `createRoom` / `joinRoom` itself once the socket is open.
 */
export class NetClient {
  private ws: WebSocket | null = null;

  /** Installed by the Game; receives every decoded server message. */
  onMessage: ((msg: ServerMsg) => void) | null = null;
  /** Called if the socket closes unexpectedly after a successful connect. */
  onClose: (() => void) | null = null;

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Open the socket. Resolves once it is connected. */
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      const failTimer = setTimeout(() => reject(new Error('connection timed out')), 8000);

      ws.onopen = () => {
        clearTimeout(failTimer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(failTimer);
        reject(new Error('could not reach server'));
      };
      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          this.onClose?.();
        }
      };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(ev.data as string) as ServerMsg; } catch { return; }
        this.onMessage?.(msg);
      };
    });
  }

  send(msg: ClientMsg) {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null; // intentional close — don't fire onClose
      this.ws.close();
      this.ws = null;
    }
  }
}

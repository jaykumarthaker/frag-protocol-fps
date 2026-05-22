import type { ClientMsg, ServerMsg } from './protocol';

/**
 * Thin WebSocket client for online play. Connects, joins, and dispatches
 * decoded server messages to the handler the Game installs on `onMessage`.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private playerName = 'PLAYER';

  /** Installed by the Game; receives every decoded server message. */
  onMessage: ((msg: ServerMsg) => void) | null = null;
  /** Called if the socket closes unexpectedly after a successful connect. */
  onClose: (() => void) | null = null;

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Connect and send `join`. Resolves once the socket is open. */
  connect(url: string, name: string): Promise<void> {
    this.playerName = name;
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
        this.send({ t: 'join', name: this.playerName });
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

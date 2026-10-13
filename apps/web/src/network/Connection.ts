import type { ServerMessage, Welcome } from './protocol';
import { loadIdentity, saveIdentity } from './identity';

type Listener = (msg: ServerMessage) => void;
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * WebSocket client with automatic reconnection (exponential backoff with jitter), identity
 * handshake ("hello") on every (re)connect, latency measurement and a small outbound queue for
 * messages sent while reconnecting. The server resumes an in-progress match on hello.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private outbox: string[] = [];
  private attempts = 0;
  private pingTimer = 0;
  private reconnectTimer = 0;
  private closedByUser = false;
  private authed = false;
  state: ConnectionState = 'connecting';
  rttMs = 0;
  /** serverTime - localTime, measured from pongs. */
  clockOffsetMs = 0;
  welcome: Welcome | null = null;

  constructor(private readonly url: string) {}

  static defaultUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
    window.addEventListener('online', () => this.reconnectNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state !== 'open') this.reconnectNow();
    });
  }

  private open(): void {
    window.clearTimeout(this.reconnectTimer);
    this.setState(this.attempts === 0 ? 'connecting' : 'reconnecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.authed = false;
    ws.onopen = () => {
      const id = loadIdentity();
      ws.send(JSON.stringify({ type: 'hello', guestId: id.guestId, token: id.token, name: id.name }));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        this.welcome = msg;
        this.authed = true;
        this.attempts = 0;
        saveIdentity({ guestId: msg.guestId, token: msg.token, name: msg.name });
        this.setState('open');
        this.flush();
        this.startPing();
      } else if (msg.type === 'pong') {
        const now = performance.now();
        this.rttMs = this.rttMs === 0 ? now - msg.t : this.rttMs * 0.7 + (now - msg.t) * 0.3;
        this.clockOffsetMs = msg.serverTime - (Date.now() - this.rttMs / 2);
      }
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      this.ws = null;
      this.authed = false;
      if (this.closedByUser) {
        this.setState('closed');
      } else {
        this.scheduleReconnect();
      }
    };
    ws.onerror = () => {
      // onclose follows
    };
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    this.attempts++;
    const delay = Math.min(8000, 400 * 2 ** Math.min(this.attempts, 5)) * (0.75 + Math.random() * 0.5);
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private reconnectNow(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.attempts = Math.max(1, this.attempts);
    this.open();
  }

  private startPing(): void {
    window.clearInterval(this.pingTimer);
    const ping = () => this.sendNow({ type: 'ping', t: performance.now() });
    ping();
    this.pingTimer = window.setInterval(ping, 5000);
  }

  private flush(): void {
    const pending = this.outbox;
    this.outbox = [];
    for (const m of pending) this.ws?.send(m);
  }

  private sendNow(obj: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  /** Sends now if connected and authenticated, otherwise queues (lobby commands only). */
  send(obj: object, queueIfOffline = true): boolean {
    const text = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authed) {
      this.ws.send(text);
      return true;
    }
    if (queueIfOffline) {
      this.outbox.push(text);
      if (this.outbox.length > 20) this.outbox.shift();
    }
    return false;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onState(listener: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(s: ConnectionState): void {
    if (this.state === s) return;
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }
}

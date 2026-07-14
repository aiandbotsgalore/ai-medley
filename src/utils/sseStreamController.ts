export type SSEStreamStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "failed";

export type SSEStreamOptions = {
  onSnapshot?: (data: any) => void;
  onLog?: (message: string) => void;
  onProgress?: (data: any) => void;
  onMetrics?: (data: any) => void;
  onCompleted?: (data: any) => void;
  onManualReviewRequired?: (data: any) => void;
  heartbeatTimeoutMs?: number;
  maxReconnectAttempts?: number;
};

export type EventSourceLike = {
  readyState: number;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close: () => void;
  addEventListener: (
    type: string,
    listener: (event: MessageEvent) => void,
  ) => void;
};

export type SSEStreamControllerOptions = {
  createEventSource: (url: string) => EventSourceLike;
  setStatus: (status: SSEStreamStatus) => void;
  setCurrentSource?: (source: EventSourceLike | null) => void;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  random?: () => number;
  closedReadyState?: number;
};

export class SSEStreamController {
  private currentSource: EventSourceLike | null = null;
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private readonly createEventSource: (url: string) => EventSourceLike;
  private readonly setStatus: (status: SSEStreamStatus) => void;
  private readonly setCurrentSource?: (source: EventSourceLike | null) => void;
  private readonly setTimeoutImpl: typeof setTimeout;
  private readonly clearTimeoutImpl: typeof clearTimeout;
  private readonly random: () => number;
  private readonly closedReadyState: number;

  constructor(options: SSEStreamControllerOptions) {
    this.createEventSource = options.createEventSource;
    this.setStatus = options.setStatus;
    this.setCurrentSource = options.setCurrentSource;
    // Chromium's timer functions require the Window receiver. Storing the
    // native function and later invoking it as a class property changes that
    // receiver and can throw "Illegal invocation" during reconnects.
    this.setTimeoutImpl =
      options.setTimeoutImpl ??
      (((...args: Parameters<typeof setTimeout>) =>
        globalThis.setTimeout(...args)) as typeof setTimeout);
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ??
      (((...args: Parameters<typeof clearTimeout>) =>
        globalThis.clearTimeout(...args)) as typeof clearTimeout);
    this.random = options.random ?? Math.random;
    this.closedReadyState = options.closedReadyState ?? 2;
  }

  private setSource(source: EventSourceLike | null) {
    this.currentSource = source;
    this.setCurrentSource?.(source);
  }

  private clearHeartbeatTimer() {
    if (!this.heartbeatTimer) return;
    this.clearTimeoutImpl(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    this.clearTimeoutImpl(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  connect(sessionId: string, options: SSEStreamOptions = {}) {
    const {
      onLog,
      onSnapshot,
      onProgress,
      onMetrics,
      onCompleted,
      onManualReviewRequired,
      heartbeatTimeoutMs = 45000,
      maxReconnectAttempts = 5,
    } = options;

    this.currentSource?.close();
    this.setSource(null);
    this.clearHeartbeatTimer();
    this.clearReconnectTimer();
    const generation = ++this.generation;
    let lastEventId = 0;

    const rememberEventId = (event: MessageEvent) => {
      const parsed = Number(event.lastEventId || 0);
      if (Number.isFinite(parsed) && parsed > lastEventId) lastEventId = parsed;
    };

    const scheduleReconnect = (attempt: () => void) => {
      if (this.generation !== generation) return;
      if (this.reconnectAttempts < maxReconnectAttempts) {
        this.reconnectAttempts++;
        const jitter = this.random() * 1000;
        const backoff = Math.pow(2, this.reconnectAttempts) * 1000 + jitter;
        this.setStatus("reconnecting");
        this.reconnectTimer = this.setTimeoutImpl(attempt, backoff);
      } else {
        this.setStatus("failed");
      }
    };

    const attempt = () => {
      if (this.generation !== generation) return;
      this.setStatus(
        this.reconnectAttempts === 0 ? "connecting" : "reconnecting",
      );

      const replayQuery = lastEventId
        ? `?lastEventId=${encodeURIComponent(lastEventId)}`
        : "";
      const source = this.createEventSource(
        `/api/session/${sessionId}/stream${replayQuery}`,
      );
      this.setSource(source);

      const resetHeartbeat = () => {
        if (this.generation !== generation) return;
        this.clearHeartbeatTimer();
        this.heartbeatTimer = this.setTimeoutImpl(() => {
          if (this.generation !== generation) return;
          source.close();
          scheduleReconnect(attempt);
        }, heartbeatTimeoutMs);
      };

      source.onopen = () => {
        if (this.generation !== generation) return;
        this.setStatus("connected");
        this.reconnectAttempts = 0;
        resetHeartbeat();
      };

      source.addEventListener("connected", (event: MessageEvent) => {
        if (this.generation !== generation) return;
        resetHeartbeat();
        try {
          const data = JSON.parse(event.data);
          const sequence = Number(data?.sequence || 0);
          if (Number.isFinite(sequence) && sequence > lastEventId)
            lastEventId = sequence;
          onSnapshot?.(data?.snapshot ?? null);
        } catch {}
      });

      source.addEventListener("log", (event: MessageEvent) => {
        if (this.generation !== generation) return;
        rememberEventId(event);
        resetHeartbeat();
        try {
          const data = JSON.parse(event.data);
          if (data.message) onLog?.(data.message);
        } catch {}
      });

      source.addEventListener("progress", (event: MessageEvent) => {
        if (this.generation !== generation) return;
        rememberEventId(event);
        resetHeartbeat();
        try {
          onProgress?.(JSON.parse(event.data));
        } catch {}
      });

      source.addEventListener("metrics", (event: MessageEvent) => {
        if (this.generation !== generation) return;
        rememberEventId(event);
        resetHeartbeat();
        try {
          onMetrics?.(JSON.parse(event.data));
        } catch {}
      });

      source.addEventListener("heartbeat", () => {
        if (this.generation !== generation) return;
        resetHeartbeat();
      });

      source.addEventListener("completed", (event: MessageEvent) => {
        if (this.generation !== generation) return;
        rememberEventId(event);
        resetHeartbeat();
        try {
          onCompleted?.(JSON.parse(event.data));
        } catch {}
        this.clearHeartbeatTimer();
        source.close();
        this.setSource(null);
        this.setStatus("closed");
      });

      source.addEventListener("manual_review_required", (event: MessageEvent) => {
        if (this.generation !== generation) return;
        rememberEventId(event);
        resetHeartbeat();
        try {
          onManualReviewRequired?.(JSON.parse(event.data));
        } catch {}
      });

      source.onerror = () => {
        if (this.generation !== generation) return;
        this.clearHeartbeatTimer();
        if (source.readyState === this.closedReadyState) {
          scheduleReconnect(attempt);
        }
      };
    };

    this.reconnectAttempts = 0;
    attempt();
  }

  disconnect(status: SSEStreamStatus = "closed") {
    this.generation++;
    this.clearHeartbeatTimer();
    this.clearReconnectTimer();
    this.currentSource?.close();
    this.setSource(null);
    this.setStatus(status);
    this.reconnectAttempts = 0;
  }

  dispose() {
    this.disconnect("closed");
  }
}

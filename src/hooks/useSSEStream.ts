import { useRef, useCallback, useEffect, useState } from 'react';

export type SSEStreamStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'failed';

interface SSEStreamOptions {
  onLog?: (message: string) => void;
  onProgress?: (data: any) => void;
  onMetrics?: (data: any) => void;
  onCompleted?: (data: any) => void;
  heartbeatTimeoutMs?: number;
  maxReconnectAttempts?: number;
}

export function useSSEStream() {
  const sseRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streamStatus, setStreamStatus] = useState<SSEStreamStatus>('idle');

  const clearHeartbeatTimer = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearTimeout(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const connect = useCallback((sessionId: string, options: SSEStreamOptions = {}) => {
    const {
      onLog,
      onProgress,
      onMetrics,
      onCompleted,
      heartbeatTimeoutMs = 45000,
      maxReconnectAttempts = 5,
    } = options;

    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    clearHeartbeatTimer();

    const attempt = () => {
      setStreamStatus(reconnectAttemptsRef.current === 0 ? 'connecting' : 'reconnecting');

      const sse = new EventSource(`/api/session/${sessionId}/stream`);
      sseRef.current = sse;

      const resetHeartbeat = () => {
        clearHeartbeatTimer();
        heartbeatTimerRef.current = setTimeout(() => {
          console.warn('[SSEStream] Heartbeat timeout — reconnecting...');
          sse.close();
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current++;
            const jitter = Math.random() * 1000;
            const backoff = Math.pow(2, reconnectAttemptsRef.current) * 1000 + jitter;
            setStreamStatus('reconnecting');
            setTimeout(attempt, backoff);
          } else {
            setStreamStatus('failed');
          }
        }, heartbeatTimeoutMs);
      };

      sse.onopen = () => {
        setStreamStatus('connected');
        reconnectAttemptsRef.current = 0;
        resetHeartbeat();
      };

      sse.addEventListener('log', (e: MessageEvent) => {
        resetHeartbeat();
        try {
          const data = JSON.parse(e.data);
          if (data.message) onLog?.(data.message);
        } catch {}
      });

      sse.addEventListener('progress', (e: MessageEvent) => {
        resetHeartbeat();
        try { onProgress?.(JSON.parse(e.data)); } catch {}
      });

      sse.addEventListener('metrics', (e: MessageEvent) => {
        resetHeartbeat();
        try { onMetrics?.(JSON.parse(e.data)); } catch {}
      });

      sse.addEventListener('completed', (e: MessageEvent) => {
        resetHeartbeat();
        try { onCompleted?.(JSON.parse(e.data)); } catch {}
      });

      sse.onerror = () => {
        clearHeartbeatTimer();
        if (sse.readyState === EventSource.CLOSED) {
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current++;
            const jitter = Math.random() * 1000;
            const backoff = Math.pow(2, reconnectAttemptsRef.current) * 1000 + jitter;
            setStreamStatus('reconnecting');
            setTimeout(attempt, backoff);
          } else {
            setStreamStatus('failed');
          }
        }
      };
    };

    reconnectAttemptsRef.current = 0;
    attempt();
  }, [clearHeartbeatTimer]);

  const disconnect = useCallback(() => {
    clearHeartbeatTimer();
    sseRef.current?.close();
    sseRef.current = null;
    setStreamStatus('closed');
    reconnectAttemptsRef.current = 0;
  }, [clearHeartbeatTimer]);

  useEffect(() => {
    return () => {
      clearHeartbeatTimer();
      sseRef.current?.close();
    };
  }, [clearHeartbeatTimer]);

  return { connect, disconnect, streamStatus, sseRef };
}

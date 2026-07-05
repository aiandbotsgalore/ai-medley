import { useRef, useCallback, useEffect, useState } from "react";
import {
  SSEStreamController,
  type EventSourceLike,
  type SSEStreamOptions,
  type SSEStreamStatus,
} from "../utils/sseStreamController";

export type { SSEStreamStatus };

export function useSSEStream() {
  const sseRef = useRef<EventSource | null>(null);
  const [streamStatus, setStreamStatus] = useState<SSEStreamStatus>("idle");
  const controllerRef = useRef<SSEStreamController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new SSEStreamController({
      createEventSource: (url) =>
        new EventSource(url) as unknown as EventSourceLike,
      setStatus: setStreamStatus,
      setCurrentSource: (source: EventSourceLike | null) => {
        sseRef.current = source as unknown as EventSource | null;
      },
      closedReadyState: EventSource.CLOSED,
    });
  }

  const connect = useCallback(
    (sessionId: string, options: SSEStreamOptions = {}) => {
      controllerRef.current?.connect(sessionId, options);
    },
    [],
  );

  const disconnect = useCallback(() => {
    controllerRef.current?.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
    };
  }, []);

  return { connect, disconnect, streamStatus, sseRef };
}

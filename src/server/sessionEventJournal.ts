export type SessionEvent = {
  id: number;
  event: string;
  data: unknown;
};

export class SessionEventJournal {
  private sequence = 0;
  private events: SessionEvent[] = [];

  constructor(private readonly limit = 200) {}

  append(event: string, data: unknown) {
    const record = { id: ++this.sequence, event, data };
    this.events.push(record);
    if (this.events.length > this.limit) {
      this.events.splice(0, this.events.length - this.limit);
    }
    return record;
  }

  replayAfter(lastEventId: number) {
    return this.events.filter((event) => event.id > lastEventId);
  }

  get currentSequence() {
    return this.sequence;
  }
}

export function encodeSseEvent(record: SessionEvent) {
  return `id: ${record.id}\nevent: ${record.event}\ndata: ${JSON.stringify(record.data)}\n\n`;
}

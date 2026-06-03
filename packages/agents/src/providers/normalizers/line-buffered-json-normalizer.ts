import type { TerminalEvent } from '../../terminal-events';
import type { FenceStateMachine } from './fence-suppression';

type ParseJsonLine = (line: string) => Record<string, unknown>;
type ProcessJsonEvent = (event: Record<string, unknown>) => void;

export class LineBufferedJsonNormalizer {
  private lineBuffer = '';

  constructor(
    private readonly onEvent: (event: TerminalEvent) => void,
    private readonly fence: FenceStateMachine,
    private readonly parseJsonLine: ParseJsonLine,
    private readonly processEvent: ProcessJsonEvent,
  ) {}

  feed(chunk: string): void {
    this.lineBuffer += chunk;

    let newlineIdx = this.lineBuffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = this.lineBuffer.slice(0, newlineIdx).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);

      if (!line) {
        newlineIdx = this.lineBuffer.indexOf('\n');
        continue;
      }

      let event: Record<string, unknown>;
      try {
        event = this.parseJsonLine(line);
      } catch {
        if (!this.fence.isSuppressing) {
          this.onEvent({ kind: 'raw', content: line });
        }
        newlineIdx = this.lineBuffer.indexOf('\n');
        continue;
      }

      this.processEvent(event);
      newlineIdx = this.lineBuffer.indexOf('\n');
    }
  }
}

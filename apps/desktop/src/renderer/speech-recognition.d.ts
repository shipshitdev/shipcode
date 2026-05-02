/**
 * Ambient type declarations for the Web Speech API.
 * TypeScript's lib.dom.d.ts includes SpeechRecognitionEvent and related
 * interfaces but omits the SpeechRecognition constructor and the
 * webkit-prefixed variant used by Chrome/Electron.
 */
declare global {
  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onend: (() => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onstart: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }

  // eslint-disable-next-line @typescript-eslint/no-redeclare
  const SpeechRecognition: {
    new (): SpeechRecognition;
    prototype: SpeechRecognition;
  };

  interface Window {
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export {};

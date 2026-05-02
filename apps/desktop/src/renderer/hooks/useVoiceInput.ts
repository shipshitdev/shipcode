import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceInputError = 'not-allowed' | 'no-speech' | 'network' | 'unknown';

export interface UseVoiceInputOptions {
  /** Called with the latest transcript (interim or final) during recognition. */
  onTranscript: (text: string) => void;
}

export interface UseVoiceInputResult {
  isSupported: boolean;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  error: VoiceInputError | null;
}

/**
 * Browser-native speech-to-text via Web Speech API (webkitSpeechRecognition).
 * Creates a fresh instance per `startListening()` call — instances are single-use.
 * Streams interim + final results via `onTranscript`.
 */
export function useVoiceInput({ onTranscript }: UseVoiceInputOptions): UseVoiceInputResult {
  const isSupported = typeof window !== 'undefined' && 'webkitSpeechRecognition' in window;

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<VoiceInputError | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);

  // Keep callback ref current without re-triggering effects
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  const startListening = useCallback(() => {
    if (!isSupported) return;

    // Abort any existing session
    recognitionRef.current?.abort();

    setError(null);
    setIsListening(true);

    const recognition = new window.webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = ''; // Use browser/OS default language

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      onTranscriptRef.current(transcript);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // 'aborted' is user-initiated stop — not an error
      if (event.error === 'aborted') return;

      const mapped: VoiceInputError =
        event.error === 'not-allowed' || event.error === 'audio-capture'
          ? 'not-allowed'
          : event.error === 'no-speech'
            ? 'no-speech'
            : event.error === 'network' || event.error === 'service-not-allowed'
              ? 'network'
              : 'unknown';

      setError(mapped);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isSupported]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  return { isSupported, isListening, startListening, stopListening, error };
}

import { useEffect, useRef, useCallback } from 'react';
import { getSocket } from '@/lib/socket';

export interface CallEvent {
  cabinetId: string | null;
  cabinetNumber: string | null;
  patientLastName: string;
  patientFirstName: string;
  patientMiddleName: string;
  queueNumber: number | null;
}

interface BoardAudio {
  audioMode: string;
  ttsTemplate: string;
  soundUrl: string | null | undefined;
}

interface Options {
  cabinetIds: string[];
  board: BoardAudio;
  backendBaseUrl: string;
  onCall: (event: CallEvent) => void;
}

export function useCallNotifications({ cabinetIds, board, backendBaseUrl, onCall }: Options) {
  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const queueRef = useRef<CallEvent[]>([]);
  const processingRef = useRef(false);
  const cabinetIdsRef = useRef(cabinetIds);
  const onCallRef = useRef(onCall);

  // Keep refs in sync with latest props without re-subscribing socket
  useEffect(() => { cabinetIdsRef.current = cabinetIds; }, [cabinetIds]);
  useEffect(() => { onCallRef.current = onCall; }, [onCall]);

  const playAudio = useCallback((event: CallEvent) => {
    if (!board.soundUrl) return;

    const audio = audioRef.current;
    audio.src = `${backendBaseUrl}${board.soundUrl}`;

    if (board.audioMode === 'SOUND_TTS') {
      audio.onended = () => {
        const text = board.ttsTemplate
          .replace('{lastName}',   event.patientLastName)
          .replace('{firstName}',  event.patientFirstName)
          .replace('{middleName}', event.patientMiddleName)
          .replace('{cabinet}',    event.cabinetNumber ?? '')
          .replace('{number}',     String(event.queueNumber ?? ''));
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        window.speechSynthesis.speak(utterance);
      };
    } else {
      audio.onended = null;
    }

    audio.play().catch(() => {
      // Autoplay blocked — fallback to TTS only for SOUND_TTS mode
      if (board.audioMode === 'SOUND_TTS') {
        const text = board.ttsTemplate
          .replace('{lastName}',   event.patientLastName)
          .replace('{firstName}',  event.patientFirstName)
          .replace('{middleName}', event.patientMiddleName)
          .replace('{cabinet}',    event.cabinetNumber ?? '')
          .replace('{number}',     String(event.queueNumber ?? ''));
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        window.speechSynthesis.speak(utterance);
      }
    });
  }, [board, backendBaseUrl]);

  const processNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      processingRef.current = false;
      return;
    }
    processingRef.current = true;
    playAudio(next);
    onCallRef.current(next);
  }, [playAudio]);

  const onOverlayDismissed = useCallback(() => {
    processingRef.current = false;
    processNext();
  }, [processNext]);

  useEffect(() => {
    const socket = getSocket();

    const handleCalled = (data: any) => {
      if (!data.cabinetId || !cabinetIdsRef.current.includes(data.cabinetId)) return;

      const event: CallEvent = {
        cabinetId:          data.cabinetId,
        cabinetNumber:      data.cabinetNumber,
        patientLastName:    data.entry?.patient?.lastName ?? '',
        patientFirstName:   data.entry?.patient?.firstName ?? '',
        patientMiddleName:  data.entry?.patient?.middleName ?? '',
        queueNumber:        data.entry?.queueNumber ?? null,
      };

      queueRef.current.push(event);
      if (!processingRef.current) processNext();
    };

    socket.on('queue:called', handleCalled);
    return () => { socket.off('queue:called', handleCalled); };
  }, [processNext]);

  // Chrome 24/7: keep speechSynthesis from freezing
  useEffect(() => {
    const id = setInterval(() => window.speechSynthesis.resume(), 10_000);
    return () => clearInterval(id);
  }, []);

  // Chrome 24/7: reload at 04:00 to prevent browser degradation
  useEffect(() => {
    const now = new Date();
    const next4am = new Date(now);
    next4am.setHours(4, 0, 0, 0);
    if (next4am <= now) next4am.setDate(next4am.getDate() + 1);
    const ms = next4am.getTime() - now.getTime();
    const id = setTimeout(() => window.location.reload(), ms);
    return () => clearTimeout(id);
  }, []);

  return { onOverlayDismissed };
}

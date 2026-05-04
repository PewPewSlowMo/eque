import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { getSocket } from '@/lib/socket';
import { BoardHeader } from './BoardHeader';
import { ActiveCallsPanel } from './ActiveCallsPanel';
import { QueuePanel } from './QueuePanel';
import { CallOverlay } from './CallOverlay';
import { useCallNotifications } from './useCallNotifications';
import type { CallEvent } from './useCallNotifications';

interface Props {
  slug: string;
}

const BACKEND_BASE =
  (import.meta.env.VITE_TRPC_URL as string | undefined)?.replace('/trpc', '') ??
  'http://localhost:3002';

export function BoardView({ slug }: Props) {
  const queryClient = useQueryClient();
  const [overlayQueue, setOverlayQueue] = useState<CallEvent[]>([]);

  const { data, isLoading, isError } = trpc.display.getBySlug.useQuery(
    { slug },
    { staleTime: Infinity, gcTime: Infinity, retry: 3 },
  );

  const handleCall = useCallback((event: CallEvent) => {
    setOverlayQueue([event]);
  }, []);

  const { onOverlayDismissed } = useCallNotifications({
    cabinetIds: data?.cabinetIds ?? [],
    board: data?.board ?? { audioMode: 'SOUND', ttsTemplate: '', soundUrl: null },
    backendBaseUrl: BACKEND_BASE,
    onCall: handleCall,
  });

  const handleDismiss = useCallback(() => {
    setOverlayQueue([]);
    onOverlayDismissed();
    queryClient.invalidateQueries({ queryKey: [['display', 'getBySlug']] });
  }, [onOverlayDismissed, queryClient]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [['display', 'getBySlug']] });
    };
    socket.on('queue:updated', refresh);
    return () => { socket.off('queue:updated', refresh); };
  }, [queryClient]);

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0d1117',
        color: 'rgba(255,255,255,.3)', fontSize: 24, fontFamily: 'Montserrat, sans-serif',
      }}>
        Загрузка...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0d1117',
        color: '#ef4444', fontSize: 24, fontFamily: 'Montserrat, sans-serif',
      }}>
        Табло не найдено
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0d1117', fontFamily: 'Montserrat, Segoe UI, sans-serif',
      overflow: 'hidden',
    }}>
      <BoardHeader boardName={data.board.name} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ActiveCallsPanel calls={data.activeCalls as any} />
        <QueuePanel queue={data.queue as any} columns={data.board.columns} />
      </div>

      {overlayQueue.length > 0 && (
        <CallOverlay calls={overlayQueue} onDismiss={handleDismiss} />
      )}
    </div>
  );
}

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';

export function useQueueSocket() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    const handleQueueUpdated = () => {
      queryClient.invalidateQueries({ queryKey: [['queue', 'getByDoctor']] });
      queryClient.invalidateQueries({ queryKey: [['assignments', 'getActive']] });
    };

    socket.on('queue:updated', handleQueueUpdated);
    socket.on('queue:called', handleQueueUpdated);
    socket.on('assignment:created', handleQueueUpdated);
    socket.on('assignment:ended', handleQueueUpdated);

    return () => {
      socket.off('queue:updated', handleQueueUpdated);
      socket.off('queue:called', handleQueueUpdated);
      socket.off('assignment:created', handleQueueUpdated);
      socket.off('assignment:ended', handleQueueUpdated);
    };
  }, [queryClient]);
}

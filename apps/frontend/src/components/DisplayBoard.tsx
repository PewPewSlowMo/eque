import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { getSocket } from '@/lib/socket';

const PRIORITY_COLOR: Record<string, string> = {
  EMERGENCY: 'text-red-400',
  INPATIENT:  'text-orange-400',
  SCHEDULED:  'text-yellow-400',
  WALK_IN:    'text-green-400',
};

function Clock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-2xl font-mono text-gray-300">
      {time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

export function DisplayBoard() {
  const queryClient = useQueryClient();

  const { data: board = [], isLoading } = trpc.display.getBoard.useQuery(
    undefined,
    { refetchInterval: 15_000 },
  );

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [['display', 'getBoard']] });
    };
    socket.on('queue:called', refresh);
    socket.on('queue:updated', refresh);
    return () => {
      socket.off('queue:called', refresh);
      socket.off('queue:updated', refresh);
    };
  }, [queryClient]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 text-xl">Загрузка...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-wide">Электронная очередь</h1>
        <Clock />
      </div>

      {(board as any[]).length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500 text-xl">Нет активных врачей</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {(board as any[]).map((item: any) => (
            <div
              key={item.assignmentId}
              className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden"
            >
              <div className="bg-blue-700 px-4 py-3 flex items-center justify-between">
                <span className="text-2xl font-bold">Каб. {item.cabinet.number}</span>
                {item.waitingCount > 0 && (
                  <span className="text-sm bg-blue-900 rounded-full px-2 py-0.5">
                    {item.waitingCount} ожид.
                  </span>
                )}
              </div>

              <div className="px-4 pt-3 pb-2 border-b border-gray-800">
                <p className="font-semibold text-sm text-gray-200">
                  {item.doctor.lastName} {item.doctor.firstName}
                </p>
                {item.doctor.specialty && (
                  <p className="text-xs text-gray-500">{item.doctor.specialty}</p>
                )}
              </div>

              <div className="px-4 py-4 min-h-[88px] flex items-center">
                {item.current ? (
                  <div className="flex items-center gap-4">
                    <span
                      className={`text-5xl font-black leading-none ${PRIORITY_COLOR[item.current.priority] ?? 'text-white'}`}
                    >
                      {item.current.queueNumber}
                    </span>
                    <div>
                      <p className="text-lg font-bold leading-tight">
                        {item.current.patientLastName}
                      </p>
                      <p className="text-xs text-gray-400">
                        {item.current.status === 'CALLED' ? 'Вызван' : 'На приёме'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-600 text-sm">Нет вызова</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

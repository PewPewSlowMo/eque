import { useState } from 'react';
import { useUser } from '@/contexts/UserContext';
import { DoctorView } from './DoctorView';
import { RegistrarView } from './RegistrarView';

export function DoctorSelfRegistrarView() {
  const { user } = useUser();
  const [tab, setTab] = useState<'reception' | 'register'>('reception');

  if (!user) return null;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <div className="flex items-center border-b border-border bg-white px-4 shrink-0">
        {[
          { key: 'reception', label: 'Приём' },
          { key: 'register',  label: 'Запись' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`text-[10px] font-semibold px-4 py-2.5 border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'reception'
          ? <DoctorView />
          : <RegistrarView lockedDoctorId={user.id} />}
      </div>
    </div>
  );
}

import { ReactNode } from 'react';
import { useUser } from '@/contexts/UserContext';
import { LogOut } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  ADMIN:           'Администратор',
  REGISTRAR:       'Регистратор',
  CALL_CENTER:     'Колл-центр',
  DOCTOR:          'Врач',
  DEPARTMENT_HEAD: 'Заведующий',
  DIRECTOR:        'Руководитель',
};

interface LayoutProps {
  children: ReactNode;
  title?: string;
}

export function Layout({ children, title }: LayoutProps) {
  const { user, logout } = useUser();

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header
        className="flex items-center justify-between px-4 shrink-0"
        style={{ background: '#00685B', height: 'var(--header-h, 44px)' }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-[11px] font-bold tracking-wide px-2 py-1 rounded-sm"
            style={{ color: '#B39168', border: '1px solid rgba(179,145,104,.4)' }}
          >
            УЛТ. ГОСПИТАЛЬ
          </span>
          {title && (
            <>
              <span className="w-px h-4" style={{ background: 'rgba(255,255,255,.18)' }} />
              <span className="text-[11px] text-white/75 font-medium">{title}</span>
            </>
          )}
        </div>

        {user && (
          <div className="flex items-center gap-2">
            <div
              className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
              style={{
                background: 'rgba(179,145,104,.22)',
                border: '1.5px solid rgba(179,145,104,.5)',
                color: '#B39168',
              }}
            >
              {user.lastName?.[0]}{user.firstName?.[0]}
            </div>
            <div>
              <div className="text-[10px] font-semibold text-white leading-tight">
                {user.lastName} {user.firstName}
              </div>
              <div className="text-[8px] text-white/45 leading-tight">
                {ROLE_LABELS[user.role] ?? user.role}
              </div>
            </div>
            <button
              onClick={logout}
              className="ml-1 text-white/50 hover:text-white/80 transition-colors"
              aria-label="Выйти"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}

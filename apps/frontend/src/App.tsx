import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserProvider, useUser } from '@/contexts/UserContext';
import { trpc, trpcClient } from '@/lib/trpc';
import { Login } from '@/components/Login';
import { Layout } from '@/components/Layout';
import { RegistrarView } from '@/components/RegistrarView';
import { DoctorView } from '@/components/DoctorView';
import { DepartmentHeadView } from '@/components/DepartmentHeadView';
import { DisplayBoard } from '@/components/DisplayBoard';
import { BoardView } from '@/components/board/BoardView';
import { AdminPanel } from '@/components/AdminPanel';
import { Toaster } from 'sonner';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

type AdminViewKey = 'admin' | 'registrar' | 'doctor' | 'head' | 'board';

const ADMIN_VIEWS: { key: AdminViewKey; label: string }[] = [
  { key: 'admin',     label: 'Администрирование' },
  { key: 'registrar', label: 'Регистратура' },
  { key: 'doctor',    label: 'Врач' },
  { key: 'head',      label: 'Заведующий' },
  { key: 'board',     label: 'Табло' },
];

function AdminViewSwitcher({ active, onChange }: {
  active: AdminViewKey;
  onChange: (v: AdminViewKey) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {ADMIN_VIEWS.map(v => (
        <button
          key={v.key}
          onClick={() => onChange(v.key)}
          className="text-[9px] font-semibold px-2.5 py-1 transition-colors"
          style={
            active === v.key
              ? { background: 'rgba(179,145,104,.25)', color: '#B39168', borderRadius: '3px 12px 12px 3px' }
              : { color: 'rgba(255,255,255,.55)', background: 'transparent' }
          }
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function AppContent() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [adminView, setAdminView] = useState<AdminViewKey>('admin');
  const { user, isLoading } = useUser();

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (path !== window.location.pathname) {
      window.history.pushState({}, '', path);
    }
  }, [path]);

  if (path.startsWith('/board/')) {
    const slug = path.replace('/board/', '').split('/')[0];
    return <BoardView slug={slug} />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  if (!user) return <Login />;

  const isAdmin = user.role === 'ADMIN';

  const renderView = () => {
    if (isAdmin) {
      switch (adminView) {
        case 'registrar': return <RegistrarView />;
        case 'doctor':    return <DoctorView />;
        case 'head':      return <DepartmentHeadView />;
        case 'board':     return <DisplayBoard />;
        default:          return <AdminPanel />;
      }
    }
    switch (user.role) {
      case 'REGISTRAR':
      case 'CALL_CENTER':   return <RegistrarView />;
      case 'DOCTOR':        return <DoctorView />;
      case 'DEPARTMENT_HEAD': return <DepartmentHeadView />;
      case 'DIRECTOR':      return <AdminPanel />;
      default:              return <div className="text-muted-foreground p-8">Роль не настроена</div>;
    }
  };

  const TITLE_MAP: Record<string, string> = {
    REGISTRAR:       'Регистратура',
    CALL_CENTER:     'Колл-центр',
    DOCTOR:          'Рабочее место врача',
    DEPARTMENT_HEAD: 'Управление отделением',
    ADMIN:           'Администратор',
    DIRECTOR:        'Панель руководителя',
  };

  const switcher = isAdmin
    ? <AdminViewSwitcher active={adminView} onChange={setAdminView} />
    : undefined;

  return (
    <Layout title={TITLE_MAP[user.role]} adminSwitcher={switcher}>
      {renderView()}
    </Layout>
  );
}

export default function App() {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <UserProvider>
          <AppContent />
          <Toaster richColors position="top-right" />
        </UserProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

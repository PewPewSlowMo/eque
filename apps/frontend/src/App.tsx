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
import { AdminPanel } from '@/components/AdminPanel';
import { Toaster } from 'sonner';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// Публичный маршрут — табло без авторизации
const PUBLIC_ROUTES = ['/board'];

function AppContent() {
  const [path, setPath] = useState(() => window.location.pathname);
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

  if (PUBLIC_ROUTES.includes(path)) {
    return <DisplayBoard />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  if (!user) return <Login />;

  const renderView = () => {
    switch (user.role) {
      case 'REGISTRAR':
      case 'CALL_CENTER':
        return <RegistrarView />;
      case 'DOCTOR':
        return <DoctorView />;
      case 'DEPARTMENT_HEAD':
        return <DepartmentHeadView />;
      case 'ADMIN':
      case 'DIRECTOR':
        return <AdminPanel />;
      default:
        return <div className="text-muted-foreground p-8">Роль не настроена</div>;
    }
  };

  const TITLE_MAP: Record<string, string> = {
    REGISTRAR: 'Регистратура',
    CALL_CENTER: 'Колл-центр',
    DOCTOR: 'Рабочее место врача',
    DEPARTMENT_HEAD: 'Управление отделением',
    ADMIN: 'Администрирование',
    DIRECTOR: 'Панель руководителя',
  };

  return (
    <Layout title={TITLE_MAP[user.role]}>
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

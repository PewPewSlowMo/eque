import { ReactNode } from 'react';
import { useUser } from '@/contexts/UserContext';
import { Button } from '@/components/ui/button';
import { LogOut, User } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  REGISTRAR: 'Регистратор',
  CALL_CENTER: 'Колл-центр',
  DOCTOR: 'Врач',
  DEPARTMENT_HEAD: 'Заведующий',
  DIRECTOR: 'Руководитель',
};

interface LayoutProps {
  children: ReactNode;
  title?: string;
}

export function Layout({ children, title }: LayoutProps) {
  const { user, logout } = useUser();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-primary">СЭО</span>
            {title && <span className="text-muted-foreground text-sm">/ {title}</span>}
          </div>
          {user && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>{user.lastName} {user.firstName}</span>
                <span className="text-xs bg-secondary px-2 py-0.5 rounded-full">
                  {ROLE_LABELS[user.role] ?? user.role}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {children}
      </main>
    </div>
  );
}

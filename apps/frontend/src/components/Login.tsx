import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function Login() {
  const { login } = useUser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data: any) => login(data.token, data.user),
    onError: (err: any) => setError(err.message || 'Неверный логин или пароль'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    loginMutation.mutate({ username, password });
  };

  return (
    <div
      className="h-full flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #00685B 0%, #004d44 100%)' }}
    >
      <div className="w-full max-w-sm px-4">
        {/* Logo block */}
        <div className="text-center mb-8">
          <img
            src="/logo.png"
            alt="Национальный госпиталь"
            className="mx-auto mb-4"
            style={{ height: '90px', width: 'auto' }}
          />
          <div className="text-white/50 text-sm mt-1">
            Система электронной очереди
          </div>
        </div>

        {/* Form card */}
        <div
          className="bg-white rounded-xl p-6 shadow-2xl"
          style={{ borderRadius: '8px 32px 32px 8px' }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="username" className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Логин
              </Label>
              <Input
                id="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Введите логин"
                autoComplete="username"
                required
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password" className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Пароль
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Введите пароль"
                autoComplete="current-password"
                required
                className="h-9 text-sm"
              />
            </div>

            {error && (
              <p className="text-xs text-destructive font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full h-9 text-sm font-bold text-white transition-opacity disabled:opacity-60"
              style={{
                background: '#00685B',
                borderRadius: '4px 20px 20px 4px',
              }}
            >
              {loginMutation.isPending ? 'Вход...' : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

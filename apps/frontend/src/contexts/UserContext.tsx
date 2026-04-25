import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface AuthUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  role: 'ADMIN' | 'REGISTRAR' | 'CALL_CENTER' | 'DOCTOR' | 'DEPARTMENT_HEAD' | 'DIRECTOR';
  departmentId?: string;
  department?: { id: string; name: string } | null;
  allowedCategories: string[];
}

interface UserContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const stored = localStorage.getItem('auth_user');
    if (token && stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = (token: string, userData: AuthUser) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setUser(null);
  };

  return (
    <UserContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);

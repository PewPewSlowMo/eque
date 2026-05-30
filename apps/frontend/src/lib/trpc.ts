import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import type { AppRouter } from 'backend/src/trpc/trpc.router';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: import.meta.env.VITE_TRPC_URL || 'http://localhost:3002/trpc',
      async headers() {
        const token = localStorage.getItem('auth_token');
        return { authorization: token ? `Bearer ${token}` : '' };
      },
    }),
  ],
});

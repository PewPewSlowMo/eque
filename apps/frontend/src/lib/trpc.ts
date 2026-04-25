import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trpc = createTRPCReact<any>();

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

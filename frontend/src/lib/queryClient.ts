import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // show cached data at once, refresh in the background
      refetchOnWindowFocus: true, // fresh data when returning to the tab
      retry: (failureCount, error) => {
        // Do not retry errors the user has to fix (auth, permission, validation).
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

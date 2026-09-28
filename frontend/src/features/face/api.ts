/** Face enrollment API hooks (admin). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { userKeys } from '@/features/users/api';
import { api } from '@/lib/api';
import type { UserDetail } from '@/lib/types';
import type { CapturedFrame } from './FaceCapture';

export const ENROLL_STEPS = [
  { key: 'center', instruction: 'Look straight at the camera' },
  { key: 'slight_left', instruction: 'Turn your head slightly to the LEFT' },
  { key: 'slight_right', instruction: 'Turn your head slightly to the RIGHT' },
  { key: 'slight_up', instruction: 'Tilt your head slightly UP' },
  { key: 'center', instruction: 'Look straight at the camera again' },
];

export function useFaceServiceStatus() {
  return useQuery({
    queryKey: ['face-service-status'],
    queryFn: () => api.get<{ status: string; model_loaded: boolean }>('/face/status'),
    refetchInterval: (q) => (q.state.data?.model_loaded ? false : 5000), // keep checking while offline
  });
}

function useFaceMutation<TVars>(fn: (vars: TVars) => Promise<UserDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (user) => {
      qc.setQueryData(userKeys.detail(user.id), user);
      void qc.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export function useEnrollFace(userId: string) {
  return useFaceMutation((frames: CapturedFrame[]) =>
    api.post<UserDetail>(`/face/${userId}/enroll`, { consent: true, frames }),
  );
}

export function useRemoveFace(userId: string) {
  return useFaceMutation(() => api.delete<UserDetail>(`/face/${userId}`));
}

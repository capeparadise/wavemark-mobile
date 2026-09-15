import { router } from 'expo-router';

// External/development links may open a release without a previous route.
export function backFromRelease() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/discover');
}

export function goToRelease(
  releaseId: string | number | null | undefined,
  params?: Record<string, string | number | null | undefined>
) {
  const id = String(releaseId ?? '').trim();
  if (!id) return;
  if (params && Object.keys(params).length) {
    router.push({
      pathname: '/release/[id]',
      params: { id, ...params },
    } as any);
    return;
  }
  router.push(`/release/${encodeURIComponent(id)}` as any);
}

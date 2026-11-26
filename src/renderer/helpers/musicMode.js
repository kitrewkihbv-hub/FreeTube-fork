/** Whether a route belongs to the explicitly selected Music experience. */
export function isMusicRoute(route) {
  const path = route?.path ?? ''
  return path === '/music' || (route?.query?.music === '1' &&
    (path.startsWith('/watch/') || path.startsWith('/playlist/') ||
      path === '/userplaylists' || path.startsWith('/search/')))
}

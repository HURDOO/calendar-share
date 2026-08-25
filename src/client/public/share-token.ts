export function consumeShareToken(): string | null {
  const parameters = new URLSearchParams(window.location.hash.slice(1))
  if (!parameters.has('share')) {
    return null
  }
  const token = parameters.get('share') ?? ''
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}`,
  )
  return token
}

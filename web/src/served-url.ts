/** Resolve a prepared file without allowing browser requests outside this app's origin. */
export function servedUrl(path: string, baseUrl = document.baseURI): URL {
  const base = new URL(baseUrl)
  const url = new URL(path, base)
  const origin = typeof window === 'undefined' ? base.origin : window.location.origin
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin) {
    throw new Error(`Refusing to load a URL outside the served app: ${url.href}`)
  }
  return url
}

const LOCAL_ORIGIN_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '::1',
]);
const LOCAL_APP_PORT = '3000';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'same-site', 'none']);

export function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === 'http:'
      && parsed.port === LOCAL_APP_PORT
      && LOCAL_ORIGIN_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function getLocalAccessDenial(input: {
  method: string;
  origin?: string;
  fetchSite?: string;
}): string | null {
  if (!isAllowedLocalOrigin(input.origin)) {
    return 'Requests are only allowed from the local app.';
  }

  if (
    MUTATING_METHODS.has(input.method.toUpperCase())
    && input.fetchSite
    && !ALLOWED_FETCH_SITES.has(input.fetchSite.toLowerCase())
  ) {
    return 'Cross-site changes are not allowed.';
  }

  return null;
}

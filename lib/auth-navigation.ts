import { appPath } from './app-path.js';

// Only known reporting entry points may be used after authentication.
// Never redirect to an arbitrary URL supplied by a browser or provider.
export function safeReturnTo(value: unknown): '/' | '/blocked-call' {
  return value === '/blocked-call' || value === '/blocked-call/' ? '/blocked-call' : '/';
}

export function withReturnTo(path: string, value: unknown) {
  const destination = safeReturnTo(value);
  return appPath(path) + (destination === '/' ? '' : `${path.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(destination)}`);
}

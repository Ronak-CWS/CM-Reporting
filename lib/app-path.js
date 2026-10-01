// NEXT_PUBLIC_BASE_PATH is embedded by Next at build time. Use the same value at startup.
export function basePath() {
  const value = process.env.NEXT_PUBLIC_BASE_PATH || '';
  if (!/^(\/[a-zA-Z0-9_-]+)*$/.test(value)) {
    throw new Error('NEXT_PUBLIC_BASE_PATH must be empty or a path such as /cm-reporting, without a trailing slash.');
  }
  return value;
}

/** @param {string} pathname */
export function appPath(pathname = '/') {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) throw new Error('Expected an application-relative path.');
  return `${basePath()}${pathname}`;
}

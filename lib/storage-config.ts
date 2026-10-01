import path from 'node:path';

export function dataDirectory() {
  const configured = process.env.CM_DATA_DIR?.trim();
  if (process.env.NODE_ENV === 'production' && !configured) {
    throw new Error('CM_DATA_DIR must point to a private persistent directory on the server.');
  }
  if (configured && (!path.isAbsolute(configured) || configured.startsWith('\\\\'))) {
    throw new Error('CM_DATA_DIR must be an absolute path on the server local disk.');
  }
  const directory = path.resolve(configured || path.join(process.cwd(), '.local-data'));
  const relative = path.relative(process.cwd(), directory);
  if (process.env.NODE_ENV === 'production' && (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))) {
    throw new Error('Production CM_DATA_DIR must be outside the application directory.');
  }
  for (const generated of ['public', '.next', 'dist', 'node_modules']) {
    const child = path.relative(path.join(process.cwd(), generated), directory);
    if (!child || (!child.startsWith(`..${path.sep}`) && child !== '..' && !path.isAbsolute(child))) {
      throw new Error('Reporting data cannot be stored in a public or generated application directory.');
    }
  }
  return directory;
}

export function cataloguePath() {
  if (process.env.CM_LOCATION_CATALOGUE_PATH) return path.resolve(process.env.CM_LOCATION_CATALOGUE_PATH);
  return process.env.NODE_ENV === 'production'
    ? path.join(dataDirectory(), 'service-locations.json')
    : path.join(process.cwd(), 'data', 'service-locations.json');
}

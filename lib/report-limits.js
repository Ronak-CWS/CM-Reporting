const MIB = 1024 * 1024;

// smtp1 advertised SIZE 50480000. Even the maximum 30 MiB raw attachment
// allowance leaves room for base64 line wrapping, MIME headers and the body.
export function reportAttachmentLimitBytes() {
  const value = process.env.REPORT_ATTACHMENT_MAX_MB?.trim() || '20';
  if (!/^\d+$/.test(value) || Number(value) < 5 || Number(value) > 30) {
    throw new Error('REPORT_ATTACHMENT_MAX_MB must be a whole number from 5 to 30 (MiB).');
  }
  return Number(value) * MIB;
}

export function reportSizeError(message) {
  return Object.assign(new Error(message), { code: 'EREPORTSIZE' });
}

export function isReportSizeError(error) {
  const seen = new Set();
  while (error && !seen.has(error)) {
    if (error.code === 'EREPORTSIZE') return true;
    seen.add(error);
    error = error.cause;
  }
  return false;
}

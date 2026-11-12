import { afterEach, describe, expect, it, vi } from 'vitest';
import { isReportSizeError, reportAttachmentLimitBytes, reportSizeError } from '../lib/report-limits.js';
import { reportImageBudget } from '../lib/report-attachment.js';

afterEach(() => vi.unstubAllEnvs());
describe('shared report size allowance', () => {
  it('gives a 234-photo day over 80 KiB per photo by default instead of 17 KiB', () => {
    vi.stubEnv('REPORT_ATTACHMENT_MAX_MB', '');
    expect(reportAttachmentLimitBytes()).toBe(20 * 1024 * 1024);
    const reports = Array.from({ length: 234 }, () => ({ photos: [{}] }));
    expect(reportImageBudget(reports)).toBeGreaterThan(80 * 1024);
    vi.stubEnv('REPORT_ATTACHMENT_MAX_MB', '5');
    expect(reportImageBudget(reports)).toBe(17749);
  });
  it.each(['0', '4', '31', '100', 'NaN', '20.5', '-1'])('rejects invalid or unbounded setting %s', (value) => {
    vi.stubEnv('REPORT_ATTACHMENT_MAX_MB', value);
    expect(reportAttachmentLimitBytes).toThrow('5 to 30');
  });
  it('caps the maximum below the relay limit after base64 encoding and wrapping', () => {
    vi.stubEnv('REPORT_ATTACHMENT_MAX_MB', '30');
    const base64 = Math.ceil(reportAttachmentLimitBytes() / 3) * 4;
    const wrappedWithHeaderAllowance = base64 + Math.ceil(base64 / 76) * 2 + 65536;
    expect(wrappedWithHeaderAllowance).toBeLessThan(50480000);
  });
  it('distinguishes a size failure from corrupt evidence through safe wrapper causes', () => {
    expect(isReportSizeError(new Error('attachment', { cause: reportSizeError('budget') }))).toBe(true);
    expect(isReportSizeError(new Error('unsupported image format'))).toBe(false);
  });
});

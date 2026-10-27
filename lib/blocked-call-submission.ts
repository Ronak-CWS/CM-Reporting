import { InputError, parseBlockedCallInput } from './blocked-call-input';
import { validatePhotos } from './photo-validation';
import { createReportRecord } from './reporting-store';

export async function submitBlockedCall(payload: unknown, files: File[], submissionId: string) {
  const input = parseBlockedCallInput(payload);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) {
    throw new InputError('Please open a new blocked call report to submit photos.');
  }
  return createReportRecord(input, await validatePhotos(files), submissionId);
}

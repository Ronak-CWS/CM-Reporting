export const SESSION_EXPIRED_EVENT = 'cm-reporting-session-expired';
export const SESSION_RESTORED_EVENT = 'cm-reporting-session-restored';

export const reportingFetch: typeof fetch = async (...args) => {
  const response = await fetch(...args);
  if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  // Preserve the current form. Reauthentication can happen in another tab.
  return response;
};

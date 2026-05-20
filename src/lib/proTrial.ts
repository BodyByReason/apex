export const PRO_TRIAL_DAYS = 3;

export type ProTrialFields = {
  proTrialEndsAt?: string;
  proTrialStartedAt?: string;
};

export function createProTrialWindow(startAt = new Date()) {
  const startedAt = startAt.toISOString();
  const endsAt = new Date(startAt.getTime() + PRO_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { startedAt, endsAt };
}

export function isProTrialActive(fields?: ProTrialFields | null, now = Date.now()) {
  const endValue = fields?.proTrialEndsAt?.trim();
  if (!endValue) return false;
  const endAt = Date.parse(endValue);
  if (Number.isNaN(endAt)) return false;
  return endAt > now;
}

export const PRO_TRIAL_DAYS = 3;
export const PRO_MONTHLY_PRICE = '$19.99';
export const PRO_MONTHLY_LABEL = `${PRO_MONTHLY_PRICE}/month`;
export const PRO_ANNUAL_FALLBACK_LABEL = 'annual option available';

export function buildProTrialHeadline() {
  return `${PRO_TRIAL_DAYS}-day Pro trial`;
}

export function buildProOfferSummary() {
  return `${buildProTrialHeadline()} · then ${PRO_MONTHLY_LABEL}`;
}

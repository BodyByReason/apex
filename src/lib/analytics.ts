import PostHog from 'posthog-react-native';
import { env } from './env';

let client: PostHog | null = null;

export function initAnalytics(): PostHog | null {
  if (!env.posthogApiKey) return null;

  client = new PostHog(env.posthogApiKey, {
    host: env.posthogHost || 'https://us.i.posthog.com',
    // Flush events in batches to save battery
    flushAt: 20,
    flushInterval: 30_000,
    // Disable in dev so you don't pollute production data
    disabled: __DEV__,
  });

  return client;
}

export function getAnalytics(): PostHog | null {
  return client;
}

// ── TYPED EVENT CATALOGUE ───────────────────────────────────
// Add every event here so they stay consistent across the codebase.

export const Analytics = {
  // Onboarding
  onboardingStarted: () => client?.capture('onboarding_started'),
  onboardingCompleted: (goalType: string) =>
    client?.capture('onboarding_completed', { goal_type: goalType }),
  signUpCompleted: (method: 'email' | 'apple' | 'google') =>
    client?.capture('sign_up_completed', { method }),

  // Workouts
  workoutStarted: (programName: string, dayName: string) =>
    client?.capture('workout_started', { program_name: programName, day_name: dayName }),
  workoutCompleted: (durationSeconds: number, exerciseCount: number) =>
    client?.capture('workout_completed', {
      duration_seconds: durationSeconds,
      exercise_count: exerciseCount,
    }),
  exerciseLogged: (exerciseName: string, xpAwarded: number) =>
    client?.capture('exercise_logged', { exercise_name: exerciseName, xp_awarded: xpAwarded }),
  prSet: (exerciseName: string, weight: number) =>
    client?.capture('pr_set', { exercise_name: exerciseName, weight }),

  // Nutrition
  foodLogged: (mealType: string, calories: number) =>
    client?.capture('food_logged', { meal_type: mealType, calories }),
  waterLogged: (ozAdded: number) =>
    client?.capture('water_logged', { oz_added: ozAdded }),

  // AI Coach
  coachMessageSent: () => client?.capture('coach_message_sent'),
  coachQuickChipUsed: (chipLabel: string) =>
    client?.capture('coach_quick_chip_used', { chip_label: chipLabel }),

  // Community
  postCreated: (postType: 'pr' | 'win' | 'question' | 'tip') =>
    client?.capture('community_post_created', { post_type: postType }),
  challengeJoined: (challengeName: string) =>
    client?.capture('challenge_joined', { challenge_name: challengeName }),

  // Subscriptions
  paywallViewed: (trigger: string) =>
    client?.capture('paywall_viewed', { trigger }),
  subscriptionStarted: (plan: 'monthly' | 'annual' | 'coach') =>
    client?.capture('subscription_started', { plan }),
  subscriptionCancelled: (plan: string, daysActive: number) =>
    client?.capture('subscription_cancelled', { plan, days_active: daysActive }),

  // Identity (call after login)
  identify: (userId: string, properties?: Record<string, unknown>) =>
    client?.identify(userId, properties as never),
  reset: () => client?.reset(),
};

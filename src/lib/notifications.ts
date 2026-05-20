/**
 * APEX AI Coach Notification Service
 *
 * Schedules a personalised daily coaching cadence:
 *   07:00  Morning Motivation
 *   12:30  Midday Check-in
 *   19:00  Evening Reminder
 *   Mon 09:00  Weekly Coaching Tip
 *
 * Content is goal-aware and day-of-week aware.  The service schedules one
 * week at a time (Mon–Sun) and re-schedules when the app opens if fewer
 * than 6 scheduled APEX notifications remain.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

// ─── Storage Keys ───────────────────────────────────────────────────────────
export const NOTIF_PREFS_KEY = 'apex.notifications.prefs.v2';
export const NOTIF_SCHEDULED_AT_KEY = 'apex.notifications.scheduledAt';

export type NotifPrefs = {
  morning: boolean;
  midday: boolean;
  evening: boolean;
  weeklyTip: boolean;
};

type CoachScheduleInputs = {
  mealsPerDay?: '2' | '3' | '4' | '5+';
  reasonWhy?: string[];
  reasonWhyDetail?: string;
  sleepTime?: string;
  wakeTime?: string;
  workoutTime?: string;
  workoutWindow?: 'before_work' | 'lunch' | 'after_work' | 'evening' | 'varies';
};

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  morning: true,
  midday: true,
  evening: true,
  weeklyTip: true,
};

type NotificationsModule = typeof import('expo-notifications');

let notificationsModulePromise: Promise<NotificationsModule> | null = null;
let notificationHandlerInitialized = false;

function shouldSkipNotifications() {
  return Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient';
}

async function getNotificationsModule(): Promise<NotificationsModule | null> {
  if (shouldSkipNotifications()) return null;
  notificationsModulePromise ??= import('expo-notifications');
  return notificationsModulePromise;
}

async function ensureNotificationHandler() {
  if (notificationHandlerInitialized) return;
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  notificationHandlerInitialized = true;
}

export async function getNotifPrefs(): Promise<NotifPrefs> {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
    return raw ? { ...DEFAULT_NOTIF_PREFS, ...(JSON.parse(raw) as Partial<NotifPrefs>) } : DEFAULT_NOTIF_PREFS;
  } catch {
    return DEFAULT_NOTIF_PREFS;
  }
}

export async function saveNotifPrefs(prefs: NotifPrefs): Promise<void> {
  await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

// ─── Permissions ─────────────────────────────────────────────────────────────
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return null;
  await ensureNotificationHandler();

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('apex-coach', {
      importance: Notifications.AndroidImportance.HIGH,
      name: 'APEX AI Coach',
      description: 'Daily coaching reminders and tips',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00FF87',
    });
    await Notifications.setNotificationChannelAsync('apex-coach-messages', {
      importance: Notifications.AndroidImportance.MAX,
      name: 'Coach Messages',
      description: 'Live messages from your personal coach',
      vibrationPattern: [0, 200, 100, 200],
      lightColor: '#00FF87',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  try {
    const token = await Notifications.getExpoPushTokenAsync({
      projectId: env.easProjectId || undefined,
    });
    return token.data;
  } catch {
    return null;
  }
}

// ─── Content pools ───────────────────────────────────────────────────────────

type NotifContent = { title: string; body: string };

const MORNING: Record<string, NotifContent[]> = {
  lose: [
    { title: '🔥 Morning check — fat loss day', body: 'Start with 30g protein before anything else. Fasted mornings spike cortisol — eat first, move second.' },
    { title: '☀️ Rise and burn', body: 'Your body is primed to use fat as fuel after sleep. A brisk 20-minute walk before breakfast can accelerate your deficit.' },
    { title: '💧 Hydrate before you caffeinate', body: 'Drink 500ml water right now. Dehydration mimics hunger — stay ahead of it and your deficit is easier to hit.' },
    { title: '🥚 Protein first, always', body: 'Starting the day with 30–40g protein reduces afternoon cravings by up to 60%. Plan your breakfast around protein today.' },
    { title: '📉 One more step toward your goal weight', body: 'Every single day you stay in a deficit is a day you can\'t get back — in the best way. This is one of those days.' },
    { title: '⚡ Your fat loss window is open', body: 'Overnight fast + morning activity = your biggest fat-burn window. Even a 15-min walk counts. Make it happen.' },
    { title: '🏆 Another chance to win the day', body: 'You\'re not dieting — you\'re building the body you want. Today\'s choices show up on the scale in 3 weeks.' },
  ],
  build: [
    { title: '💪 Good morning, builder', body: 'Your muscles rebuilt overnight. Feed them fast — 40g protein within an hour of waking drives better muscle protein synthesis.' },
    { title: '🥩 Anabolic window starts NOW', body: 'Breakfast is your first chance to hit your protein target today. Get at least 40g in before you do anything else.' },
    { title: '⚡ Heavy day? Fuel heavy.', body: 'If you\'re training today, carbs are your friend. Don\'t restrict — your muscles need glycogen to grow.' },
    { title: '📈 Bigger every day', body: 'Progressive overload isn\'t just about the gym. It\'s protein, sleep, and consistency — all three, every day.' },
    { title: '🍌 Pre-workout prep', body: 'Having a complex carb + protein meal 90 mins before your workout maximizes strength output. Plan that meal now.' },
    { title: '🌅 Morning protein = more muscle', body: 'Research shows spreading protein across 4–5 meals builds muscle faster than two big hits. Start strong this morning.' },
    { title: '💥 The difference is discipline', body: 'Everyone wants to be big and strong. The ones who get there are the ones who show up every morning. That\'s you.' },
  ],
  recomp: [
    { title: '⚖️ Recomp morning — balance is your edge', body: 'You\'re burning fat AND building muscle simultaneously. That requires consistent protein all day. Start the clock now.' },
    { title: '🔁 Burn + build — one rep at a time', body: 'Body recomp is the hardest goal and the most rewarding. Every day you stay consistent is a compounding win.' },
    { title: '🥗 Protein + fibre for breakfast', body: 'For recomp, a high-protein, high-fibre breakfast stabilises blood sugar and maximises fat oxidation throughout the day.' },
    { title: '⚡ Hit your calories — not above, not below', body: 'Recomp lives in the accuracy zone. Your goal today is to hit your calorie target within 50 calories. Precision wins.' },
    { title: '💧 Water + protein = recomp stack', body: 'These two are your most important tools today. 2.5L water and hit your protein target. Everything else follows.' },
    { title: '🔥 You\'re doing the hard thing', body: 'Most people only do fat loss or muscle building. You\'re doing both. That\'s elite-level commitment. Keep going.' },
    { title: '📊 Trust the process', body: 'Recomp results are slow on the scale but dramatic in the mirror. Take a progress photo monthly, not daily.' },
  ],
  performance: [
    { title: '🏆 Athlete morning — fuel for performance', body: 'Elite performance requires elite fuelling. Complex carbs + complete protein within 45 mins of waking. Non-negotiable.' },
    { title: '⚡ How\'s your recovery?', body: 'Check in with your body this morning. Soreness, energy, sleep quality — these are your real performance metrics today.' },
    { title: '🧠 Mental training starts here', body: 'Visualise your workout or competition today. Elite athletes train the mind first. 5 minutes now sets the tone.' },
    { title: '💪 Performance is built in the margins', body: 'The athletes who win aren\'t always the most talented — they\'re the most consistent with the basics. Sleep, eat, train, repeat.' },
    { title: '🥗 Carbs are not the enemy', body: 'Performance athletes need carbohydrates. Don\'t restrict them — time them. Pre-workout carbs = more power output.' },
    { title: '📈 Tracking = improving', body: 'If you\'re not tracking your training data, you\'re guessing. Log everything today and watch your performance trend upward.' },
    { title: '🔋 Energy system check', body: 'High intensity today? Prioritise glycogen. Endurance session? Fat-adapted cardio first. Know your energy system.' },
  ],
};

const MIDDAY: Record<string, NotifContent[]> = {
  lose: [
    { title: '🥗 Midday check-in — how\'s the deficit?', body: 'You should be about 40% through your calorie target by now. If you\'re at 60%+, lighten tonight\'s dinner.' },
    { title: '🍽️ Lunch time — make it count', body: 'A high-volume, high-protein, low-calorie lunch (think salad + grilled protein) makes the afternoon easy.' },
    { title: '📊 Halfway check', body: 'Open your food diary. Are you on track? Adjust dinner NOW before you\'re tired and making decisions on empty willpower.' },
    { title: '💧 Afternoon hunger? Drink first', body: 'Afternoon cravings are often dehydration. Drink a full glass of water and wait 10 minutes before eating.' },
    { title: '🔢 Running the numbers', body: 'Calories remaining ÷ 2 = what you can have for each of your next two meals. Simple math, big results.' },
    { title: '🥑 Don\'t skip lunch', body: 'Skipping meals slows metabolism and causes binge eating later. Eat now, eat smart, stay in your window.' },
    { title: '⏱️ 4 hours of fat loss left today', body: 'The afternoon is where most people lose their deficit. Plan your next 2 meals right now, before hunger decides for you.' },
  ],
  build: [
    { title: '🍗 Midday protein check', body: 'Have you hit 50g protein so far today? If not, make lunch your biggest protein meal. Your muscles are waiting.' },
    { title: '💪 Pre/post workout nutrition window', body: 'Training today? Your pre-workout meal should be in the next 60–90 min. Carbs + protein. Start preparing now.' },
    { title: '📈 Calorie surplus check', body: 'Are you on track with your calories? Muscle building requires a surplus. If you\'re behind, a high-protein lunch fixes it.' },
    { title: '🥩 The muscle-building equation', body: 'Protein × time × progressive overload = muscle. You\'re in the middle of the time window right now. Eat.' },
    { title: '🔋 Afternoon energy for training', body: 'If you train in the afternoon, now is the time for a quality carb + protein snack. Performance is fuelled, not wished for.' },
    { title: '📊 Track your lunch', body: 'Athletes who log consistently gain muscle 23% faster according to research. Open your diary and log right now.' },
    { title: '🥛 Protein shake check', body: 'If you\'re struggling to hit protein today, a shake at lunch covers 25–40g instantly. Simple, effective, repeatable.' },
  ],
  recomp: [
    { title: '⚖️ Recomp midday — precision matters', body: 'For recomp, hitting your calorie target within 100 calories is the goal. Check where you are and adjust dinner.' },
    { title: '🔁 Half the day done — how are macros looking?', body: 'Protein should be at 40-50% of daily target by now. If you\'re behind, make lunch protein-heavy today.' },
    { title: '💧 Water intake check', body: 'You should have had about 1.5L of water by now. Hydration directly impacts body composition. Fill up.' },
    { title: '🥗 Recomp lunch formula', body: 'Lean protein + vegetables + a small portion of complex carbs. This combination supports both goals simultaneously.' },
    { title: '📉 Today\'s tiny win adds up', body: 'Recomp happens in hundredths of a percent per day. The math works even when you can\'t feel it. Trust the process.' },
    { title: '🏋️ Lift today?', body: 'If you\'re training this afternoon, a small carb portion with lunch gives you the glycogen to push heavier. Eat smart.' },
    { title: '🎯 On track = on pace', body: 'Every meal you hit perfectly is a vote for the body you\'re building. This lunch is a vote. Make it count.' },
  ],
  performance: [
    { title: '⚡ Performance midday fuel', body: 'Athletes need consistent fuel throughout the day. Don\'t let more than 4 hours pass without eating. Eat now.' },
    { title: '🏆 Recovery fuel or training fuel?', body: 'Rest day? Focus on anti-inflammatory foods (salmon, leafy greens, berries). Training day? Prioritise carbs.' },
    { title: '📊 Nutrition timing is performance', body: 'Elite athletes eat to the clock, not to hunger. Schedule your meals, don\'t react to them.' },
    { title: '🧠 Mental fuel check', body: 'Your brain runs on glucose. Complex carbs at lunch maintain focus and reaction time for afternoon training.' },
    { title: '💪 Protein synthesis window', body: '20–40g protein every 3–4 hours maximises muscle protein synthesis. Your midday meal is a key window.' },
    { title: '🥗 Electrolytes if you trained this AM', body: 'Post-training lunch should include sodium, potassium, and magnesium to fully restore electrolyte balance.' },
    { title: '🔋 Pre-afternoon session check', body: 'Training this afternoon? Your lunch should be finishing digestion 60–90 minutes before you start. Time it right.' },
  ],
};

const EVENING: Record<string, NotifContent[]> = {
  lose: [
    { title: '🌙 Evening check — finish strong', body: 'How close are you to your calorie target? Make tonight\'s dinner precise. One bad evening undoes a great day.' },
    { title: '🔥 Don\'t ruin a good day', body: 'You\'ve been disciplined all day. Don\'t let boredom or tiredness make the decision at dinner. Log before you cook.' },
    { title: '💪 Evening workout opportunity', body: 'Evening training burns calories AND suppresses appetite afterward. A 20-min workout now locks in your deficit.' },
    { title: '📉 End of day deficit check', body: 'Open your diary. If you have 300+ calories left, eat a high-protein snack. If you\'re over — skip the snack tonight.' },
    { title: '🛌 Prep tomorrow tonight', body: 'Set out tomorrow\'s breakfast protein now. The people who stay on track prepare the night before, not the morning of.' },
    { title: '⚠️ Late-night eating alert', body: 'Evening is the most common time for deficit destruction. Set a cutoff time tonight — no food after 8 PM.' },
    { title: '🏆 End today winning', body: 'Close your food diary and hit your targets. One more day closer to your goal weight. You\'ve got this.' },
  ],
  build: [
    { title: '🏋️ Evening session time?', body: 'If you haven\'t trained today, evening is your last window. Even a 30-min session drives muscle protein synthesis.' },
    { title: '🍗 Pre-sleep protein is critical', body: 'Casein protein (cottage cheese, Greek yogurt) before bed sustains muscle building for 7–8 hours while you sleep.' },
    { title: '📊 Calorie check — are you in a surplus?', body: 'For muscle building, you need to be above maintenance. Check your diary — if you\'re short, a big protein meal fixes it.' },
    { title: '💪 Post-workout window still open', body: 'Trained today? The anabolic window extends 4–6 hours post-workout. Make dinner protein-heavy tonight.' },
    { title: '🌙 Growth happens at night', body: 'Your biggest release of growth hormone happens in the first 2 hours of sleep. Protein before bed + quality sleep = gains.' },
    { title: '📈 Did you hit your lifts today?', body: 'Log your workout performance. Tracking progressive overload is how you guarantee you\'re actually getting stronger week to week.' },
    { title: '🔋 Recovery protocol', body: 'Post-training recovery: protein, carbs, hydration, sleep. Start the checklist now so tomorrow you\'re ready to go heavy.' },
  ],
  recomp: [
    { title: '⚖️ Evening recomp check', body: 'Your evening meal should be your lightest calorie meal but still protein-heavy. Lean protein + vegetables — perfect recomp dinner.' },
    { title: '🔁 Today\'s scorecard', body: 'Did you: hit protein target? Stay near calorie goal? Train? If yes to all three, today was a perfect recomp day.' },
    { title: '📉 Body composition is built in the evening', body: 'What you eat from 6 PM onward heavily influences overnight fat burning. Keep dinner lean and late-night snacks minimal.' },
    { title: '🌙 Overnight muscle-building mode', body: 'Your body repairs and builds during sleep. A casein-heavy snack 30 min before bed keeps protein synthesis running overnight.' },
    { title: '💧 Final hydration push', body: 'Getting your final 500ml of water in before 8 PM prevents late-night fake hunger. Stay hydrated, stay on track.' },
    { title: '📊 Tomorrow starts tonight', body: 'Pack your lunch, prep your protein, set your alarm. The people who win at recomp do it with systems, not willpower.' },
    { title: '🏋️ Evening training for recomp', body: 'Evening resistance training after a moderate carb dinner is one of the most effective recomp strategies available. Train tonight.' },
  ],
  performance: [
    { title: '🏆 Evening performance review', body: 'Did you train today? Log it. Recovery nutrition in? Check it. Sleep prep started? The best athletes have evening routines.' },
    { title: '🌙 Sleep is your performance PED', body: 'HGH, testosterone, cortisol regulation — all happen during sleep. 8 hours minimum for athletes. Wind down now.' },
    { title: '🔋 Glycogen reload', body: 'If you trained hard today, replenish glycogen with complex carbs at dinner. Your muscles are empty and ready to absorb.' },
    { title: '📈 Log today\'s performance data', body: 'Strength numbers, times, distances, how you felt — log it all before sleep. Data is the foundation of improvement.' },
    { title: '💊 Recovery stack time', body: 'Evening is ideal for magnesium, zinc, and any anti-inflammatory supplements. Recovery is where performance is made.' },
    { title: '🧠 Visualise tomorrow', body: '5 minutes of mental rehearsal for tomorrow\'s session before sleep increases performance output. Champions do this. Do it.' },
    { title: '🥩 Protein and rest — the formula', body: 'Elite performance formula: enough protein, enough rest, consistent effort. Tonight covers the first two. Don\'t shortchange recovery.' },
  ],
};

const WEEKLY_TIPS: Record<string, NotifContent[]> = {
  lose: [
    { title: '📅 This week\'s fat loss tip', body: 'Protein should be 1.6–2g per kg of bodyweight. This is the single most important fat-loss lever. Hit it every day this week.' },
    { title: '📅 Weekly AI Coach tip', body: 'Strength training while in a calorie deficit preserves 3× more muscle than cardio alone. Lift heavy this week.' },
    { title: '📅 Your weekly edge', body: 'Meal prep on Sunday = 80% higher adherence during the week. Two hours now saves your entire deficit for 5 days.' },
    { title: '📅 This week — break a plateau', body: 'Stuck on the scale? Try a diet break — eat at maintenance for 2–3 days. This resets leptin and restarts fat loss.' },
  ],
  build: [
    { title: '📅 This week\'s muscle-building tip', body: 'Hit every muscle group at least twice this week. Frequency is the #1 predictor of hypertrophy. Plan your split now.' },
    { title: '📅 Weekly AI Coach tip', body: 'Add 2.5–5% more weight or 1 extra rep to every exercise this week. Progressive overload is non-negotiable for growth.' },
    { title: '📅 Your weekly edge', body: 'Creatine monohydrate 3–5g daily is the most evidence-based supplement for muscle building. Simple, cheap, effective.' },
    { title: '📅 This week — prioritise sleep', body: 'You build muscle during sleep, not during training. 8 hours minimum this week. This is as important as your workouts.' },
  ],
  recomp: [
    { title: '📅 This week\'s recomp tip', body: 'Calorie cycling — eat more on training days, less on rest days — accelerates recomp. Try it this week.' },
    { title: '📅 Weekly AI Coach tip', body: 'Body recomp requires patience measured in months, not weeks. Take a progress photo today and compare to last month.' },
    { title: '📅 Your weekly edge', body: 'Compound movements (squat, deadlift, bench, row) stimulate the most muscle fibres and fat burning simultaneously. Prioritise these.' },
    { title: '📅 This week — nail your protein', body: '1.8–2.2g protein per kg bodyweight. This is the non-negotiable for recomp. Everything else is secondary to this number.' },
  ],
  performance: [
    { title: '📅 This week\'s performance tip', body: 'Periodisation: plan a deload week every 4–6 weeks. Backing off intensity allows supercompensation and prevents overtraining.' },
    { title: '📅 Weekly AI Coach tip', body: 'Zone 2 cardio (conversational pace) 3× week builds your aerobic base — the foundation of all athletic performance.' },
    { title: '📅 Your weekly edge', body: 'Film yourself performing a key movement this week. External feedback from video reveals what internal perception misses.' },
    { title: '📅 This week — recovery focus', body: 'Cold exposure, foam rolling, and 8+ hours sleep are not optional extras — they\'re performance tools. Use them this week.' },
  ],
};

// Fallback content when goal isn't set
const MORNING_DEFAULT: NotifContent[] = MORNING.recomp;
const MIDDAY_DEFAULT: NotifContent[] = MIDDAY.recomp;
const EVENING_DEFAULT: NotifContent[] = EVENING.recomp;
const WEEKLY_DEFAULT: NotifContent[] = WEEKLY_TIPS.recomp;

// ─── Scheduling ───────────────────────────────────────────────────────────────

const ID_PREFIX = 'apex.coach';

function parseClock(value: string | undefined, fallbackHour: number, fallbackMinute = 0) {
  if (!value) return { hour: fallbackHour, minute: fallbackMinute };
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return { hour: fallbackHour, minute: fallbackMinute };
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

function clampHour(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildScheduleTimes(inputs?: CoachScheduleInputs) {
  const wake = parseClock(inputs?.wakeTime, 7, 0);
  const sleep = parseClock(inputs?.sleepTime, 22, 0);
  const workout = parseClock(inputs?.workoutTime, 18, 30);
  const workoutWindow = inputs?.workoutWindow ?? 'after_work';
  const mealsPerDay = inputs?.mealsPerDay ?? '3';

  const morningHour = clampHour(wake.hour + (wake.minute >= 30 ? 1 : 0), 6, 10);
  const morningMinute = wake.minute >= 30 ? 15 : 30;

  let middayHour = 12;
  let middayMinute = 30;
  if (workoutWindow === 'lunch') {
    middayHour = clampHour(workout.hour - 1, 11, 14);
    middayMinute = workout.minute;
  } else if (mealsPerDay === '2') {
    middayHour = clampHour(wake.hour + 5, 11, 15);
    middayMinute = 0;
  } else if (mealsPerDay === '4' || mealsPerDay === '5+') {
    middayHour = clampHour(wake.hour + 4, 10, 14);
    middayMinute = 30;
  }

  let eveningHour = clampHour(sleep.hour - 2, 17, 21);
  let eveningMinute = sleep.minute;
  if (workoutWindow === 'after_work' || workoutWindow === 'evening') {
    eveningHour = clampHour(workout.hour + 1, 18, 21);
    eveningMinute = workout.minute;
  }

  const weeklyHour = clampHour(wake.hour + 1, 8, 11);
  return {
    eveningHour,
    eveningMinute,
    middayHour,
    middayMinute,
    morningHour,
    morningMinute,
    weeklyHour,
  };
}

function buildReasonWhySuffix(inputs?: CoachScheduleInputs, index = 0) {
  const reasons = inputs?.reasonWhy?.filter((value) => value?.trim());
  const fromChips = reasons && reasons.length > 0 ? reasons[index % reasons.length] : undefined;
  const fromDetail = inputs?.reasonWhyDetail?.trim();
  const reason = fromDetail || fromChips;
  if (!reason) return '';
  return ` Remember why: ${reason}.`;
}

const WW_WORKOUT_UNLOCK_ID = 'apex.ww.workout-unlock';

/**
 * Schedule the "reward unlocked" celebration banner for 20 minutes from now.
 * The actual unlock is handled by the timer in WalkWaterFinaleScreen — this
 * notification is purely the visible celebration moment for the user.
 * Silently no-ops if permissions are not granted.
 */
export async function scheduleWorkoutUnlockNotification(): Promise<void> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  await ensureNotificationHandler();
  if (!Device.isDevice) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await Notifications.cancelScheduledNotificationAsync(WW_WORKOUT_UNLOCK_ID).catch(() => null);
  await Notifications.scheduleNotificationAsync({
    identifier: WW_WORKOUT_UNLOCK_ID,
    content: {
      title: '🎉 You crushed it!',
      body: 'Your reward is waiting — tap to claim your upgrade offer.',
      sound: true,
      data: { type: 'ww_workout_complete' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 20 * 60,
      repeats: false,
    },
  });
}

/**
 * Cancel the workout unlock notification — call if the user already completed
 * or exits the finale before the 20-minute mark.
 */
export async function cancelWorkoutUnlockNotification(): Promise<void> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  await Notifications.cancelScheduledNotificationAsync(WW_WORKOUT_UNLOCK_ID).catch(() => null);
}

// ─── Walk + Water Challenge Notifications ────────────────────────────────────

const WW_DAILY_ID_PREFIX = 'apex.ww.daily';

type WwPhase = 'early' | 'middle' | 'late';
type WwNotifContent = { title: string; body: string };

const WW_MORNING: Record<WwPhase, WwNotifContent[]> = {
  early: [
    { title: '🌅 Day 1 starts NOW', body: "Your Walk + Water challenge is officially live. Drink a big glass of water right now and decide when you're walking today." },
  ],
  middle: [
    { title: '🧠 This is where habits form', body: "Novelty is gone and results aren't visible yet. This is exactly where habits are built. Most people quit here — you won't." },
    { title: '⚡ Keep the streak alive', body: 'Every day you show up during the hard middle is a day compounding in your favour. First glass of water, then your walk — go.' },
    { title: '💪 Consistency is the skill', body: "You don't need to feel motivated — just hit your steps and your water. Feelings follow actions, not the other way around." },
    { title: '🌊 Your momentum is real', body: "You've built something over the past few days. Don't break it now. Drink, walk, and keep showing up." },
  ],
  late: [
    { title: '🏁 Last day. Leave nothing behind.', body: 'Go for your best walk yet — a little longer, a little faster. End this challenge the way you want to live every day.' },
  ],
};

const WW_MIDDAY: Record<WwPhase, WwNotifContent[]> = {
  early: [
    { title: '💧 Halfway through Day 1', body: "How's your water looking? If you're behind, drink a glass right now. Cold water absorbs 20% faster — catch up quick." },
  ],
  middle: [
    { title: '⚡ Midday water check', body: 'Drink a glass of water right now. Dehydration at midday kills afternoon energy and makes it harder to hit your step goal.' },
    { title: '🚶 2 PM walk window', body: "The afternoon energy dip is real — a 10-minute walk right now beats coffee for alertness, and there's no crash after." },
    { title: '💧 Closer than you think', body: 'Count your glasses. One big glass now and steady sipping this afternoon closes out your water goal.' },
    { title: '🥩 Protein check', body: 'Fuel your afternoon walk — protein at lunch keeps hunger in check and energy up for your steps later today.' },
  ],
  late: [
    { title: '💧 Final stretch — hit your water goal', body: "Count your glasses. You're closer to your target than you think. Finish strong this afternoon." },
  ],
};

const WW_EVENING: Record<WwPhase, WwNotifContent[]> = {
  early: [
    { title: '🚶 Have you walked today?', body: 'A 20-minute walk after dinner lowers blood sugar, aids digestion, and improves sleep. Even a short one wins the day.' },
  ],
  middle: [
    { title: '🌙 Evening check-in', body: 'Log your steps and water before you wind down. Partial progress is real progress — 60% beats 0% every single time.' },
    { title: '💧 Last call for water', body: 'Drink up before 8 PM. Finishing your water goal tonight means waking up feeling noticeably better tomorrow morning.' },
    { title: '🚶 Evening walk opportunity', body: 'After-dinner walks lower blood sugar and measurably improve sleep quality. 20 minutes — that is the whole commitment.' },
    { title: '🧠 Still here means you are winning', body: 'You showed up again today. That is the whole game. Sleep well — tomorrow is your next chance to make it count.' },
  ],
  late: [
    { title: '🎉 You almost did it', body: "Tonight is the final evening of your challenge. Finish your water, get your walk in if you haven't — wake up proud tomorrow." },
  ],
};

function getWwPhase(dayOffset: number, totalDays: number): WwPhase {
  if (dayOffset === 0) return 'early';
  if (dayOffset === totalDays - 1) return 'late';
  return 'middle';
}

/**
 * Cancel all Walk + Water daily challenge notifications.
 * Call on challenge completion or when the user resets their plan.
 */
export async function cancelWalkWaterNotifications(): Promise<void> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const wwIds = scheduled
    .filter((n) => n.identifier.startsWith(WW_DAILY_ID_PREFIX))
    .map((n) => n.identifier);
  await Promise.all(wwIds.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

/**
 * Schedule Walk + Water daily notifications for the full challenge duration.
 * Call ONCE when the plan is confirmed — not on every app open.
 * 3 notifications/day: 7 AM, 12:30 PM, 7 PM.
 * Content is phase-aware: Day 1 (excitement), middle days (consistency), last day (finish line).
 * Silently no-ops if permissions are not granted or on a simulator.
 */
export async function scheduleWalkWaterNotifications(plan: {
  startDate: string;
  challengeDays: number;
  dailyStepGoal: number;
  dailyWaterGoalOz: number;
  walkTimeLabel: string;
}): Promise<void> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  await ensureNotificationHandler();
  if (!Device.isDevice) return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('apex-ww-challenge', {
      importance: Notifications.AndroidImportance.HIGH,
      name: 'Walk + Water Challenge',
      description: 'Daily walk and water reminders for your challenge',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0EA5E9',
    });
  }

  await cancelWalkWaterNotifications();

  const now = new Date();
  const [year, month, day] = plan.startDate.split('-').map(Number);
  const challengeStart = new Date(year, month - 1, day);

  for (let dayOffset = 0; dayOffset < plan.challengeDays; dayOffset++) {
    const phase = getWwPhase(dayOffset, plan.challengeDays);
    const middleIdx = dayOffset % WW_MORNING.middle.length;

    const morning = phase === 'middle' ? WW_MORNING.middle[middleIdx] : WW_MORNING[phase][0];
    const midday  = phase === 'middle' ? WW_MIDDAY.middle[middleIdx % WW_MIDDAY.middle.length]  : WW_MIDDAY[phase][0];
    const evening = phase === 'middle' ? WW_EVENING.middle[middleIdx % WW_EVENING.middle.length] : WW_EVENING[phase][0];

    const baseDate = new Date(challengeStart);
    baseDate.setDate(challengeStart.getDate() + dayOffset);

    const androidChannel = Platform.OS === 'android' ? { channelId: 'apex-ww-challenge' } : {};

    const morningTrigger = new Date(baseDate);
    morningTrigger.setHours(7, 0, 0, 0);
    if (morningTrigger > now) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${WW_DAILY_ID_PREFIX}.morning.d${dayOffset}`,
        content: { title: morning.title, body: morning.body, sound: true, data: { type: 'ww_morning' }, ...androidChannel },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: morningTrigger },
      });
    }

    const middayTrigger = new Date(baseDate);
    middayTrigger.setHours(12, 30, 0, 0);
    if (middayTrigger > now) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${WW_DAILY_ID_PREFIX}.midday.d${dayOffset}`,
        content: { title: midday.title, body: midday.body, sound: true, data: { type: 'ww_midday' }, ...androidChannel },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: middayTrigger },
      });
    }

    const eveningTrigger = new Date(baseDate);
    eveningTrigger.setHours(19, 0, 0, 0);
    if (eveningTrigger > now) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${WW_DAILY_ID_PREFIX}.evening.d${dayOffset}`,
        content: { title: evening.title, body: evening.body, sound: true, data: { type: 'ww_evening' }, ...androidChannel },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: eveningTrigger },
      });
    }
  }
}

/**
 * Cancel all currently-scheduled APEX Coach notifications.
 */
export async function cancelAllCoachNotifications(): Promise<void> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const apexIds = scheduled
    .filter((n) => n.identifier.startsWith(ID_PREFIX))
    .map((n) => n.identifier);
  await Promise.all(apexIds.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

/**
 * Schedule the full AI Coach notification cadence for the next 7 days.
 * Silently no-ops if permission is not granted or on a simulator.
 */
export async function scheduleCoachNotifications(opts?: {
  goal?: string;
  displayName?: string;
  prefs?: NotifPrefs;
  mealsPerDay?: CoachScheduleInputs['mealsPerDay'];
  reasonWhy?: string[];
  reasonWhyDetail?: string;
  sleepTime?: string;
  wakeTime?: string;
  workoutTime?: string;
  workoutWindow?: CoachScheduleInputs['workoutWindow'];
}): Promise<void> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  await ensureNotificationHandler();
  if (!Device.isDevice) return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const goal = opts?.goal ?? 'recomp';
  const name = opts?.displayName?.split(' ')[0] ?? '';
  const prefs = opts?.prefs ?? DEFAULT_NOTIF_PREFS;
  const scheduleTimes = buildScheduleTimes(opts);
  const morningPool = MORNING[goal] ?? MORNING_DEFAULT;
  const middayPool = MIDDAY[goal] ?? MIDDAY_DEFAULT;
  const eveningPool = EVENING[goal] ?? EVENING_DEFAULT;
  const weeklyPool = WEEKLY_TIPS[goal] ?? WEEKLY_DEFAULT;

  // Cancel existing coach notifications before rescheduling
  await cancelAllCoachNotifications();

  const now = new Date();
  const scheduledIds: string[] = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(now);
    date.setDate(now.getDate() + dayOffset);

    const msgIndex = (now.getDate() + dayOffset) % morningPool.length;
    const namePrefix = name ? `${name}, ` : '';
    const reasonWhySuffix = buildReasonWhySuffix(opts, dayOffset);

    // Morning
    if (prefs.morning) {
      const morning = morningPool[msgIndex % morningPool.length];
      const triggerDate = new Date(date);
      triggerDate.setHours(scheduleTimes.morningHour, scheduleTimes.morningMinute, 0, 0);
      if (triggerDate > now) {
        const id = `${ID_PREFIX}.morning.d${dayOffset}`;
        await Notifications.scheduleNotificationAsync({
          identifier: id,
          content: {
            title: morning.title,
            body: namePrefix + morning.body + reasonWhySuffix,
            sound: true,
            data: { type: 'morning', goal },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
          },
        });
        scheduledIds.push(id);
      }
    }

    // Midday
    if (prefs.midday) {
      const midday = middayPool[msgIndex % middayPool.length];
      const triggerDate = new Date(date);
      triggerDate.setHours(scheduleTimes.middayHour, scheduleTimes.middayMinute, 0, 0);
      if (triggerDate > now) {
        const id = `${ID_PREFIX}.midday.d${dayOffset}`;
        await Notifications.scheduleNotificationAsync({
          identifier: id,
          content: {
            title: midday.title,
            body: namePrefix + midday.body + reasonWhySuffix,
            sound: true,
            data: { type: 'midday', goal },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
          },
        });
        scheduledIds.push(id);
      }
    }

    // Evening
    if (prefs.evening) {
      const evening = eveningPool[msgIndex % eveningPool.length];
      const triggerDate = new Date(date);
      triggerDate.setHours(scheduleTimes.eveningHour, scheduleTimes.eveningMinute, 0, 0);
      if (triggerDate > now) {
        const id = `${ID_PREFIX}.evening.d${dayOffset}`;
        await Notifications.scheduleNotificationAsync({
          identifier: id,
          content: {
            title: evening.title,
            body: namePrefix + evening.body + reasonWhySuffix,
            sound: true,
            data: { type: 'evening', goal },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
          },
        });
        scheduledIds.push(id);
      }
    }

    // Weekly tip — Monday only
    if (prefs.weeklyTip && date.getDay() === 1) {
      const tip = weeklyPool[(Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000))) % weeklyPool.length];
      const triggerDate = new Date(date);
      triggerDate.setHours(scheduleTimes.weeklyHour, 0, 0, 0);
      if (triggerDate > now) {
        const id = `${ID_PREFIX}.weekly.d${dayOffset}`;
        await Notifications.scheduleNotificationAsync({
          identifier: id,
          content: {
            title: tip.title,
            body: namePrefix + tip.body + reasonWhySuffix,
            sound: true,
            data: { type: 'weekly', goal },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
          },
        });
        scheduledIds.push(id);
      }
    }
  }

  await AsyncStorage.setItem(NOTIF_SCHEDULED_AT_KEY, new Date().toISOString());
}

/**
 * Called when the app foregrounds — re-schedules the next 7 days if we have
 * fewer than 6 remaining APEX notifications.
 */
export async function maybeRescheduleCoachNotifications(opts?: {
  goal?: string;
  displayName?: string;
  prefs?: NotifPrefs;
  mealsPerDay?: CoachScheduleInputs['mealsPerDay'];
  reasonWhy?: string[];
  reasonWhyDetail?: string;
  sleepTime?: string;
  wakeTime?: string;
  workoutTime?: string;
  workoutWindow?: CoachScheduleInputs['workoutWindow'];
}): Promise<void> {
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const apexCount = scheduled.filter((n) => n.identifier.startsWith(ID_PREFIX)).length;
    if (apexCount < 6) {
      await scheduleCoachNotifications(opts);
    }
  } catch {
    // Silently ignore — notifications are non-critical
  }
}

// ─── Coach Message Notifications ──────────────────────────────────────────────

/**
 * Fire an immediate local notification when a coach sends a message.
 * Works while the app is in the foreground. Background/killed state requires
 * the server to send a push via Expo Push API using the stored token.
 */
export async function sendCoachMessageNotification(
  messageText: string,
  coachName = 'Your Coach',
): Promise<void> {
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    // Truncate to a sensible preview length
    const preview = messageText.length > 100 ? `${messageText.slice(0, 97)}…` : messageText;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `💬 ${coachName}`,
        body: preview,
        sound: true,
        data: { type: 'coach_message' },
        ...(Platform.OS === 'android' ? { channelId: 'apex-coach-messages' } : {}),
      },
      trigger: null, // fire immediately
    });
  } catch {
    // Non-critical — never throw
  }
}

export async function sendCoachBusinessNotification(
  title: string,
  body: string,
): Promise<void> {
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: { type: 'coach_business' },
        ...(Platform.OS === 'android' ? { channelId: 'apex-coach-messages' } : {}),
      },
      trigger: null,
    });
  } catch {
    // Non-critical
  }
}

export async function queueCoachBusinessNotification(input: {
  body: string;
  clientUserId?: string | null;
  coachUserId: string;
  emailBody?: string;
  smsBody?: string;
  title: string;
}) {
  try {
    await supabase.from('coach_notification_events').insert({
      body: input.body,
      client_user_id: input.clientUserId ?? null,
      coach_user_id: input.coachUserId,
      email_body: input.emailBody ?? input.body,
      sms_body: input.smsBody ?? input.body,
      title: input.title,
      type: 'live_coaching_purchase',
    });
  } catch (error) {
    console.error('Failed to queue coach business notification', error);
  }
}

export async function scheduleCoachSessionReminder(input: {
  clientName: string;
  date: string;
  time: string;
  minutesBefore?: number;
}): Promise<boolean> {
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return false;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return false;

    const reminderAt = new Date(`${input.date}T${input.time}:00`);
    reminderAt.setMinutes(reminderAt.getMinutes() - (input.minutesBefore ?? 30));
    if (Number.isNaN(reminderAt.getTime()) || reminderAt <= new Date()) return false;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Upcoming session with ${input.clientName}`,
        body: `Your ${input.minutesBefore ?? 30}-minute heads-up is here. Open Coach Mode and get ready to lead the call.`,
        sound: true,
        data: { type: 'coach_session_reminder', clientName: input.clientName, date: input.date, time: input.time },
        ...(Platform.OS === 'android' ? { channelId: 'apex-coach-messages' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderAt,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function scheduleCoachCheckInReminder(input: {
  clientName: string;
  remindAt: Date;
  context?: string;
}): Promise<boolean> {
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return false;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return false;
    if (input.remindAt <= new Date()) return false;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Check in with ${input.clientName}`,
        body: input.context?.trim() || 'Send a quick message, review their notes, and keep the momentum going.',
        sound: true,
        data: { type: 'coach_checkin_reminder', clientName: input.clientName },
        ...(Platform.OS === 'android' ? { channelId: 'apex-coach-messages' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: input.remindAt,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function scheduleAICoachReminder(input: {
  title: string;
  body: string;
  remindAt: Date;
}): Promise<boolean> {
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return false;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return false;
    if (input.remindAt <= new Date()) return false;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        sound: true,
        data: { type: 'ai_coach_reminder' },
        ...(Platform.OS === 'android' ? { channelId: 'apex-coach-messages' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: input.remindAt,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Save the Expo push token to Supabase so the coach-side can send
 * push notifications to this device even when the app is closed.
 * Stores it in the user's profile row under `push_token`.
 */
export async function savePushTokenToDb(
  userId: string,
  token: string,
): Promise<void> {
  try {
    await supabase
      .from('profiles')
      .upsert({ id: userId, push_token: token }, { onConflict: 'id' });
  } catch {
    // Non-critical
  }
}

// ─── Legacy compat export (used in OnboardingScreen / other places) ──────────
export async function scheduleDailyReminderAsync(): Promise<void> {
  // No-op — replaced by scheduleCoachNotifications
}

export async function scheduleAIInsightNotifications(
  suggestions: Array<{ body: string; hour: number; minute: number; title: string }>,
): Promise<boolean> {
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return false;
    await ensureNotificationHandler();

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return false;

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith('apex.aiinsight.'))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );

    const now = new Date();
    for (const notif of suggestions) {
      const trigger = new Date(now);
      trigger.setHours(notif.hour, notif.minute, 0, 0);
      if (trigger > now) {
        await Notifications.scheduleNotificationAsync({
          identifier: `apex.aiinsight.${notif.hour}${notif.minute}`,
          content: { title: notif.title, body: notif.body, sound: true },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: trigger,
          },
        });
      }
    }

    return true;
  } catch {
    return false;
  }
}

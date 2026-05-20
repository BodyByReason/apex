import AsyncStorage from '@react-native-async-storage/async-storage';

export type FoodLogEntry = {
  calories: number;
  carbs: number;
  fat: number;
  id: string;
  loggedAt: string;
  name: string;
  protein: number;
};

export type FoodLogTotals = {
  calories: number;
  carbs: number;
  entries: FoodLogEntry[];
  fat: number;
  protein: number;
};

function todayKey(): string {
  return `apex.ww.foodLog.${new Date().toISOString().slice(0, 10)}`;
}

export async function addFoodLogEntry(
  food: Omit<FoodLogEntry, 'id' | 'loggedAt'>,
): Promise<FoodLogTotals> {
  const existing = await getFoodLogToday();
  const entry: FoodLogEntry = {
    ...food,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    loggedAt: new Date().toISOString(),
  };
  const updated = [...existing.entries, entry];
  await AsyncStorage.setItem(todayKey(), JSON.stringify(updated));
  return sumEntries(updated);
}

export async function getFoodLogToday(): Promise<FoodLogTotals> {
  try {
    const raw = await AsyncStorage.getItem(todayKey());
    const entries: FoodLogEntry[] = raw ? (JSON.parse(raw) as FoodLogEntry[]) : [];
    return sumEntries(entries);
  } catch {
    return sumEntries([]);
  }
}

export async function clearFoodLogToday(): Promise<void> {
  await AsyncStorage.removeItem(todayKey());
}

function sumEntries(entries: FoodLogEntry[]): FoodLogTotals {
  return entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      carbs: acc.carbs + e.carbs,
      entries: acc.entries,
      fat: acc.fat + e.fat,
      protein: acc.protein + e.protein,
    }),
    { calories: 0, carbs: 0, entries, fat: 0, protein: 0 },
  );
}

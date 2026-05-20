import React, { useMemo, useState } from 'react';

import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { AppHeader } from '@/components/AppHeader';
import { SkeletonCard } from '@/components/SkeletonCard';
import FoodScanModal, { type ScannedFood } from '@/components/FoodScanModal';
import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import { useAuth } from '@/contexts/AuthContext';
import { useGamification } from '@/contexts/GamificationContext';
import { FOOD_CAMERA_SCAN_STORAGE_KEY } from '@/lib/achievements';
import { addTextPostToFeed } from '@/lib/tribeFeed';
import type { NutritionixFoodResult } from '@/lib/nutritionix';
import { searchFood } from '@/lib/nutritionix';
import { maybeShowPaywall } from '@/lib/revenuecat';
import { syncProfileToSupabase } from '@/lib/profileSync';
import { usePro } from '@/hooks/usePro';
import { supabase } from '@/lib/supabase';
import { getOrComputeMacroTargets } from '@/lib/bmr';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { apexColors as C } from '@/theme/colors';
import { useTheme } from '@/contexts/ThemeContext';
import type { MainStackParamList } from '@/navigation/MainNavigator';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { MealShareCard, MEAL_CARD_W, MEAL_CARD_H, type MealShareData } from '@/components/MealShareCard';
import { getCoachPersonaPrefix, getSelectedCoachVoice, type CoachVoiceOption } from '@/lib/coachVoice';
import { env } from '@/lib/env';
import { enrichOnTheGoSuggestions, type OnTheGoSuggestion as LiveOnTheGoSuggestion } from '@/lib/onTheGoPlaces';

type Tab = 'diary' | 'macros' | 'plans' | 'water';

// Hydration persistence key is date-scoped so it resets each morning
const HYDRATION_KEY = (date: string) => `apex.hydration.${date}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

// Meal plan & grocery list cache
const MEAL_PLAN_KEY = 'apex.mealplan.v1';
const MEAL_PLAN_HISTORY_KEY = 'apex.mealplan.history.v1';
const GROCERY_LIST_KEY = 'apex.grocerylist.v1';
const GROCERY_BUDGET_KEY = 'apex.grocerybudget.v1';
const ON_THE_GO_FAVORITES_KEY = 'apex.onthego.favorites.v1';
const ON_THE_GO_OPEN_REQUEST_KEY = 'apex.onthego.openRequest.v1';

type MealPlanDay = {
  day: string;
  meals: Array<{ name: string; kcal: number; protein: number; time: string }>;
};

type MealPlanHistoryEntry = {
  generatedAt: string;
  id: string;
  label: string;
  plan: MealPlanDay[];
};

type ManualMealDraft = {
  kcal: string;
  name: string;
  protein: string;
  time: string;
};

type MealTemplate = {
  build: string[];
  coachTip: string;
  label: string;
  mealName: string;
  timing: string;
};

type GroceryCategory = 'Produce' | 'Protein' | 'Dairy & Eggs' | 'Grains & Bread' | 'Pantry' | 'Frozen' | 'Beverages' | 'Other';

type GroceryItem = {
  id: string;
  name: string;
  quantity: string;
  estimatedPrice: number;
  category: GroceryCategory;
  checked: boolean;
};

type GroceryList = {
  items: GroceryItem[];
  nearbyStores?: string[];
  totalEstimate: number;
  generatedAt: string;
};

type RecipeVideo = {
  channel: string;
  description: string;
  id: string;
  thumb: string;
  title: string;
};

type OnTheGoSuggestion = LiveOnTheGoSuggestion;

function hydrationGoalOz(profile: UserProfile | null): number {
  const weightLbs = Number(profile?.weightLbs ?? 0);
  if (weightLbs > 0) return Math.round(weightLbs * 0.55); // ~0.55 oz per lb
  return 100;
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function buildMealTemplates({
  calorieGoal,
  mealPlan,
  profile,
  proteinGoal,
}: {
  calorieGoal: number;
  mealPlan: MealPlanDay[] | null;
  profile: UserProfile | null;
  proteinGoal: number;
}): MealTemplate[] {
  const goal = profile?.goal ?? 'recomp';
  const preferences = new Set((profile?.foodPreferences ?? []).map((item) => item.toLowerCase()));
  const avoidances = (profile?.foodAvoidances ?? '').toLowerCase();
  const proteinTargetPerMeal = Math.max(25, Math.round(proteinGoal / 4));
  const breakfastMeal = mealPlan?.[0]?.meals?.[0];
  const lunchMeal = mealPlan?.[0]?.meals?.[1] ?? mealPlan?.[1]?.meals?.[1];
  const dinnerMeal = mealPlan?.[0]?.meals?.[2] ?? mealPlan?.[1]?.meals?.[2];

  const prefersPlantBased =
    preferences.has('vegetarian') || preferences.has('vegan') || preferences.has('pescatarian');
  const lowCarb = preferences.has('low carb');
  const dairyFree = preferences.has('dairy-free') || avoidances.includes('dairy');

  return [
    {
      label: 'Breakfast Template',
      mealName: breakfastMeal?.name ?? (prefersPlantBased ? 'Protein oats bowl' : 'Eggs + fruit + oats'),
      timing: breakfastMeal?.time ?? 'Morning',
      build: [
        `Protein anchor: ${proteinTargetPerMeal}g from ${prefersPlantBased ? 'tofu scramble, Greek-style dairy-free yogurt, or vegan protein' : 'eggs, egg whites, Greek yogurt, or a shake'}`,
        `Smart carbs: ${lowCarb ? 'berries or a half portion of oats' : 'oats, fruit, or whole grain toast'}`,
        `Add color: 1 fruit serving or spinach into the meal`,
      ],
      coachTip: calorieGoal < 2200 ? 'Keep breakfast simple and high protein so the rest of the day stays flexible.' : 'Use breakfast to front-load protein and energy for training.',
    },
    {
      label: 'Lunch Template',
      mealName: lunchMeal?.name ?? (prefersPlantBased ? 'Power bowl' : 'Protein + rice bowl'),
      timing: lunchMeal?.time ?? 'Midday',
      build: [
        `Half the plate: fibrous vegetables or salad`,
        `Protein portion: 1.5 palms of ${prefersPlantBased ? 'beans, tofu, tempeh, salmon, or lentils' : 'chicken, turkey, steak, salmon, or lean beef'}`,
        `${lowCarb ? 'Add healthy fats like avocado or olive oil' : 'Add 1 cupped-hand of rice, potatoes, quinoa, or wraps'}`,
      ],
      coachTip: goal === 'lose' ? 'Lunch should be the easiest meal to keep clean and repeatable.' : 'Use lunch to stay fueled without crashing later in the day.',
    },
    {
      label: 'Dinner Template',
      mealName: dinnerMeal?.name ?? (dairyFree ? 'Lean protein dinner plate' : 'Recovery dinner plate'),
      timing: dinnerMeal?.time ?? 'Evening',
      build: [
        `Protein first: ${proteinTargetPerMeal}-${proteinTargetPerMeal + 10}g from your main entrée`,
        `${lowCarb ? 'Swap starch for extra vegetables or a broth-based side' : 'Use 1–2 cupped-hands of carbs if you trained today'}`,
        `Finish with volume: roasted vegetables, salad, or soup so the plate feels full`,
      ],
      coachTip: goal === 'build' ? 'Dinner is a great place to finish calories strong without missing protein.' : 'Dinner should close the gap on protein without accidentally blowing fats or calories.',
    },
  ];
}

function buildManualWeeklyPlan(meals: ManualMealDraft[]) {
  const validMeals = meals
    .map((meal) => ({
      kcal: Math.max(0, Number(meal.kcal || 0)),
      name: meal.name.trim(),
      protein: Math.max(0, Number(meal.protein || 0)),
      time: meal.time,
    }))
    .filter((meal) => meal.name.length > 0);

  const labels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return labels.map((day) => ({
    day,
    meals: validMeals.map((meal) => ({ ...meal })),
  }));
}

function buildOnTheGoSuggestionPool({
  coachName,
  profile,
  zipCode,
}: {
  coachName: string;
  profile: UserProfile | null;
  zipCode?: string;
}): OnTheGoSuggestion[] {
  const goal = profile?.goal ?? 'recomp';
  const zipHint = zipCode?.trim() ? `Near ${zipCode.trim()}` : 'Near you';

  if (goal === 'lose') {
    return [
      {
        id: 'cut-sweetgreen',
        title: 'Double-protein salad bowl',
        venue: 'Sweetgreen',
        placeType: 'Fast casual bowl spot',
        addressHint: zipHint,
        bestFor: 'Fat-loss lunch',
        macros: '40-50g protein · lighter carbs',
        distanceHint: zipHint,
        coachNote: `${coachName}: Go lean protein first, load the veg, and skip the chips.`,
      },
      {
        id: 'cut-starbucks',
        title: 'Egg bites + protein shake',
        venue: 'Starbucks',
        placeType: 'Coffee / grab-and-go',
        addressHint: zipHint,
        bestFor: 'Busy morning',
        macros: '25-35g protein · easy calories',
        distanceHint: zipHint,
        coachNote: `${coachName}: This is the cleanest rescue meal when you are out and need protein fast.`,
      },
      {
        id: 'cut-whole-foods',
        title: 'Greek yogurt, fruit, jerky',
        venue: 'Whole Foods Market',
        placeType: 'Grocery grab-and-go',
        addressHint: zipHint,
        bestFor: 'Post-work or late-night save',
        macros: '30g+ protein · portion-controlled',
        distanceHint: zipHint,
        coachNote: `${coachName}: Simple wins. High protein, no guesswork, and hard to overeat.`,
      },
      {
        id: 'cut-cava',
        title: 'Greens + grilled chicken bowl',
        venue: 'CAVA',
        placeType: 'Mediterranean fast casual',
        addressHint: zipHint,
        bestFor: 'Lean dinner',
        macros: '35-45g protein · controlled fats',
        distanceHint: zipHint,
        coachNote: `${coachName}: Solid move if you keep the sauces tight and let the protein lead.`,
      },
      {
        id: 'cut-panera',
        title: 'Soup + chicken salad combo',
        venue: 'Panera Bread',
        placeType: 'Cafe / quick stop',
        addressHint: zipHint,
        bestFor: 'Office-day reset',
        macros: '30g+ protein · easy portioning',
        distanceHint: zipHint,
        coachNote: `${coachName}: Better than a random sandwich run. Clean enough to keep the day on track.`,
      },
    ];
  }

  if (goal === 'build') {
    return [
      {
        id: 'build-chipotle',
        title: 'Chicken rice performance bowl',
        venue: 'Chipotle',
        placeType: 'Fast casual bowl spot',
        addressHint: zipHint,
        bestFor: 'Post-workout meal',
        macros: '45-60g protein · higher carbs',
        distanceHint: zipHint,
        coachNote: `${coachName}: This is the kind of meal that actually helps you grow instead of just filling a gap.`,
      },
      {
        id: 'build-panera',
        title: 'Breakfast wrap + oats combo',
        venue: 'Panera Bread',
        placeType: 'Cafe / breakfast stop',
        addressHint: zipHint,
        bestFor: 'Morning lift fuel',
        macros: '30-40g protein · steady energy',
        distanceHint: zipHint,
        coachNote: `${coachName}: If you train soon after, this gives you better output than coffee alone.`,
      },
      {
        id: 'build-costco',
        title: 'Rotisserie chicken + rice cups',
        venue: 'Costco / local market',
        placeType: 'Market quick stack',
        addressHint: zipHint,
        bestFor: 'Mass-friendly dinner',
        macros: '50g+ protein · easy add-ons',
        distanceHint: zipHint,
        coachNote: `${coachName}: Keep a grocery fallback like this ready so missed meals do not stall the week.`,
      },
      {
        id: 'build-cava',
        title: 'Steak + rice bowl',
        venue: 'CAVA',
        placeType: 'Mediterranean fast casual',
        addressHint: zipHint,
        bestFor: 'Heavy training day',
        macros: '40-50g protein · carb support',
        distanceHint: zipHint,
        coachNote: `${coachName}: Good training fuel when you need quality food fast and cannot get home first.`,
      },
      {
        id: 'build-jersey-mikes',
        title: 'Turkey provolone sub + side protein',
        venue: "Jersey Mike's",
        placeType: 'Sandwich stop',
        addressHint: zipHint,
        bestFor: 'Travel-day calories',
        macros: '35-45g protein · easy calorie add',
        distanceHint: zipHint,
        coachNote: `${coachName}: Not perfect, but reliable. Add a shake and the meal does its job.`,
      },
    ];
  }

  return [
    {
      id: 'recomp-balanced-bowl',
      title: 'Balanced protein bowl',
      venue: 'Chipotle',
      placeType: 'Fast casual bowl spot',
      addressHint: zipHint,
      bestFor: 'Default lunch',
      macros: '40-50g protein · balanced carbs',
      distanceHint: zipHint,
      coachNote: `${coachName}: This is the safest on-the-go choice when you want results without overthinking it.`,
    },
    {
      id: 'recomp-smart-snack',
      title: 'Protein box + fruit',
      venue: 'Starbucks',
      placeType: 'Coffee / convenience stop',
      addressHint: zipHint,
      bestFor: 'Between meetings',
      macros: '20-30g protein · steady appetite control',
      distanceHint: zipHint,
      coachNote: `${coachName}: Better than grazing. Enough protein to hold you until the next real meal.`,
    },
    {
      id: 'recomp-grocery-reset',
      title: 'Deli turkey wrap + water',
      venue: 'Whole Foods Market',
      placeType: 'Grocery / market deli',
      addressHint: zipHint,
      bestFor: 'Travel day backup',
      macros: '30-40g protein · easy swap',
      distanceHint: zipHint,
      coachNote: `${coachName}: This is your reset button when the day gets messy and you still want to stay on plan.`,
    },
    {
      id: 'recomp-cava',
      title: 'Greens + grains bowl',
      venue: 'CAVA',
      placeType: 'Mediterranean fast casual',
      addressHint: zipHint,
      bestFor: 'Default dinner',
      macros: '35-45g protein · balanced carbs',
      distanceHint: zipHint,
      coachNote: `${coachName}: Easy win. Build around protein first and keep the toppings intentional.`,
    },
    {
      id: 'recomp-panera',
      title: 'Chicken avocado melt + apple',
      venue: 'Panera Bread',
      placeType: 'Cafe / quick lunch',
      addressHint: zipHint,
      bestFor: 'Busy workday',
      macros: '30-40g protein · satisfying but controlled',
      distanceHint: zipHint,
      coachNote: `${coachName}: Reliable when you want something normal that still fits the goal.`,
    },
  ];
}

function selectOnTheGoSuggestions(
  pool: OnTheGoSuggestion[],
  favoriteIds: string[],
  rotation: number,
  limit = 3,
) {
  const favorites = favoriteIds
    .map((id) => pool.find((option) => option.id === id))
    .filter((option): option is OnTheGoSuggestion => Boolean(option));
  const nonFavorites = pool.filter((option) => !favoriteIds.includes(option.id));

  if (nonFavorites.length === 0) {
    return favorites.slice(0, limit);
  }

  const start = rotation % nonFavorites.length;
  const rotated = [...nonFavorites.slice(start), ...nonFavorites.slice(0, start)];
  return [...favorites, ...rotated].slice(0, limit);
}

function CalorieRing({ eaten, goal, accentColor }: { eaten: number; goal: number; accentColor: string }) {
  const size = 90;
  const r = 38;
  const cx = 45;
  const cy = 45;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(eaten / Math.max(goal, 1), 1);
  const offset = circ * (1 - pct);

  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke={C.border} strokeWidth={7} />
      <Circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={accentColor}
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={`${circ} ${circ}`}
        strokeDashoffset={offset}
      />
      <SvgText
        x={cx}
        y={cy - 6}
        fill={C.text}
        fontSize={14}
        fontFamily="BebasNeue_400Regular"
        textAnchor="middle"
        alignmentBaseline="middle"
        transform={`rotate(90, ${cx}, ${cy})`}
      >
        {eaten}
      </SvgText>
      <SvgText
        x={cx}
        y={cy + 8}
        fill="#888"
        fontSize={10}
        fontFamily="DMSans_400Regular"
        textAnchor="middle"
        alignmentBaseline="middle"
        transform={`rotate(90, ${cx}, ${cy})`}
      >
        eaten
      </SvgText>
    </Svg>
  );
}

function MacroBar({
  color,
  current,
  name,
  total,
}: {
  color: string;
  current: number;
  name: string;
  total: number;
}) {
  const pct = Math.min((current / Math.max(total, 1)) * 100, 100);

  return (
    <>
      <View style={styles.macroRow}>
        <Text style={styles.macroName}>{name}</Text>
        <Text style={styles.macroGrams}>{current} / {total}g</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </>
  );
}

function FoodItem({ cal, name, serving, accentColor }: { cal: number; name: string; serving: string; accentColor?: string }) {
  return (
    <View style={styles.foodItem}>
      <View style={{ flex: 1 }}>
        <Text style={styles.foodName}>{name}</Text>
        <Text style={styles.foodServing}>{serving}</Text>
      </View>
      <Text style={[styles.foodCal, accentColor ? { color: accentColor } : null]}>{cal} kcal</Text>
    </View>
  );
}

function MealDetailModal({
  accent,
  entry,
  onClose,
}: {
  accent: string;
  entry: NutritionixFoodResult | null;
  onClose: () => void;
}) {
  return (
    <Modal visible={Boolean(entry)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.modal}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>MEAL DETAILS</Text>
          {entry ? (
            <>
              <Text style={[styles.itemTitle, { marginBottom: 6 }]}>{entry.name}</Text>
              <Text style={[styles.itemMeta, { marginBottom: 16 }]}>{entry.servingText}</Text>
              <View style={styles.mealDetailGrid}>
                {[
                  { label: 'Calories', value: `${Math.round(entry.calories)}`, tint: accent },
                  { label: 'Protein', value: `${Math.round(entry.protein)}g`, tint: accent },
                  { label: 'Carbs', value: `${Math.round(entry.carbs)}g`, tint: C.blue },
                  { label: 'Fat', value: `${Math.round(entry.fat)}g`, tint: C.orange },
                ].map((item) => (
                  <View key={item.label} style={styles.mealDetailCell}>
                    <Text style={[styles.mealDetailValue, { color: item.tint }]}>{item.value}</Text>
                    <Text style={styles.mealDetailLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>
              <Pressable style={[styles.btnPrimary, { backgroundColor: accent, marginTop: 8 }]} onPress={onClose}>
                <Text style={styles.btnPrimaryText}>Done</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </Pressable>
    </Modal>
  );
}

function LogFoodModal({
  accentColor,
  onClose,
  onSave,
  visible,
}: {
  accentColor: string;
  onClose: () => void;
  onSave: (name: string) => void;
  visible: boolean;
}) {
  const [query, setQuery] = useState('');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.modal}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>LOG FOOD</Text>
          <Text style={styles.formLabel}>Food Name</Text>
          <TextInput
            style={[styles.formInput, { marginBottom: 20 }]}
            placeholder="Chicken breast, Greek yogurt..."
            placeholderTextColor={C.muted}
            value={query}
            onChangeText={setQuery}
          />
          <View style={styles.modalBtns}>
            <Pressable style={styles.btnGhost} onPress={onClose}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.btnPrimary, { flex: 2, backgroundColor: accentColor }]} onPress={() => onSave(query)}>
              <Text style={styles.btnPrimaryText}>Add to Diary</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const MEAL_PLANS = [
  { icon: '🥩', name: 'High Protein Cut', meta: '2,200 kcal · 220g protein · 12 meals', tag: 'Active plan', active: true },
  { icon: '🌾', name: 'Lean Bulk Meal Plan', meta: '3,200 kcal · 180g protein · 14 meals', tag: 'In library', active: false },
  { icon: '🥦', name: 'Plant-Based Performance', meta: '2,600 kcal · 140g protein · 10 meals', tag: 'Community favorite', active: false },
];

export default function FuelScreen() {
  const { accent, accentSoft, accentBorder, accentStrongBorder } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { session } = useAuth();
  const { addXp } = useGamification();
  const { isPro, isLoading: proLoading } = usePro();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const mealShareRef = React.useRef<ViewShot>(null);
  const [mealShareData, setMealShareData] = useState<MealShareData | null>(null);
  const [tab, setTab] = useState<Tab>('diary');
  const [scanVisible, setScanVisible] = useState(false);
  const [waterOz, setWaterOz] = useState(0);
  const [waterUnit, setWaterUnit] = useState<'oz' | 'ml'>('oz');
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<NutritionixFoodResult[]>([]);
  // YouTube Shorts recipes
  const [recipeVideos, setRecipeVideos] = useState<RecipeVideo[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [selectedRecipeVideo, setSelectedRecipeVideo] = useState<RecipeVideo | null>(null);
  const [recipeCoachLoading, setRecipeCoachLoading] = useState(false);
  const [activeCoachVoice, setActiveCoachVoice] = useState<CoachVoiceOption | null>(null);
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');
  const [servingsModalVisible, setServingsModalVisible] = useState(false);
  const [pendingBarcodeFood, setPendingBarcodeFood] = useState<ScannedFood | null>(null);
  const [barcodeServings, setBarcodeServings] = useState('1');
  const [entries, setEntries] = useState<NutritionixFoodResult[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<NutritionixFoodResult | null>(null);
  const [mealPlan, setMealPlan] = useState<MealPlanDay[] | null>(null);
  const [mealPlanHistory, setMealPlanHistory] = useState<MealPlanHistoryEntry[]>([]);
  const [manualMealDrafts, setManualMealDrafts] = useState<ManualMealDraft[]>([
    { kcal: '', name: '', protein: '', time: 'Breakfast' },
    { kcal: '', name: '', protein: '', time: 'Lunch' },
    { kcal: '', name: '', protein: '', time: 'Dinner' },
    { kcal: '', name: '', protein: '', time: 'Snack' },
  ]);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [groceryList, setGroceryList] = useState<GroceryList | null>(null);
  const [loadingGrocery, setLoadingGrocery] = useState(false);
  const [groceryError, setGroceryError] = useState<string | null>(null);
  const [trimmingBudget, setTrimmingBudget] = useState(false);
  const [groceryBudget, setGroceryBudget] = useState('');
  const [showGrocery, setShowGrocery] = useState(false);
  const [groceryAiInput, setGroceryAiInput] = useState('');
  const [groceryAiLoading, setGroceryAiLoading] = useState(false);
  const [groceryAiBarOpen, setGroceryAiBarOpen] = useState(false);
  const [coachEditInput, setCoachEditInput] = useState('');
  const [coachEditLoading, setCoachEditLoading] = useState(false);
  const [zipPromptVisible, setZipPromptVisible] = useState(false);
  const [zipDraft, setZipDraft] = useState('');
  const [onTheGoVisible, setOnTheGoVisible] = useState(false);
  const [onTheGoZipDraft, setOnTheGoZipDraft] = useState('');
  const [onTheGoZipCode, setOnTheGoZipCode] = useState('');
  const [onTheGoSource, setOnTheGoSource] = useState<'saved_zip' | 'current_location' | 'manual'>('manual');
  const [onTheGoLocating, setOnTheGoLocating] = useState(false);
  const [onTheGoLoadingLive, setOnTheGoLoadingLive] = useState(false);
  const [onTheGoRotation, setOnTheGoRotation] = useState(0);
  const [favoriteOnTheGoIds, setFavoriteOnTheGoIds] = useState<string[]>([]);
  const [onTheGoLiveSuggestions, setOnTheGoLiveSuggestions] = useState<OnTheGoSuggestion[]>([]);
  // Plan waiting to get a zip before generating
  const [pendingGroceryPlan, setPendingGroceryPlan] = useState<MealPlanDay[] | null>(null);
  // hasMealPlanAccess mirrors isPro so it updates instantly when Pro Preview is toggled
  const hasMealPlanAccess = isPro;

  const onTheGoSuggestionPool = useMemo(
    () =>
      buildOnTheGoSuggestionPool({
        coachName: activeCoachVoice?.label ?? 'Your coach',
        profile,
        zipCode: onTheGoZipCode.trim() || profile?.zipCode?.trim(),
      }),
    [activeCoachVoice?.label, onTheGoZipCode, profile],
  );

  const onTheGoSuggestions = useMemo(
    () => selectOnTheGoSuggestions(onTheGoSuggestionPool, favoriteOnTheGoIds, onTheGoRotation),
    [favoriteOnTheGoIds, onTheGoRotation, onTheGoSuggestionPool],
  );

  React.useEffect(() => {
    let cancelled = false;

    if (!onTheGoVisible) {
      return;
    }

    setOnTheGoLoadingLive(true);
    enrichOnTheGoSuggestions({
      suggestions: onTheGoSuggestions,
      zipCode: onTheGoZipCode.trim() || profile?.zipCode?.trim(),
    })
      .then((next) => {
        if (!cancelled) {
          setOnTheGoLiveSuggestions(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOnTheGoLiveSuggestions(onTheGoSuggestions);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOnTheGoLoadingLive(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onTheGoSuggestions, onTheGoVisible, onTheGoZipCode, profile?.zipCode]);

  // Load profile + hydration + saved meal plan + grocery list on every focus
  useFocusEffect(
    React.useCallback(() => {
      getSelectedCoachVoice().then(setActiveCoachVoice).catch(() => null);
      AsyncStorage.getItem(PROFILE_STORAGE_KEY)
        .then((raw) => { if (raw) setProfile(JSON.parse(raw) as UserProfile); })
        .catch(() => null);

      // Load today's hydration (resets automatically when date changes)
      AsyncStorage.getItem(HYDRATION_KEY(todayStr()))
        .then((raw) => setWaterOz(raw ? Number(raw) : 0))
        .catch(() => null);

      // Restore saved meal plan
      AsyncStorage.getItem(MEAL_PLAN_KEY)
        .then((raw) => { if (raw) setMealPlan(JSON.parse(raw) as MealPlanDay[]); })
        .catch(() => null);
      AsyncStorage.getItem(MEAL_PLAN_HISTORY_KEY)
        .then((raw) => { if (raw) setMealPlanHistory(JSON.parse(raw) as MealPlanHistoryEntry[]); })
        .catch(() => null);

      // Restore grocery list + budget
      AsyncStorage.getItem(GROCERY_LIST_KEY)
        .then((raw) => { if (raw) setGroceryList(JSON.parse(raw) as GroceryList); })
        .catch(() => null);
      AsyncStorage.getItem(GROCERY_BUDGET_KEY)
        .then((raw) => { if (raw) setGroceryBudget(raw); })
        .catch(() => null);
      AsyncStorage.getItem(ON_THE_GO_FAVORITES_KEY)
        .then((raw) => { if (raw) setFavoriteOnTheGoIds(JSON.parse(raw) as string[]); })
        .catch(() => null);
      AsyncStorage.getItem(ON_THE_GO_OPEN_REQUEST_KEY)
        .then((flag) => {
          if (flag === '1') {
            setOnTheGoVisible(true);
            AsyncStorage.removeItem(ON_THE_GO_OPEN_REQUEST_KEY).catch(() => null);
          }
        })
        .catch(() => null);
    }, []),
  );

  React.useEffect(() => {
    const savedZip = profile?.zipCode?.trim() ?? '';
    setOnTheGoZipCode(savedZip);
    setOnTheGoZipDraft(savedZip);
    setOnTheGoSource(savedZip ? 'saved_zip' : 'manual');
  }, [profile?.zipCode]);

  // Fetch YouTube Shorts recipes once on mount
  React.useEffect(() => {
    const fetchRecipes = async () => {
      setRecipesLoading(true);
      try {
        // YouTube Data API v3 — search for high-protein / healthy recipe Shorts
        const apiKey = env.youtubeApiKey;
        if (!apiKey) {
          // No key — show curated static fallback cards (always available)
          setRecipeVideos([
            {
              id: 'dQw4w9WgXcQ',
              title: 'High Protein Chicken Bowl (400 kcal)',
              thumb: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
              channel: 'Meal Prep Sunday',
              description: 'A quick high-protein chicken bowl recipe with balanced carbs and easy meal prep ingredients.',
            },
            {
              id: 'abc123',
              title: 'Quick Egg White Oats (5 min)',
              thumb: 'https://img.youtube.com/vi/abc123/mqdefault.jpg',
              channel: 'Fitness Recipes',
              description: 'Fast breakfast idea using oats, egg whites, and protein-friendly ingredients.',
            },
            {
              id: 'xyz789',
              title: 'Greek Yogurt Protein Bowl',
              thumb: 'https://img.youtube.com/vi/xyz789/mqdefault.jpg',
              channel: 'Clean Eats',
              description: 'Simple Greek yogurt bowl recipe with fruit and protein-focused toppings.',
            },
          ]);
          setRecipesLoading(false);
          return;
        }

        const query = 'high protein recipe quick healthy #Shorts';
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=6&q=${encodeURIComponent(query)}&type=video&videoDuration=short&key=${apiKey}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.items && Array.isArray(json.items)) {
          const videos = json.items.map((item: any) => ({
            id: item.id?.videoId ?? '',
            title: item.snippet?.title ?? '',
            thumb: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
            channel: item.snippet?.channelTitle ?? '',
            description: item.snippet?.description ?? '',
          })).filter((v: any) => v.id);
          setRecipeVideos(videos);
        }
      } catch { /* non-critical — leave empty */ } finally {
        setRecipesLoading(false);
      }
    };
    fetchRecipes().catch(() => null);
  }, []);

  React.useEffect(() => {
    if (!session?.user?.id) {
      setEntries([]);
      return;
    }
  }, [session?.user?.id]);

  const refreshEntries = React.useCallback(async () => {
    if (!session?.user?.id) {
      setEntries([]);
      return;
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from('nutrition_entries')
      .select('meal_name, calories, protein_grams, carbs_grams, fat_grams')
      .eq('user_id', session.user.id)
      .gte('consumed_at', startOfDay.toISOString())
      .order('created_at', { ascending: true });

    setEntries(
      (data ?? []).map((item) => ({
        calories: Number(item.calories ?? 0),
        carbs: Number(item.carbs_grams ?? 0),
        fat: Number(item.fat_grams ?? 0),
        name: item.meal_name,
        protein: Number(item.protein_grams ?? 0),
        servingText: 'Logged today',
      })),
    );
  }, [session?.user?.id]);

  React.useEffect(() => {
    refreshEntries().catch(() => null);
  }, [refreshEntries]);

  useFocusEffect(
    React.useCallback(() => {
      refreshEntries().catch(() => null);
    }, [refreshEntries]),
  );

  const totals = useMemo(
    () =>
      entries.reduce(
        (sum, entry) => ({
          calories: sum.calories + entry.calories,
          carbs: sum.carbs + entry.carbs,
          fat: sum.fat + entry.fat,
          protein: sum.protein + entry.protein,
        }),
        { calories: 0, carbs: 0, fat: 0, protein: 0 },
      ),
    [entries],
  );

  const saveEntry = async (entry: {
    calories: number;
    carbs: number;
    fat: number;
    mealName: string;
    protein: number;
    source?: 'barcode' | 'camera' | 'upload' | 'manual';
  }) => {
    if (!session?.user?.id) {
      Alert.alert('Not signed in', 'Log in before saving meals.');
      return;
    }

    const { error } = await supabase.from('nutrition_entries').insert({
      calories: entry.calories,
      carbs_grams: entry.carbs,
      fat_grams: entry.fat,
      meal_name: entry.mealName,
      protein_grams: entry.protein,
      user_id: session.user.id,
      consumed_at: new Date().toISOString(),
    });

    if (error) {
      Alert.alert('Save failed', error.message);
      return;
    }

    setEntries((current) => [
      ...current,
      {
        calories: entry.calories,
        carbs: entry.carbs,
        fat: entry.fat,
        name: entry.mealName,
        protein: entry.protein,
        servingText: 'Logged today',
      },
    ]);

    if (entry.source === 'camera') {
      const currentCount = Number((await AsyncStorage.getItem(FOOD_CAMERA_SCAN_STORAGE_KEY)) ?? 0);
      await AsyncStorage.setItem(FOOD_CAMERA_SCAN_STORAGE_KEY, String(currentCount + 1));
    }

    await addXp(5);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const authorName = profile?.displayName || session?.user?.email?.split('@')[0] || 'Someone';

    Alert.alert(
      `✅ ${entry.mealName} Logged!`,
      `${entry.calories} kcal · P${entry.protein}g C${entry.carbs}g F${entry.fat}g  ·  +5 XP`,
      [
        {
          text: '🔥 Share to Tribe',
          onPress: () => {
            addTextPostToFeed({
              author: authorName,
              badgeType: 'win',
              body: `Just logged ${entry.mealName} — ${entry.calories} kcal, ${entry.protein}g protein 💪 Fuelling the work.`,
            })
              .then(() => Alert.alert('Posted to Tribe! 🔥', 'Your meal win is live in the feed.'))
              .catch(() => null);
          },
        },
        {
          text: '📲 Share on Social',
          onPress: async () => {
            setMealShareData({
              foodName: entry.mealName,
              calories: entry.calories,
              protein: entry.protein,
              carbs: entry.carbs,
              fat: entry.fat,
              displayName: profile?.displayName || session?.user?.email?.split('@')[0],
              accent,
            });
            setTimeout(async () => {
              try {
                const uri = await mealShareRef.current?.capture?.();
                if (uri && (await Sharing.isAvailableAsync())) {
                  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your meal win!' });
                }
              } catch {
                Share.share({ message: `Just logged ${entry.mealName} on APEX — ${entry.calories} kcal · ${entry.protein}g protein 💪 #APEX #NutritionWin` }).catch(() => null);
              }
            }, 200);
          },
        },
        { text: 'Done', style: 'cancel' },
      ],
    );
  };

  const applyFoodToManualEditor = (food: ScannedFood, servings = 1) => {
    const safeServings = Math.max(1, servings);
    setQuery(food.name);
    setManualCalories(String(Math.round(food.calories * safeServings)));
    setManualProtein(String(Math.round(food.protein * safeServings)));
    setManualCarbs(String(Math.round(food.carbs * safeServings)));
    setManualFat(String(Math.round(food.fat * safeServings)));
  };

  const saveScannedFood = async (food: ScannedFood, servings = 1) => {
    const safeServings = Math.max(1, servings);
    await saveEntry({
      calories: Math.round(food.calories * safeServings),
      carbs: Math.round(food.carbs * safeServings),
      fat: Math.round(food.fat * safeServings),
      mealName: safeServings > 1 ? `${food.name} (${safeServings} servings)` : food.name,
      protein: Math.round(food.protein * safeServings),
      source: food.source,
    });
  };

  const persistZipToProfile = async (nextZip: string) => {
    const trimmedZip = nextZip.trim();
    if (!trimmedZip) return;

    const nextProfile: UserProfile = {
      ...(profile ?? {
        age: '',
        displayName: 'Athlete',
        experience: 'intermediate',
        gender: 'male',
        goal: 'recomp',
        goalWeightLbs: '',
        heightFt: '',
        username: 'athlete',
        weightLbs: '',
      }),
      zipCode: trimmedZip,
    };

    setProfile(nextProfile);
    setOnTheGoZipCode(trimmedZip);
    setOnTheGoZipDraft(trimmedZip);
    await syncProfileToSupabase(session?.user?.id, nextProfile).catch(() => null);
  };

  const openOnTheGoFoodFinder = () => {
    const savedZip = profile?.zipCode?.trim() ?? '';
    setOnTheGoZipCode(savedZip);
    setOnTheGoZipDraft(savedZip);
    setOnTheGoSource(savedZip ? 'saved_zip' : 'manual');
    setOnTheGoVisible(true);
  };

  const handleSaveOnTheGoZip = async () => {
    const trimmedZip = onTheGoZipDraft.trim();
    if (!trimmedZip) {
      Alert.alert('Add a ZIP code', 'Enter your ZIP so we can prep nearby food recommendations around your area.');
      return;
    }

    await Haptics.selectionAsync();
    await persistZipToProfile(trimmedZip);
    setOnTheGoSource('manual');
  };

  const handleUseSavedZipForOnTheGo = async () => {
    const savedZip = profile?.zipCode?.trim() || onTheGoZipCode.trim() || onTheGoZipDraft.trim();
    if (!savedZip) {
      Alert.alert('No saved ZIP yet', 'Add a ZIP below or update it in Profile first.');
      return;
    }

    await Haptics.selectionAsync();
    setOnTheGoZipCode(savedZip);
    setOnTheGoZipDraft(savedZip);
    setOnTheGoSource('saved_zip');
  };

  const handleUseCurrentLocationForOnTheGo = async () => {
    setOnTheGoLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Allow location access to use your current area for On the Go food recommendations.');
        return;
      }

      const currentPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const places = await Location.reverseGeocodeAsync(currentPosition.coords);
      const detectedZip = places.find((place) => place.postalCode?.trim())?.postalCode?.trim();

      if (!detectedZip) {
        Alert.alert('ZIP not found', 'We found your location, but could not detect a ZIP code. You can still type it in manually below.');
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await persistZipToProfile(detectedZip);
      setOnTheGoSource('current_location');
    } catch {
      Alert.alert('Location check failed', 'We could not fetch your current location yet. You can still use your saved ZIP for now.');
    } finally {
      setOnTheGoLocating(false);
    }
  };

  const toggleFavoriteOnTheGo = async (optionId: string) => {
    const next = favoriteOnTheGoIds.includes(optionId)
      ? favoriteOnTheGoIds.filter((id) => id !== optionId)
      : [...favoriteOnTheGoIds, optionId];
    setFavoriteOnTheGoIds(next);
    await AsyncStorage.setItem(ON_THE_GO_FAVORITES_KEY, JSON.stringify(next)).catch(() => null);
    await Haptics.selectionAsync();
  };

  const lookForMoreOnTheGoPlaces = async () => {
    if (onTheGoSuggestionPool.length <= 1) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOnTheGoRotation((current) => current + 1);
  };

  const openOnTheGoDirections = async (option: OnTheGoSuggestion) => {
    if (option.googleMapsUri?.trim()) {
      await Linking.openURL(option.googleMapsUri).catch(() => {
        Alert.alert('Could not open maps', 'Try again in a moment.');
      });
      return;
    }

    const destination = `${option.venue} ${onTheGoZipCode || profile?.zipCode || ''}`.trim();
    const encodedDestination = encodeURIComponent(destination);
    const primaryUrl =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?q=${encodedDestination}`
        : `google.navigation:q=${encodedDestination}`;
    const fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${encodedDestination}`;

    try {
      const canOpenPrimary = await Linking.canOpenURL(primaryUrl);
      await Linking.openURL(canOpenPrimary ? primaryUrl : fallbackUrl);
    } catch {
      Alert.alert('Could not open maps', 'Try again in a moment.');
    }
  };

  const openOnTheGoWebsite = async (option: OnTheGoSuggestion) => {
    if (option.websiteUri?.trim()) {
      await Linking.openURL(option.websiteUri).catch(() => {
        Alert.alert('Could not open website', 'Try again in a moment.');
      });
      return;
    }

    const query = encodeURIComponent(`${option.venue} official website`);
    await Linking.openURL(`https://www.google.com/search?q=${query}`).catch(() => {
      Alert.alert('Could not open website search', 'Try again in a moment.');
    });
  };

  const openOnTheGoReviews = async (option: OnTheGoSuggestion) => {
    if (option.reviewsUrl?.trim()) {
      await Linking.openURL(option.reviewsUrl).catch(() => {
        Alert.alert('Could not open reviews', 'Try again in a moment.');
      });
      return;
    }

    const query = encodeURIComponent(`${option.venue} ${onTheGoZipCode || profile?.zipCode || ''} reviews`);
    await Linking.openURL(`https://www.google.com/search?q=${query}`).catch(() => {
      Alert.alert('Could not open reviews', 'Try again in a moment.');
    });
  };

  const handleSearch = async () => {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSearching(true);
    setHasSearched(false);
    try {
      const items = await searchFood(normalizedQuery);
      setResults(items);
      setHasSearched(true);
    } catch (error) {
      Alert.alert(
        'Search failed',
        error instanceof Error ? error.message : 'Unable to search food right now. Check your connection.',
      );
      setHasSearched(true);
    } finally {
      setSearching(false);
    }
  };

  React.useEffect(() => {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) {
      setSearching(false);
      setHasSearched(false);
      setResults([]);
      return;
    }

    const timeout = setTimeout(() => {
      handleSearch().catch(() => null);
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const saveMealPlanHistory = async (plan: MealPlanDay[], label: string) => {
    const entry: MealPlanHistoryEntry = {
      generatedAt: new Date().toISOString(),
      id: `${Date.now()}`,
      label,
      plan,
    };
    const nextHistory = [entry, ...mealPlanHistory].slice(0, 3);
    setMealPlanHistory(nextHistory);
    await AsyncStorage.setItem(MEAL_PLAN_HISTORY_KEY, JSON.stringify(nextHistory)).catch(() => null);
  };

  const updateManualMealDraft = (index: number, field: keyof ManualMealDraft, value: string) => {
    setManualMealDrafts((current) => current.map((draft, draftIndex) => (
      draftIndex === index ? { ...draft, [field]: value } : draft
    )));
  };

  const saveManualMealPlan = async () => {
    const plan = buildManualWeeklyPlan(manualMealDrafts);
    const hasMeals = plan[0]?.meals?.length > 0;
    if (!hasMeals) {
      Alert.alert('Add a few meals first', 'Enter at least one meal so we can build your manual meal plan.');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMealPlan(plan);
    await AsyncStorage.setItem(MEAL_PLAN_KEY, JSON.stringify(plan)).catch(() => null);
    await saveMealPlanHistory(plan, 'Manual Weekly Plan');
    Alert.alert('Manual meal plan saved', 'Your weekly plan is ready. You can still log meals in Diary anytime.');
  };

  const handleScanResult = async (food: ScannedFood) => {
    if (food.source === 'barcode') {
      setPendingBarcodeFood(food);
      setBarcodeServings('1');
      setServingsModalVisible(true);
      return;
    }

    applyFoodToManualEditor(food);
    Alert.alert(
      `Found: ${food.name}`,
      `${food.calories} kcal · P${food.protein} C${food.carbs} F${food.fat}${food.recommendation ? `\n\nNext move:\n${food.recommendation}` : ''}`,
      [
        { text: 'Edit first', style: 'cancel' },
        {
          text: 'Add to Diary ✓',
          onPress: () => saveScannedFood(food),
        },
      ],
    );
  };

  const handleSaveManual = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!query.trim()) {
      Alert.alert('Meal name required', 'Enter a meal name before saving it.');
      return;
    }

    await saveEntry({
      calories: Number(manualCalories || 0),
      carbs: Number(manualCarbs || 0),
      fat: Number(manualFat || 0),
      mealName: query.trim(),
      protein: Number(manualProtein || 0),
    });
  };

  const handleAddWater = async (oz: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const goal = hydrationGoalOz(profile);
    setWaterOz((current) => {
      const next = Math.min(current + oz, goal * 2);
      AsyncStorage.setItem(HYDRATION_KEY(todayStr()), String(next)).catch(() => null);
      return next;
    });
  };

  const handleResetWater = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setWaterOz(0);
    await AsyncStorage.setItem(HYDRATION_KEY(todayStr()), '0');
  };

  const loadMealPlan = async () => {
    if (!hasMealPlanAccess) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await maybeShowPaywall(session?.user?.id).catch(() => null);
      navigation.navigate('Upgrade');
      return;
    }

    // Check cache first
    const cached = await AsyncStorage.getItem(MEAL_PLAN_KEY).catch(() => null);
    if (cached) {
      setMealPlan(JSON.parse(cached) as MealPlanDay[]);
      return;
    }

    setLoadingPlan(true);
    try {
      const { dailyCalorieTarget: kcal, dailyProtein: protein, dailyCarbs: carbs, dailyFat: fat } =
        getOrComputeMacroTargets(profile);
      const goal = profile?.goal ?? 'recomp';
      const goalMap: Record<string, string> = {
        lose: 'fat loss and a calorie deficit',
        build: 'muscle gain and a slight calorie surplus',
        recomp: 'body recomposition at maintenance',
        performance: 'athletic performance and energy',
      };
      const preferenceLine = profile?.foodPreferences?.length
        ? `Food preferences: ${profile.foodPreferences.join(', ')}`
        : 'Food preferences: none specified';
      const avoidanceLine = profile?.foodAvoidances?.trim()
        ? `Avoid these foods: ${profile.foodAvoidances.trim()}`
        : 'Avoid these foods: none specified';

      const prompt = `Create a 7-day meal plan for someone with these daily targets:
Goal: ${goalMap[goal] ?? 'general fitness'}
Calories: ${kcal} kcal/day
Protein: ${protein}g · Carbs: ${carbs}g · Fat: ${fat}g
${preferenceLine}
${avoidanceLine}

Reply with ONLY valid JSON array, no extra text:
[{"day":"Monday","meals":[{"name":"<meal name>","kcal":<number>,"protein":<number>,"time":"<Breakfast|Lunch|Dinner|Snack>"},...]},...7 days]

Rules: Each day must total ≈${kcal} kcal. Use realistic, common foods. Respect all food preferences and avoid listed foods. Keep meal names short (≤5 words).`;

      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        },
      });

      if (error) throw error;

      const raw: string = (data?.content as Array<{ text?: string }>)
        ?.map((b) => b.text ?? '')
        .join('') ?? '';

      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('Bad format');

      const plan = JSON.parse(jsonMatch[0]) as MealPlanDay[];
      setMealPlan(plan);
      await AsyncStorage.setItem(MEAL_PLAN_KEY, JSON.stringify(plan));
      await saveMealPlanHistory(plan, 'AI Generated Plan');

      // Auto-generate grocery list for the new plan
      generateGroceryList(plan).catch(() => null);
    } catch {
      Alert.alert('Plan unavailable', 'Could not generate your meal plan right now. Try again.');
    } finally {
      setLoadingPlan(false);
    }
  };

  const generateGroceryList = async (plan: MealPlanDay[], overrideZip?: string) => {
    // Resolve zip: explicit override → saved profile zip → ask the user
    const zip = overrideZip?.trim() || profile?.zipCode?.trim();

    if (!zip) {
      setPendingGroceryPlan(plan);
      setZipDraft('');
      setZipPromptVisible(true);
      return;
    }

    // Persist new zip to profile so we never need to ask again
    if (overrideZip?.trim() && profile && !profile.zipCode) {
      const updated = { ...profile, zipCode: overrideZip.trim() };
      setProfile(updated);
      AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(updated)).catch(() => null);
    }

    setGroceryError(null);
    setLoadingGrocery(true);

    try {
      const mealNames = plan
        .flatMap((d) => d.meals.map((m) => m.name))
        .join(', ');

      // Keep the item count low (12-15) so the JSON always fits within token budget.
      // Consolidate aggressively — this is the #1 reason for truncation errors.
      const groceryPrompt = `Meal plan: ${mealNames}

ZIP code: ${zip}

Return a JSON grocery list for these meals. Use ONLY this exact structure — nothing else, no markdown:
{"stores":["Store A","Store B"],"items":[{"n":"item name","q":"qty","p":0.00,"c":"category"}]}

Rules:
- 12 to 15 consolidated items max (combine similar ingredients across days)
- "c" must be one of: Produce, Protein, Dairy & Eggs, Grains & Bread, Pantry, Frozen, Beverages, Other
- "p" is a realistic USD price for zip ${zip}
- "stores" should list 2 real grocery chains common near that zip
- Output the JSON immediately with no preamble or explanation`;

      const { data: gData, error: gError } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 3000,
          system: 'You are a grocery list assistant. Output valid JSON only. No markdown fences, no explanation, no extra text before or after the JSON object.',
          messages: [{ role: 'user', content: groceryPrompt }],
        },
      });

      if (gError) throw new Error(gError?.message ?? String(gError));

      // Extract raw text — handle string, content-block array, or nested data shapes
      let gRaw = '';
      if (typeof gData?.content === 'string') {
        gRaw = gData.content;
      } else if (Array.isArray(gData?.content)) {
        gRaw = (gData.content as Array<{ text?: string }>).map((b) => b.text ?? '').join('');
      } else if (typeof gData?.data?.content === 'string') {
        gRaw = gData.data.content;
      } else if (Array.isArray(gData?.data?.content)) {
        gRaw = (gData.data.content as Array<{ text?: string }>).map((b) => b.text ?? '').join('');
      } else if (typeof gData === 'string') {
        gRaw = gData;
      }

      if (!gRaw.trim()) throw new Error('AI returned an empty response. Please try again.');

      // Strip markdown fences and find the JSON object
      const stripped = gRaw.replace(/```(?:json)?/gi, '').trim();
      let jsonStr = '';
      const match = stripped.match(/\{[\s\S]*\}/);
      if (match) {
        jsonStr = match[0];
      } else {
        throw new Error(`Response did not contain JSON.\n\nReceived: "${stripped.slice(0, 150)}"`);
      }

      // Attempt parse; if truncated try closing it
      let parsed: { stores?: string[]; nearbyStores?: string[]; items: Array<{ n?: string; name?: string; q?: string; quantity?: string; p?: number; estimatedPrice?: number; c?: string; category?: string }> };
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // JSON might be truncated — try closing array + object
        try {
          parsed = JSON.parse(jsonStr + ']}');
        } catch {
          throw new Error(`Could not parse grocery list JSON. Raw: "${jsonStr.slice(0, 200)}"`);
        }
      }

      if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
        throw new Error('AI returned an empty grocery list. Try again.');
      }

      // Normalise both compact (n/q/p/c) and verbose (name/quantity/estimatedPrice/category) field names
      const items: GroceryItem[] = parsed.items.map((item, i) => ({
        id: `g-${Date.now()}-${i}`,
        name: item.name ?? item.n ?? 'Item',
        quantity: item.quantity ?? item.q ?? '',
        estimatedPrice: item.estimatedPrice ?? item.p ?? 0,
        category: (item.category ?? item.c ?? 'Other') as GroceryCategory,
        checked: false,
      }));

      const totalEstimate = items.reduce((sum, item) => sum + item.estimatedPrice, 0);
      const list: GroceryList = {
        items,
        nearbyStores: parsed.stores ?? parsed.nearbyStores ?? [],
        totalEstimate,
        generatedAt: new Date().toISOString(),
      };

      setGroceryList(list);
      setGroceryError(null);
      await AsyncStorage.setItem(GROCERY_LIST_KEY, JSON.stringify(list));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGroceryError(msg);
    } finally {
      setLoadingGrocery(false);
    }
  };

  const toggleGroceryItem = async (id: string) => {
    if (!groceryList) return;
    const updated: GroceryList = {
      ...groceryList,
      items: groceryList.items.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item,
      ),
    };
    setGroceryList(updated);
    await AsyncStorage.setItem(GROCERY_LIST_KEY, JSON.stringify(updated)).catch(() => null);
  };

  const saveBudget = async (value: string) => {
    setGroceryBudget(value);
    await AsyncStorage.setItem(GROCERY_BUDGET_KEY, value).catch(() => null);
  };

  const handleTrimToBudget = async () => {
    if (!groceryList || !groceryBudget) return;
    const budget = parseFloat(groceryBudget);
    if (isNaN(budget) || budget <= 0) return;
    if (groceryList.totalEstimate <= budget) return;

    setTrimmingBudget(true);
    try {
      // Sort by price descending — remove most expensive items first until within budget
      let remaining = [...groceryList.items].sort((a, b) => b.estimatedPrice - a.estimatedPrice);
      let total = remaining.reduce((sum, i) => sum + i.estimatedPrice, 0);

      const toRemove = new Set<string>();
      for (const item of remaining) {
        if (total <= budget) break;
        if (remaining.length - toRemove.size <= 6) break; // always keep at least 6 items
        toRemove.add(item.id);
        total -= item.estimatedPrice;
      }

      // If still over (couldn't remove enough without going below 6 items),
      // proportionally reduce prices of the remaining most-expensive items
      if (total > budget) {
        const overBy = total - budget;
        const expensive = remaining
          .filter((i) => !toRemove.has(i.id))
          .sort((a, b) => b.estimatedPrice - a.estimatedPrice)
          .slice(0, 3);
        const totalExpensive = expensive.reduce((s, i) => s + i.estimatedPrice, 0);
        if (totalExpensive > 0) {
          expensive.forEach((item) => {
            item.estimatedPrice = parseFloat(
              Math.max(0, item.estimatedPrice - overBy * (item.estimatedPrice / totalExpensive)).toFixed(2),
            );
          });
          total = remaining
            .filter((i) => !toRemove.has(i.id))
            .reduce((s, i) => s + i.estimatedPrice, 0);
        }
      }

      const trimmedItems = remaining.filter((i) => !toRemove.has(i.id));
      const newTotal = trimmedItems.reduce((s, i) => s + i.estimatedPrice, 0);

      const updated: GroceryList = {
        ...groceryList,
        items: trimmedItems,
        totalEstimate: parseFloat(newTotal.toFixed(2)),
      };

      setGroceryList(updated);
      await AsyncStorage.setItem(GROCERY_LIST_KEY, JSON.stringify(updated));
    } finally {
      setTrimmingBudget(false);
    }
  };

  // AI grocery assistant — swap items, answer questions, change stores, apply edits in real-time
  const groceryAiEdit = async (request: string) => {
    if (!request.trim() || !groceryList) return;
    setGroceryAiLoading(true);
    setGroceryAiInput('');
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const personaPrefix = await getCoachPersonaPrefix().catch(() => '');
      const listSnapshot = JSON.stringify(
        groceryList.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.estimatedPrice, category: i.category })),
      );
      const currentStores = groceryList.nearbyStores?.join(', ') ?? 'unknown';
      const budgetLine = groceryBudget ? `Current budget: $${parseFloat(groceryBudget).toFixed(2)}` : '';
      const zip = profile?.zipCode?.trim() ?? '';

      const mealPlanSnapshot = mealPlan ? JSON.stringify(mealPlan) : null;

      const prompt = `You are a smart grocery and meal plan assistant helping someone update their shopping list while they shop.

Current grocery list (JSON):
${listSnapshot}
Current stores: ${currentStores}
${zip ? `ZIP code: ${zip}` : ''}
${budgetLine}
Estimated total: $${groceryList.totalEstimate.toFixed(2)}
${mealPlanSnapshot ? `\nCurrent meal plan (JSON):\n${mealPlanSnapshot}` : ''}

User request: "${request.trim()}"

Apply the requested changes. You can:
- Swap, add, or remove grocery items
- Adjust quantities or prices
- Change the store list if the user wants to shop somewhere different (update "stores" with 1-3 real chain names near ${zip || 'their area'})
- Update the meal plan meals to reflect any ingredient swaps (e.g. if chicken is swapped for salmon, update every meal that used chicken to use salmon instead, keeping kcal and protein roughly the same)

Preserve existing grocery category names wherever possible.
Reply with ONLY valid JSON — no extra text, no markdown:
{"stores":["Store A","Store B"],"items":[{"n":"<name>","q":"<quantity>","p":<price>,"c":"<category>"},...${mealPlanSnapshot ? '],"mealPlan":[{"day":"Monday","meals":[{"name":"<meal>","kcal":<n>,"protein":<n>,"time":"<time>"},...]},...7 days' : ''}]}`;

      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 3000,
          system: `${personaPrefix}You are a grocery list and meal plan assistant. Output valid JSON only. No markdown, no explanation.`,
          messages: [{ role: 'user', content: prompt }],
        },
      });

      if (error) throw error;

      const raw: string =
        (data?.content as Array<{ text?: string }>)?.map((b) => b.text ?? '').join('') ??
        (typeof data === 'string' ? data : '');
      const stripped = raw.replace(/```(?:json)?/gi, '').trim();
      const match = stripped.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');

      const parsed = JSON.parse(match[0]) as {
        stores?: string[];
        items: Array<{ n?: string; name?: string; q?: string; quantity?: string; p?: number; estimatedPrice?: number; c?: string; category?: string }>;
        mealPlan?: MealPlanDay[];
      };
      if (!Array.isArray(parsed.items)) throw new Error('Bad format');

      const newItems: GroceryItem[] = parsed.items.map((item, idx) => ({
        id: `ai-edit-${idx}-${Date.now()}`,
        name: item.name ?? item.n ?? 'Item',
        quantity: item.quantity ?? item.q ?? '',
        estimatedPrice: item.estimatedPrice ?? item.p ?? 0,
        category: (item.category ?? item.c ?? 'Other') as GroceryCategory,
        checked: false,
      }));

      const newTotal = newItems.reduce((s, i) => s + i.estimatedPrice, 0);
      const updated: GroceryList = {
        ...groceryList,
        items: newItems,
        totalEstimate: newTotal,
        nearbyStores: (parsed.stores && parsed.stores.length > 0) ? parsed.stores : groceryList.nearbyStores,
      };
      setGroceryList(updated);
      await AsyncStorage.setItem(GROCERY_LIST_KEY, JSON.stringify(updated));

      // Also update the meal plan if the AI returned one
      if (Array.isArray(parsed.mealPlan) && parsed.mealPlan.length > 0) {
        setMealPlan(parsed.mealPlan);
        await AsyncStorage.setItem(MEAL_PLAN_KEY, JSON.stringify(parsed.mealPlan));
      }

      setGroceryAiBarOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('AI Assistant', `Could not update the list: ${msg}`);
    } finally {
      setGroceryAiLoading(false);
    }
  };

  // AI Coach: edit existing plan or create a new one from scratch based on user text
  const coachEditPlan = async (request: string) => {
    if (!request.trim()) return;
    setCoachEditLoading(true);
    setCoachEditInput('');
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const personaPrefix = await getCoachPersonaPrefix().catch(() => '');
      const { dailyCalorieTarget: kcal, dailyProtein: protein, dailyCarbs: carbs, dailyFat: fat } =
        getOrComputeMacroTargets(profile);
      const goal = profile?.goal ?? 'recomp';
      const goalLabel = ({ lose: 'fat loss', build: 'muscle building', recomp: 'body recomposition', performance: 'athletic performance' } as Record<string, string>)[goal] ?? goal;
      const preferenceLine = profile?.foodPreferences?.length
        ? `Food preferences: ${profile.foodPreferences.join(', ')}`
        : '';
      const avoidanceLine = profile?.foodAvoidances?.trim()
        ? `Avoid these foods: ${profile.foodAvoidances.trim()}`
        : '';

      let prompt: string;

      if (mealPlan) {
        // Modify existing plan
        prompt = `You are modifying an existing 7-day meal plan for an athlete with a goal of ${goalLabel}.
Daily targets: ${kcal} kcal · Protein: ${protein}g · Carbs: ${carbs}g · Fat: ${fat}g
${preferenceLine}${preferenceLine ? '\n' : ''}${avoidanceLine}${avoidanceLine ? '\n' : ''}
Current plan:
${JSON.stringify(mealPlan)}

User request: "${request.trim()}"

Apply the requested changes while keeping the daily calorie and macro targets approximately the same.
Reply with ONLY valid JSON — no extra text, no markdown:
[{"day":"Monday","meals":[{"name":"<meal name>","kcal":<number>,"protein":<number>,"time":"<Breakfast|Lunch|Dinner|Snack>"},...]},...7 days]`;
      } else {
        // No plan yet — create a fresh one incorporating the request
        prompt = `Create a 7-day meal plan for someone with these daily targets:
Goal: ${goalLabel}
Calories: ${kcal} kcal
Protein: ${protein}g · Carbs: ${carbs}g · Fat: ${fat}g
${preferenceLine}${preferenceLine ? '\n' : ''}${avoidanceLine}

Special request from user: "${request.trim()}"

Reply with ONLY valid JSON — no extra text, no markdown:
[{"day":"Monday","meals":[{"name":"<meal name>","kcal":<number>,"protein":<number>,"time":"<Breakfast|Lunch|Dinner|Snack>"},...]},...7 days]`;
      }

      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 2000,
          system: `${personaPrefix}You are the user's chosen APEX coach. Keep the meal plan practical, realistic, and aligned with your coaching style.`,
          messages: [{ role: 'user', content: prompt }],
        },
      });

      if (error) throw error;

      const raw: string = (data?.content as Array<{ text?: string }>)?.map((b) => b.text ?? '').join('') ?? '';
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Bad plan format');

      const parsed = JSON.parse(match[0]) as MealPlanDay[];
      setMealPlan(parsed);
      await AsyncStorage.setItem(MEAL_PLAN_KEY, JSON.stringify(parsed));
      await saveMealPlanHistory(parsed, mealPlan ? 'AI Edited Plan' : 'AI Generated From Coach');

      // Always regenerate the grocery list after AI edits the plan
      generateGroceryList(parsed).catch(() => null);
    } catch {
      Alert.alert('AI Coach', 'Could not update the meal plan right now. Try again in a moment.');
    } finally {
      setCoachEditLoading(false);
    }
  };

  const handleUseRecipeWithCoach = async (mode: 'meal' | 'grocery' | 'both') => {
    if (!selectedRecipeVideo) return;
    setRecipeCoachLoading(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
      const recipeSummary = `${selectedRecipeVideo.title} by ${selectedRecipeVideo.channel}${selectedRecipeVideo.description ? `. ${selectedRecipeVideo.description}` : ''}`;

      if (mode === 'meal' || mode === 'both') {
        await coachEditPlan(
          `Use this recipe in my plan this week and keep my macros aligned: ${recipeSummary}. Add it in the best fitting meal slot and keep it realistic.`,
        );
      }

      if (mode === 'grocery') {
        if (!groceryList) {
          if (!mealPlan) {
            Alert.alert('Need a plan first', 'Create or save a meal plan first so the AI coach can build a matching grocery list from this recipe.');
            return;
          }

          await coachEditPlan(
            `Keep my plan structure mostly the same, but work this recipe into it so the grocery list includes the right ingredients: ${recipeSummary}.`,
          );
        } else {
          await groceryAiEdit(`Add the ingredients for this recipe to my grocery list and keep the list practical: ${recipeSummary}.`);
        }
      }

      if (mode === 'both') {
        Alert.alert('AI Coach updated it', 'That recipe has been worked into your meal plan and grocery flow.');
      } else if (mode === 'meal') {
        Alert.alert('Meal plan updated', 'AI Coach worked that recipe into your plan.');
      } else {
        Alert.alert('Grocery list updated', 'AI Coach added that recipe into your grocery flow.');
      }
    } finally {
      setRecipeCoachLoading(false);
    }
  };

  const promptRecipeCoachAction = () => {
    if (!selectedRecipeVideo) return;
    Alert.alert(
      'Use this recipe',
      'What should AI Coach do with this recipe?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Meal Plan', onPress: () => { handleUseRecipeWithCoach('meal').catch(() => null); } },
        { text: 'Grocery List', onPress: () => { handleUseRecipeWithCoach('grocery').catch(() => null); } },
        { text: 'Both', onPress: () => { handleUseRecipeWithCoach('both').catch(() => null); } },
      ],
    );
  };

  // Resolve macro targets — uses stored values when present, otherwise
  // derives them on-the-fly from Mifflin-St Jeor so legacy profiles
  // (created before the BMR step was added) still get real numbers.
  const { dailyCalorieTarget: calGoal, dailyProtein: proteinGoal,
          dailyCarbs: carbsGoal, dailyFat: fatGoal } = getOrComputeMacroTargets(profile);
  const mealTemplates = useMemo(
    () => buildMealTemplates({ calorieGoal: calGoal, mealPlan, profile, proteinGoal }),
    [calGoal, mealPlan, profile, proteinGoal],
  );
  const waterGoal = hydrationGoalOz(profile);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'diary', label: 'Diary' },
    { key: 'macros', label: 'Macros' },
    { key: 'plans', label: 'Meal Plans' },
    { key: 'water', label: 'Hydration' },
  ];

  return (
    <View style={styles.screen}>
      <AppHeader />
      <View style={styles.tabRow}>
        {tabs.map((item) => (
          <Pressable
            key={item.key}
            style={[styles.tabBtn, tab === item.key ? styles.tabBtnActive : null]}
            onPress={() => setTab(item.key)}
          >
            <View style={styles.tabLabelWrap}>
              <Text style={[styles.tabBtnText, tab === item.key ? [styles.tabBtnTextActive, { color: accent }] : null]}>
                {item.label}
              </Text>
              {item.key === 'plans' && !isPro && !proLoading ? (
                <View style={styles.proPill}>
                  <Text style={styles.proPillText}>PRO</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === 'diary' ? (
          <>
            <View style={styles.card}>
              <View style={styles.calorieHeader}>
                <CalorieRing eaten={Math.round(totals.calories)} goal={calGoal} accentColor={accent} />
                <View style={{ flex: 1 }}>
                  <View style={styles.calorieSummaryRow}>
                    <View style={styles.calorieSummaryCol}>
                      <Text style={[styles.calNum, { color: accent }]}>{Math.round(totals.calories)}</Text>
                      <Text style={styles.calLabel}>EATEN</Text>
                    </View>
                    <View style={styles.calorieSummaryCol}>
                      <Text style={[styles.calNum, { color: accent }]}>{Math.max(calGoal - Math.round(totals.calories), 0)}</Text>
                      <Text style={styles.calLabel}>LEFT</Text>
                    </View>
                  </View>
                  {/* Single entry point — opens FoodScanModal (photo/upload/barcode) */}
                  <Pressable style={[styles.btnPrimary, { backgroundColor: accent }]} onPress={() => setScanVisible(true)}>
                    <Text style={styles.btnPrimaryText}>📷 Log Food</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.divider} />
              <MacroBar name="Protein" current={Math.round(totals.protein)} total={proteinGoal} color={accent} />
              <MacroBar name="Carbs" current={Math.round(totals.carbs)} total={carbsGoal} color={C.blue} />
              <MacroBar name="Fat" current={Math.round(totals.fat)} total={fatGoal} color={C.orange} />
            </View>

            <Pressable
              style={[styles.onTheGoCard, { borderColor: accentBorder, backgroundColor: accentSoft }]}
              onPress={openOnTheGoFoodFinder}
            >
              <View style={styles.onTheGoHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.onTheGoEyebrow, { color: accent }]}>ON THE GO</Text>
                  <Text style={styles.onTheGoTitle}>Find healthy food fast</Text>
                  <Text style={styles.onTheGoBody}>
                    {profile?.zipCode
                      ? `Use ZIP ${profile.zipCode} or your current location to get coach-guided quick picks nearby.`
                      : 'Use your ZIP or current location to get coach-guided quick picks when you need food fast.'}
                  </Text>
                </View>
                {activeCoachVoice ? (
                  <Image source={activeCoachVoice.avatar} style={styles.onTheGoCoachAvatar} />
                ) : (
                  <Text style={styles.onTheGoEmoji}>🥗</Text>
                )}
              </View>
              <View style={styles.onTheGoTagsRow}>
                {['High protein', 'Goal fit', 'Quick pickup'].map((tag) => (
                  <View key={tag} style={styles.onTheGoTag}>
                    <Text style={styles.onTheGoTagText}>{tag}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.onTheGoFooter}>
                <Text style={styles.onTheGoFooterText}>
                  {profile?.zipCode ? `Ready for ${profile.zipCode}` : 'Add your area and open the finder'}
                </Text>
                <Text style={[styles.onTheGoFooterAction, { color: accent }]}>Open ›</Text>
              </View>
            </Pressable>

            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="2 eggs and bacon"
                placeholderTextColor={C.muted}
              />
              <Pressable style={[styles.searchButton, { backgroundColor: accent }]} onPress={handleSearch}>
                <Text style={styles.searchButtonText}>{searching ? '...' : '🤖 AI Search'}</Text>
              </Pressable>
            </View>

            <View style={styles.manualRow}>
              <TextInput style={styles.metricInput} keyboardType="numeric" value={manualCalories} onChangeText={setManualCalories} placeholder="Calories" placeholderTextColor={C.muted} />
              <TextInput style={styles.metricInput} keyboardType="numeric" value={manualProtein} onChangeText={setManualProtein} placeholder="Protein" placeholderTextColor={C.muted} />
              <TextInput style={styles.metricInput} keyboardType="numeric" value={manualCarbs} onChangeText={setManualCarbs} placeholder="Carbs" placeholderTextColor={C.muted} />
              <TextInput style={styles.metricInput} keyboardType="numeric" value={manualFat} onChangeText={setManualFat} placeholder="Fat" placeholderTextColor={C.muted} />
            </View>

            <Pressable style={[styles.saveManualButton, { backgroundColor: accent, borderColor: accentStrongBorder }]} onPress={handleSaveManual}>
              <Text style={[styles.saveManualButtonText, { color: '#000' }]}>Save Manual Entry</Text>
            </Pressable>

            {searching ? (
              <View style={{ gap: 8, marginTop: 4 }}>
                {[0, 1, 2, 4].map((i) => (
                  <View key={i} style={styles.searchItem}>
                    <SkeletonCard height={14} width="60%" borderRadius={6} />
                    <SkeletonCard height={11} width="45%" borderRadius={6} style={{ marginTop: 5 }} />
                    <SkeletonCard height={11} width="35%" borderRadius={6} style={{ marginTop: 4 }} />
                  </View>
                ))}
              </View>
            ) : hasSearched && results.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
                <Text style={{ fontSize: 28 }}>🔍</Text>
                <Text style={{ color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 18 }}>No results found</Text>
                <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center', lineHeight: 18 }}>
                  Try a more specific name, like{'\n'}"grilled chicken breast" or "oats 100g"
                </Text>
              </View>
            ) : results.length > 0 ? (
              <FlatList
                scrollEnabled={false}
                data={results}
                keyExtractor={(item, index) => `${item.name}-${index}`}
                contentContainerStyle={styles.resultList}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.searchItem}
                    onPress={() =>
                      saveEntry({
                        calories: item.calories,
                        carbs: item.carbs,
                        fat: item.fat,
                        mealName: item.name,
                        protein: item.protein,
                      })
                    }
                  >
                    <Text style={styles.itemTitle}>{item.name}</Text>
                    <Text style={styles.itemMeta}>
                      {item.servingText} · {Math.round(item.calories)} kcal
                    </Text>
                    <Text style={styles.itemMeta}>
                      P {Math.round(item.protein)} · C {Math.round(item.carbs)} · F {Math.round(item.fat)}
                    </Text>
                  </Pressable>
                )}
              />
            ) : null}

            <SectionLabel>Today&apos;s Entries</SectionLabel>
            {entries.length === 0 ? (
              <Pressable style={styles.emptyMeal} onPress={() => setScanVisible(true)}>
                <Text style={styles.emptyMealText}>+ Add your first meal to hit your goals</Text>
              </Pressable>
            ) : (
              entries.map((item, index) => (
                <Pressable key={`${item.name}-${index}`} onPress={() => setSelectedEntry(item)}>
                  <FoodItem
                    name={item.name}
                    serving={item.servingText}
                    cal={Math.round(item.calories)}
                    accentColor={accent}
                  />
                </Pressable>
              ))
            )}

            {/* ── Quick Recipes 🎬 ── */}
            {(recipesLoading || recipeVideos.length > 0) && (
              <>
                <SectionLabel>Quick Recipes 🎬</SectionLabel>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10, paddingBottom: 4, paddingHorizontal: 2 }}
                >
                  {recipesLoading
                    ? [0, 1, 2].map((i) => (
                        <SkeletonCard
                          key={i}
                          height={140}
                          width={160}
                          borderRadius={12}
                          style={{ marginRight: 0 }}
                        />
                      ))
                    : recipeVideos.map((v) => (
                        <Pressable
                          key={v.id}
                          style={styles.recipeCard}
                          onPress={() => setSelectedRecipeVideo(v)}
                        >
                          <Image
                            source={{ uri: v.thumb }}
                            style={styles.recipeThumb}
                            resizeMode="cover"
                          />
                          <View style={styles.recipeInfo}>
                            <Text style={styles.recipeTitle} numberOfLines={2}>{v.title}</Text>
                            <Text style={styles.recipeChannel} numberOfLines={1}>{v.channel}</Text>
                          </View>
                        </Pressable>
                      ))}
                </ScrollView>
              </>
            )}
          </>
        ) : null}

        {tab === 'macros' ? (
          <>
            {(() => {
              const calEaten    = Math.round(totals.calories);
              const proEaten    = Math.round(totals.protein);
              const fatEaten    = Math.round(totals.fat);
              const carbEaten   = Math.round(totals.carbs);
              const calLeft     = calGoal - calEaten;
              const proLeft     = proteinGoal - proEaten;
              const fatOver     = fatEaten - fatGoal;
              const carbLeft    = carbsGoal - carbEaten;
              const calPct      = Math.round((calEaten / calGoal) * 100);
              const proPct      = Math.round((proEaten / proteinGoal) * 100);

              // Build contextual coaching lines in priority order
              const lines: string[] = [];

              if (calEaten === 0) {
                lines.push("No meals logged yet — start tracking to get personalised coaching.");
              } else {
                // Protein — most important for body-comp goals
                if (proPct < 50) {
                  lines.push(`⚠️ Protein is well behind at ${proEaten}/${proteinGoal}g — ${proLeft}g still needed. Prioritise chicken, Greek yogurt, eggs, or protein shakes.`);
                } else if (proPct < 80) {
                  lines.push(`💪 Protein is on track (${proEaten}g) but ${proLeft}g short — add a lean protein source before the day ends.`);
                } else if (proLeft <= 0) {
                  lines.push(`✅ Protein goal crushed at ${proEaten}/${proteinGoal}g — great work on muscle recovery.`);
                } else {
                  lines.push(`💪 Protein looking solid (${proEaten}/${proteinGoal}g) — ${proLeft}g left to go.`);
                }

                // Fat overage
                if (fatOver > 10) {
                  lines.push(`🧈 Fat is over target by ${fatOver}g — steer clear of fried foods and high-fat dressings for the rest of the day.`);
                } else if (fatOver > 0) {
                  lines.push(`🧈 Fat is just over limit by ${fatOver}g — stay mindful of added oils and nuts.`);
                }

                // Calorie pacing
                if (calPct > 100) {
                  const over = calEaten - calGoal;
                  lines.push(`🔥 Calories are ${over} kcal over target — consider a lighter dinner or extra steps tonight.`);
                } else if (calLeft > 0 && calPct >= 90) {
                  lines.push(`🎯 Almost at your ${calGoal} kcal target — only ${calLeft} kcal remaining.`);
                } else if (calLeft > 600 && calPct < 60) {
                  lines.push(`📊 ${calLeft} kcal still available — don't undereat; fuel recovery with another balanced meal.`);
                }

                // Carbs surplus when fat is fine
                if (fatOver <= 0 && carbLeft < 0) {
                  lines.push(`🍞 Carbs are over by ${Math.abs(carbLeft)}g — swap starchy sides for vegetables in your next meal.`);
                }
              }

              const tip = lines.slice(0, 2).join('  ·  ');
              return (
                <View style={styles.aiBar}>
                  {activeCoachVoice ? (
                    <Image source={activeCoachVoice.avatar} style={styles.aiBarAvatar} />
                  ) : (
                    <Text style={styles.aiBarIcon}>🤖</Text>
                  )}
                  <Text style={styles.aiBarText}>{tip}</Text>
                </View>
              );
            })()}
            <Text style={styles.sectionLabel}>Daily Targets</Text>
            <View style={styles.card}>
              <MacroBar name="Calories" current={Math.round(totals.calories)} total={calGoal} color={accent} />
              <MacroBar name="Protein" current={Math.round(totals.protein)} total={proteinGoal} color={accent} />
              <MacroBar name="Carbohydrates" current={Math.round(totals.carbs)} total={carbsGoal} color={C.blue} />
              <MacroBar name="Fat" current={Math.round(totals.fat)} total={fatGoal} color={C.orange} />
            </View>
            <View style={styles.bmrtargetCard}>
              <Text style={[styles.bmrTargetLabel, { color: accent }]}>
                {profile?.dailyCalorieTarget ? 'Targets from your BMR assessment' : 'Estimated targets (update stats in Profile to personalise)'}
              </Text>
              <Text style={styles.bmrTargetMeta}>
                {calGoal} kcal · {proteinGoal}g P · {carbsGoal}g C · {fatGoal}g F
              </Text>
            </View>
          </>
        ) : null}

        {tab === 'plans' ? (
          <>
            <View style={styles.planHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionLabel}>Your AI Meal Plan</Text>
                <Text style={styles.planSubtitle}>
                  {calGoal} kcal · {proteinGoal}g protein · {profile?.dailyCalorieTarget ? 'from your BMR' : 'estimated from stats'}
                </Text>
              </View>
              <Pressable
                style={styles.refreshBtn}
                disabled={loadingPlan}
                onPress={async () => {
                  await AsyncStorage.removeItem(MEAL_PLAN_KEY);
                  setMealPlan(null);
                  await loadMealPlan();
                }}
              >
                <Text style={styles.refreshBtnText}>{loadingPlan ? '...' : '↺ Refresh'}</Text>
              </Pressable>
            </View>

              <View style={[styles.templatesCard, { borderColor: accentBorder }]}>
                <View style={styles.templatesHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.templatesTitle}>Meal Templates</Text>
                  <Text style={styles.templatesSub}>
                    Use these as simple plate-building guides whether you follow the AI plan or build meals manually.
                  </Text>
                </View>
                <View style={[styles.templatesPill, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
                  <Text style={[styles.templatesPillText, { color: accent }]}>Always On</Text>
                </View>
              </View>
              {mealTemplates.map((template) => (
                <View key={template.label} style={[styles.templateBlock, { borderColor: accentBorder }]}>
                  <View style={styles.templateBlockHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.templateLabel, { color: accent }]}>{template.label}</Text>
                      <Text style={styles.templateMealName}>
                        {template.mealName} · {template.timing}
                      </Text>
                    </View>
                  </View>
                  {template.build.map((line) => (
                    <View key={line} style={styles.templateBulletRow}>
                      <Text style={[styles.templateBullet, { color: accent }]}>•</Text>
                      <Text style={styles.templateBulletText}>{line}</Text>
                    </View>
                  ))}
                  <Text style={styles.templateCoachTip}>Coach tip: {template.coachTip}</Text>
                </View>
              ))}
            </View>

            {/* ── AI Coach input bar — edit or create plan ── */}
            {hasMealPlanAccess ? (
              <View style={[styles.coachEditBar, { borderColor: accentBorder, backgroundColor: accentSoft }]}>
                {activeCoachVoice ? (
                  <Image source={activeCoachVoice.avatar} style={styles.coachEditAvatar} />
                ) : (
                  <Text style={styles.coachEditIcon}>🤖</Text>
                )}
                <TextInput
                  style={styles.coachEditInput}
                  value={coachEditInput}
                  onChangeText={setCoachEditInput}
                  placeholder={
                    mealPlan
                      ? `Tell ${activeCoachVoice?.label ?? 'your coach'} what to change… (e.g. "more fish", "no dairy")`
                      : `Tell ${activeCoachVoice?.label ?? 'your coach'} what you want…`
                  }
                  placeholderTextColor={C.muted}
                  returnKeyType="send"
                  onSubmitEditing={() => coachEditPlan(coachEditInput).catch(() => null)}
                  editable={!coachEditLoading}
                />
                <Pressable
                  style={[styles.coachEditSendBtn, (!coachEditInput.trim() || coachEditLoading) ? { opacity: 0.4 } : null, { backgroundColor: accent }]}
                  onPress={() => coachEditPlan(coachEditInput).catch(() => null)}
                  disabled={!coachEditInput.trim() || coachEditLoading}
                >
                  {coachEditLoading
                    ? <ActivityIndicator size="small" color="#000" />
                    : <Text style={styles.coachEditSendText}>↑</Text>}
                </Pressable>
              </View>
            ) : null}

            {!hasMealPlanAccess && !proLoading ? (
              <>
                <View style={styles.manualMealPlanCard}>
                  <View style={styles.manualMealPlanHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.manualMealPlanEyebrow, { color: accent }]}>FREE MODE</Text>
                      <Text style={styles.manualMealPlanTitle}>Build Your Own Weekly Meal Plan</Text>
                      <Text style={styles.manualMealPlanBody}>
                        Add your repeatable meals here and we will save them as your weekly plan. Pro keeps this simple by replacing it with AI planning.
                      </Text>
                    </View>
                    <View style={styles.manualMealPlanPill}>
                      <Text style={styles.manualMealPlanPillText}>Manual</Text>
                    </View>
                  </View>
                  {manualMealDrafts.map((meal, index) => (
                    <View key={`${meal.time}-${index}`} style={styles.manualMealDraftRow}>
                      <Text style={styles.manualMealDraftLabel}>{meal.time}</Text>
                      <TextInput
                        style={styles.manualMealDraftInput}
                        value={meal.name}
                        onChangeText={(value) => updateManualMealDraft(index, 'name', value)}
                        placeholder={`${meal.time} idea`}
                        placeholderTextColor={C.muted}
                      />
                      <View style={styles.manualMealDraftMetaRow}>
                        <TextInput
                          style={[styles.manualMealDraftInput, styles.manualMealDraftMetaInput]}
                          value={meal.kcal}
                          onChangeText={(value) => updateManualMealDraft(index, 'kcal', value)}
                          keyboardType="numeric"
                          placeholder="kcal"
                          placeholderTextColor={C.muted}
                        />
                        <TextInput
                          style={[styles.manualMealDraftInput, styles.manualMealDraftMetaInput]}
                          value={meal.protein}
                          onChangeText={(value) => updateManualMealDraft(index, 'protein', value)}
                          keyboardType="numeric"
                          placeholder="protein"
                          placeholderTextColor={C.muted}
                        />
                      </View>
                    </View>
                  ))}
                  <Pressable style={[styles.btnPrimary, { backgroundColor: accent }]} onPress={() => saveManualMealPlan().catch(() => null)}>
                    <Text style={styles.btnPrimaryText}>Save Manual Meal Plan</Text>
                  </Pressable>
                </View>

                <View style={[styles.premiumGateCard, { borderColor: accentStrongBorder }]}>
                  <Text style={[styles.premiumGateEyebrow, { color: accent }]}>PREMIUM FEATURE</Text>
                  <Text style={styles.premiumGateTitle}>AI Meal Plans Are Part Of APEX Pro</Text>
                  <Text style={styles.premiumGateBody}>
                    Manual food logging and barcode scan stay free. Pro unlocks photo food scan, personalized 7-day meal plans, and stronger nutrition guidance.
                  </Text>
                  <View style={styles.premiumList}>
                    <Text style={styles.premiumListItem}>• Goal-based calories and macro aligned meals</Text>
                    <Text style={styles.premiumListItem}>• Food preferences and avoidances respected</Text>
                    <Text style={styles.premiumListItem}>• Weekly refreshes, photo scan, and sharper nutrition guidance</Text>
                  </View>
                  <Pressable
                    style={[styles.btnPrimary, { backgroundColor: accent }]}
                    onPress={async () => {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      await maybeShowPaywall(session?.user?.id).catch(() => null);
                      navigation.navigate('Upgrade');
                    }}
                  >
                    <Text style={styles.btnPrimaryText}>Unlock AI Meal Plans</Text>
                  </Pressable>
                </View>
              </>
            ) : !mealPlan && !loadingPlan && hasMealPlanAccess ? (
              <>
                <View style={styles.orDivider}>
                  <View style={styles.orLine} />
                  <Text style={styles.orText}>or</Text>
                  <View style={styles.orLine} />
                </View>
                <Pressable style={[styles.btnPrimary, { backgroundColor: accent }]} onPress={loadMealPlan}>
                  <Text style={styles.btnPrimaryText}>⚡ Auto-generate from BMR &amp; Goals</Text>
                </Pressable>
              </>
            ) : null}

            {loadingPlan && hasMealPlanAccess ? (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 32, gap: 12 }]}>
                <ActivityIndicator size="large" color={accent} />
                <Text style={styles.planSubtitle}>Building your personalised 7-day plan…</Text>
              </View>
            ) : null}

            {mealPlan ? (
              <>
                {/* ── Grocery List CTA — top of plan ── */}
                {loadingGrocery ? (
                  <View style={[styles.groceryCta, { justifyContent: 'center', alignItems: 'center', paddingVertical: 20, gap: 10 }]}>
                    <ActivityIndicator size="small" color={accent} />
                    <Text style={styles.groceryCtaSub}>Building your grocery list…</Text>
                  </View>
                ) : groceryList ? (
                  <Pressable
                    style={[styles.groceryCta, { borderColor: accentBorder }]}
                    onPress={() => setShowGrocery(true)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groceryCtaTitle}>🛒 Grocery List Ready</Text>
                      <Text style={styles.groceryCtaSub}>
                        {groceryList.items.length} items · Est. ${groceryList.totalEstimate.toFixed(2)}
                        {groceryList.nearbyStores && groceryList.nearbyStores.length > 0
                          ? `  ·  ${groceryList.nearbyStores.slice(0, 2).join(', ')}`
                          : ''}
                      </Text>
                    </View>
                    <Text style={{ color: accent, fontSize: 18 }}>›</Text>
                  </Pressable>
                ) : (
                  <>
                    {groceryError ? (
                      <View style={styles.groceryErrorCard}>
                        <Text style={styles.groceryErrorTitle}>⚠️ Grocery List Failed</Text>
                        <Text style={styles.groceryErrorBody} numberOfLines={3}>{groceryError}</Text>
                        <Pressable
                          style={styles.groceryErrorRetry}
                          onPress={() => { setGroceryError(null); generateGroceryList(mealPlan).catch(() => null); }}
                        >
                          <Text style={styles.groceryErrorRetryText}>Try Again →</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    <Pressable
                      style={[styles.groceryCta, { borderColor: accentBorder }]}
                      onPress={() => { setGroceryError(null); generateGroceryList(mealPlan).catch(() => null); }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groceryCtaTitle}>🛒 Generate Grocery List</Text>
                        <Text style={styles.groceryCtaSub}>Local store pricing · finds stores near you</Text>
                      </View>
                      <Text style={{ color: accent, fontSize: 18 }}>›</Text>
                    </Pressable>
                  </>
                )}

                {mealPlan.map((dayPlan) => (
                  <View key={dayPlan.day} style={[styles.planDayCard, { borderColor: accentBorder }]}>
                    <Text style={[styles.planDayTitle, { color: accent }]}>{dayPlan.day}</Text>
                    {dayPlan.meals.map((meal, i) => (
                      <View key={i} style={styles.planMealRow}>
                        <Text style={styles.planMealTime}>{meal.time}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.planMealName}>{meal.name}</Text>
                          <Text style={styles.planMealMeta}>{meal.kcal} kcal · {meal.protein}g protein</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ))}

                {mealPlanHistory.length > 0 ? (
                  <View style={[styles.card, { marginTop: 12, gap: 10 }]}>
                    <Text style={styles.planDayTitle}>Recent AI Plans</Text>
                    {mealPlanHistory.map((entry) => (
                      <Pressable
                        key={entry.id}
                        style={styles.historyPlanRow}
                        onPress={async () => {
                          await Haptics.selectionAsync();
                          setMealPlan(entry.plan);
                          await AsyncStorage.setItem(MEAL_PLAN_KEY, JSON.stringify(entry.plan)).catch(() => null);
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.historyPlanTitle}>{entry.label}</Text>
                          <Text style={styles.historyPlanMeta}>
                            {new Date(entry.generatedAt).toLocaleString()}
                          </Text>
                        </View>
                        <Text style={[styles.historyPlanAction, { color: accent }]}>Load ›</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {/* Regenerate plan button */}
                <Pressable
                  style={[styles.btnGhost, { marginTop: 8 }]}
                  onPress={async () => {
                    await AsyncStorage.multiRemove([MEAL_PLAN_KEY, GROCERY_LIST_KEY]).catch(() => null);
                    setMealPlan(null);
                    setGroceryList(null);
                    loadMealPlan().catch(() => null);
                  }}
                >
                  <Text style={styles.btnGhostText}>↺ Regenerate Plan</Text>
                </Pressable>
              </>
            ) : null}
          </>
        ) : null}

        {/* ── Grocery List Modal ── */}
        <Modal
          visible={showGrocery}
          animationType="slide"
          transparent
          onRequestClose={() => setShowGrocery(false)}
        >
          <View style={styles.groceryModal}>
            {/* Handle + header */}
            <View style={styles.groceryModalHandle} />
            <View style={styles.groceryModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.groceryModalTitle}>🛒 Grocery List</Text>
                <Text style={styles.groceryModalSub}>
                  {groceryList?.items.filter((i) => i.checked).length ?? 0} of {groceryList?.items.length ?? 0} checked
                </Text>
                {groceryList?.nearbyStores && groceryList.nearbyStores.length > 0 ? (
                  <Text style={[styles.groceryStoresSub, { color: accent }]}>
                    📍 {groceryList.nearbyStores.join(' · ')}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={() => setShowGrocery(false)} hitSlop={12}>
                <Text style={{ color: C.muted, fontSize: 22 }}>✕</Text>
              </Pressable>
            </View>

            {/* Budget input */}
            <View style={styles.budgetRow}>
              <Text style={styles.budgetLabel}>My Budget  $</Text>
              <TextInput
                style={styles.budgetInput}
                value={groceryBudget}
                onChangeText={saveBudget}
                placeholder="e.g. 120"
                placeholderTextColor={C.muted}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
              {groceryBudget && groceryList ? (
                <View style={[
                  styles.budgetStatus,
                  parseFloat(groceryBudget) >= groceryList.totalEstimate
                    ? { borderColor: accentBorder, backgroundColor: accentSoft }
                    : styles.budgetStatusOver,
                ]}>
                  <Text style={[
                    styles.budgetStatusText,
                    { color: parseFloat(groceryBudget) >= groceryList.totalEstimate ? accent : C.orange },
                  ]}>
                    {parseFloat(groceryBudget) >= groceryList.totalEstimate
                      ? `$${(parseFloat(groceryBudget) - groceryList.totalEstimate).toFixed(2)} under`
                      : `$${(groceryList.totalEstimate - parseFloat(groceryBudget)).toFixed(2)} over`}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Adjust to budget button — shown when over budget */}
            {groceryList && groceryBudget && parseFloat(groceryBudget) > 0 && groceryList.totalEstimate > parseFloat(groceryBudget) ? (
              <Pressable
                style={styles.trimBudgetBtn}
                onPress={() => handleTrimToBudget().catch(() => null)}
                disabled={trimmingBudget}
              >
                {trimmingBudget ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.trimBudgetBtnText}>⚡ Adjust List to ${parseFloat(groceryBudget).toFixed(0)} Budget</Text>
                )}
              </Pressable>
            ) : null}

            {/* Total estimate bar */}
            {groceryList ? (
              <View style={styles.groceryTotalBar}>
                <Text style={styles.groceryTotalLabel}>Estimated Total</Text>
                <Text style={[
                  styles.groceryTotalValue,
                  groceryBudget && groceryList.totalEstimate > parseFloat(groceryBudget)
                    ? { color: C.orange }
                    : { color: accent },
                ]}>
                  ${groceryList.totalEstimate.toFixed(2)}
                </Text>
              </View>
            ) : null}

            {/* ── Shopping tip banner ── */}
            {groceryList ? (
              <View style={[styles.groceryTipBanner, { borderColor: accentBorder }]}>
                <Text style={styles.groceryTipIcon}>💡</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.groceryTipTitle}>Use as your shopping checklist</Text>
                  <Text style={styles.groceryTipBody}>
                    Tap items to check them off as you shop in-store, or pull this up when placing a delivery order.
                  </Text>
                </View>
              </View>
            ) : null}

            {/* ── AI grocery assistant bar ── */}
            {groceryList ? (
              <View style={styles.groceryAiSection}>
                {!groceryAiBarOpen ? (
                  <Pressable
                    style={[styles.groceryAiToggleBtn, { backgroundColor: accentSoft, borderColor: accentBorder }]}
                    onPress={() => setGroceryAiBarOpen(true)}
                  >
                    <Text style={styles.groceryAiToggleIcon}>🤖</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groceryAiToggleTitle}>AI Shopping Assistant</Text>
                      <Text style={styles.groceryAiToggleSub}>Swap items, ask questions, edit the list</Text>
                    </View>
                    <Text style={{ color: accent, fontSize: 18 }}>›</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.groceryAiBar, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
                    <View style={styles.groceryAiBarHeader}>
                      <Text style={[styles.groceryAiBarTitle, { color: accent }]}>🤖 AI Assistant</Text>
                      <Pressable onPress={() => { setGroceryAiBarOpen(false); setGroceryAiInput(''); }} hitSlop={10}>
                        <Text style={{ color: C.muted, fontSize: 18 }}>✕</Text>
                      </Pressable>
                    </View>
                    <View style={styles.groceryAiInputRow}>
                      <TextInput
                        style={styles.groceryAiInput}
                        value={groceryAiInput}
                        onChangeText={setGroceryAiInput}
                        placeholder={'e.g. "shop at Trader Joe\'s instead" or "swap pork for salmon"'}
                        placeholderTextColor={C.muted}
                        returnKeyType="send"
                        onSubmitEditing={() => groceryAiEdit(groceryAiInput).catch(() => null)}
                        editable={!groceryAiLoading}
                        autoFocus
                        multiline
                      />
                      <Pressable
                        style={[styles.groceryAiSendBtn, (!groceryAiInput.trim() || groceryAiLoading) && { opacity: 0.4 }, { backgroundColor: accent }]}
                        onPress={() => groceryAiEdit(groceryAiInput).catch(() => null)}
                        disabled={!groceryAiInput.trim() || groceryAiLoading}
                      >
                        {groceryAiLoading
                          ? <ActivityIndicator size="small" color="#000" />
                          : <Text style={styles.groceryAiSendBtnText}>→</Text>
                        }
                      </Pressable>
                    </View>
                    <Text style={styles.groceryAiHint}>Try: "swap chicken for turkey" · "shop at Whole Foods instead" · "add Greek yogurt" · "keep it under $100"</Text>
                  </View>
                )}
              </View>
            ) : null}

            {/* Items by category */}
            <FlatList
              data={
                groceryList
                  ? (
                    Object.entries(
                      groceryList.items.reduce<Record<string, GroceryItem[]>>((acc, item) => {
                        (acc[item.category] = acc[item.category] ?? []).push(item);
                        return acc;
                      }, {}),
                    ) as [string, GroceryItem[]][]
                  )
                  : []
              }
              keyExtractor={([cat]) => cat}
              contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}
              renderItem={({ item: [category, items] }) => (
                <View style={styles.groceryCategorySection}>
                  <Text style={[styles.groceryCategoryTitle, { color: accent }]}>{category}</Text>
                  {items.map((gItem) => (
                    <Pressable
                      key={gItem.id}
                      style={styles.groceryItemRow}
                      onPress={() => toggleGroceryItem(gItem.id)}
                    >
                      <View style={[styles.groceryCheckbox, gItem.checked ? [styles.groceryCheckboxChecked, { backgroundColor: accent, borderColor: accent }] : null]}>
                        {gItem.checked ? <Text style={{ color: '#000', fontSize: 11, fontFamily: 'DMSans_700Bold' }}>✓</Text> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.groceryItemName, gItem.checked ? styles.groceryItemNameDone : null]}>
                          {gItem.name}
                        </Text>
                        <Text style={styles.groceryItemQty}>{gItem.quantity}</Text>
                      </View>
                      <Text style={[styles.groceryItemPrice, gItem.checked ? { color: C.muted } : null]}>
                        ${gItem.estimatedPrice.toFixed(2)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            />
          </View>
        </Modal>

        {/* ── ZIP Code prompt modal ── */}
        <Modal
          visible={zipPromptVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setZipPromptVisible(false)}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            {/* Tap-to-dismiss backdrop */}
            <Pressable style={styles.zipOverlay} onPress={() => setZipPromptVisible(false)} />
            <View style={styles.zipSheet}>
              <View style={styles.zipHandle} />
              <Text style={styles.zipTitle}>📍 Where are you shopping?</Text>
              <Text style={styles.zipBody}>
                Enter your ZIP or postal code so we can find local store prices and nearby grocery chains for your list.
              </Text>
              <TextInput
                style={styles.zipInput}
                value={zipDraft}
                onChangeText={setZipDraft}
                placeholder="e.g. 90210"
                placeholderTextColor={C.muted}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (!zipDraft.trim()) return;
                  setZipPromptVisible(false);
                  if (pendingGroceryPlan) {
                    generateGroceryList(pendingGroceryPlan, zipDraft.trim()).catch(() => null);
                    setPendingGroceryPlan(null);
                  }
                }}
              />
              <Pressable
                style={[styles.btnPrimary, !zipDraft.trim() ? { opacity: 0.4 } : null, { backgroundColor: accent }]}
                disabled={!zipDraft.trim()}
                onPress={() => {
                  setZipPromptVisible(false);
                  if (pendingGroceryPlan) {
                    generateGroceryList(pendingGroceryPlan, zipDraft.trim()).catch(() => null);
                    setPendingGroceryPlan(null);
                  }
                }}
              >
                <Text style={styles.btnPrimaryText}>Generate Local Grocery List →</Text>
              </Pressable>
              <Pressable
                style={{ marginTop: 10, alignItems: 'center' }}
                onPress={() => {
                  setZipPromptVisible(false);
                  if (pendingGroceryPlan) {
                    generateGroceryList(pendingGroceryPlan, 'United States').catch(() => null);
                    setPendingGroceryPlan(null);
                  }
                }}
              >
                <Text style={styles.zipSkipText}>Skip — use average US prices</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {tab === 'water' ? (
          <>
            {/* Unit toggle */}
            <View style={styles.waterUnitRow}>
              <Text style={styles.waterUnitLabel}>Display in</Text>
              <Pressable
                style={[styles.unitChip, waterUnit === 'oz' ? [styles.unitChipActive, { borderColor: accentStrongBorder, backgroundColor: accentSoft }] : null]}
                onPress={() => setWaterUnit('oz')}
              >
                <Text style={[styles.unitChipText, waterUnit === 'oz' ? { color: accent } : null]}>oz</Text>
              </Pressable>
              <Pressable
                style={[styles.unitChip, waterUnit === 'ml' ? [styles.unitChipActive, { borderColor: accentStrongBorder, backgroundColor: accentSoft }] : null]}
                onPress={() => setWaterUnit('ml')}
              >
                <Text style={[styles.unitChipText, waterUnit === 'ml' ? { color: C.blue } : null]}>ml</Text>
              </Pressable>
            </View>

            <View style={[styles.card, { alignItems: 'center', paddingVertical: 28 }]}>
              <Text style={styles.waterEmoji}>💧</Text>
              {waterUnit === 'oz' ? (
                <>
                  <Text style={styles.waterVal}>{waterOz} <Text style={styles.waterUnit}>oz</Text></Text>
                  <Text style={styles.waterSub}>of {waterGoal} oz daily goal · {Math.round((waterOz / waterGoal) * 100)}%</Text>
                </>
              ) : (
                <>
                  <Text style={styles.waterVal}>{Math.round(waterOz * 29.574)} <Text style={styles.waterUnit}>ml</Text></Text>
                  <Text style={styles.waterSub}>of {Math.round(waterGoal * 29.574)} ml daily goal · {Math.round((waterOz / waterGoal) * 100)}%</Text>
                </>
              )}
              <View style={[styles.barTrack, { width: '100%', marginBottom: 24, marginTop: 12, height: 10, borderRadius: 5 }]}>
                <View style={[styles.barFill, { width: `${Math.min((waterOz / waterGoal) * 100, 100)}%`, backgroundColor: C.blue, borderRadius: 5 }]} />
              </View>

              {/* Quick-add buttons */}
              <View style={styles.waterButtonRow}>
                {waterUnit === 'oz' ? (
                  <>
                    <Pressable style={styles.btnGhost} onPress={() => handleAddWater(8)}>
                      <Text style={styles.btnGhostText}>+ 8 oz</Text>
                    </Pressable>
                    <Pressable style={styles.btnGhost} onPress={() => handleAddWater(16)}>
                      <Text style={styles.btnGhostText}>+ 16 oz</Text>
                    </Pressable>
                    <Pressable style={[styles.btnPrimary, { backgroundColor: accent }]} onPress={() => handleAddWater(24)}>
                      <Text style={styles.btnPrimaryText}>+ 24 oz</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable style={styles.btnGhost} onPress={() => handleAddWater(Math.round(250 / 29.574))}>
                      <Text style={styles.btnGhostText}>+ 250 ml</Text>
                    </Pressable>
                    <Pressable style={styles.btnGhost} onPress={() => handleAddWater(Math.round(500 / 29.574))}>
                      <Text style={styles.btnGhostText}>+ 500 ml</Text>
                    </Pressable>
                    <Pressable style={[styles.btnPrimary, { backgroundColor: accent }]} onPress={() => handleAddWater(Math.round(750 / 29.574))}>
                      <Text style={styles.btnPrimaryText}>+ 750 ml</Text>
                    </Pressable>
                  </>
                )}
              </View>

              <Pressable style={[styles.btnGhost, { marginTop: 10, alignSelf: 'center' }]} onPress={handleResetWater}>
                <Text style={styles.btnGhostText}>Reset Today</Text>
              </Pressable>
            </View>

            {/* Hydration tips */}
            <View style={styles.card}>
              <Text style={styles.waterTipTitle}>💡 Hydration Tips</Text>
              <Text style={styles.waterTipBody}>Drink a glass first thing in the morning. Aim for 1 cup per hour during workouts. Pale yellow urine = well hydrated.</Text>
              {profile?.weightLbs ? (
                <Text style={[styles.waterTipBody, { marginTop: 6, color: accent }]}>
                  Your goal ({waterGoal} oz / {Math.round(waterGoal * 29.574)} ml) is based on your body weight of {profile.weightLbs} lbs.
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={onTheGoVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setOnTheGoVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.zipOverlay} onPress={() => setOnTheGoVisible(false)} />
          <View style={styles.onTheGoSheet}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.onTheGoSheetContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.zipHandle} />
              <View style={styles.onTheGoSheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.onTheGoSheetTitle}>🥗 On the Go Food Finder</Text>
                  <Text style={styles.onTheGoSheetBody}>
                    We are preparing nearby healthy food picks around your area so you can grab something fast without guessing.
                  </Text>
                </View>
                <Pressable onPress={() => setOnTheGoVisible(false)} hitSlop={12}>
                  <Text style={styles.onTheGoSheetClose}>✕</Text>
                </Pressable>
              </View>

              <View style={[styles.onTheGoStatusCard, { borderColor: accentBorder, backgroundColor: accentSoft }]}>
                <Text style={[styles.onTheGoStatusEyebrow, { color: accent }]}>AREA READY</Text>
                <Text style={styles.onTheGoStatusTitle}>
                  {onTheGoZipCode ? `Searching around ${onTheGoZipCode}` : 'Add your area to prep nearby picks'}
                </Text>
                <Text style={styles.onTheGoStatusBody}>
                  {onTheGoSource === 'current_location'
                    ? 'Using your current location.'
                    : onTheGoSource === 'saved_zip' && onTheGoZipCode
                      ? 'Using the ZIP saved to your profile.'
                      : 'You can use your saved ZIP, type a new one, or let the app detect your current area.'}
                </Text>
              </View>

              <View style={styles.onTheGoActionRow}>
              <Pressable
                style={[styles.onTheGoPrimaryBtn, { backgroundColor: accent }]}
                onPress={handleUseCurrentLocationForOnTheGo}
                disabled={onTheGoLocating}
              >
                  {onTheGoLocating ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.onTheGoPrimaryBtnText}>Use Current Location</Text>
                  )}
              </Pressable>
              <Pressable
                style={[
                  styles.onTheGoGhostBtn,
                  (profile?.zipCode?.trim() || onTheGoZipCode.trim() || onTheGoZipDraft.trim()) ? null : styles.onTheGoGhostBtnDisabled,
                ]}
                onPress={() => handleUseSavedZipForOnTheGo().catch(() => null)}
              >
                <Text style={styles.onTheGoGhostBtnText}>Use Saved ZIP</Text>
              </Pressable>
            </View>

              <TextInput
                style={styles.zipInput}
                value={onTheGoZipDraft}
                onChangeText={setOnTheGoZipDraft}
                placeholder="Type ZIP code"
                placeholderTextColor={C.muted}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />

              <View style={styles.onTheGoActionRow}>
                <Pressable
                  style={[styles.onTheGoPrimaryBtn, !onTheGoZipDraft.trim() ? { opacity: 0.45 } : null, { backgroundColor: accent }]}
                  onPress={() => handleSaveOnTheGoZip().catch(() => null)}
                  disabled={!onTheGoZipDraft.trim()}
                >
                  <Text style={styles.onTheGoPrimaryBtnText}>Save ZIP</Text>
                </Pressable>
              <Pressable
                style={styles.onTheGoGhostBtn}
                onPress={() => {
                  setOnTheGoVisible(false);
                  Alert.alert('Edit ZIP in Profile', 'Open Profile, tap Edit Stats, then use the ZIP / Postal Code field.');
                  navigation.navigate('Profile');
                }}
              >
                <Text style={styles.onTheGoGhostBtnText}>Edit ZIP in Profile</Text>
              </Pressable>
            </View>

            <View style={styles.onTheGoSuggestionsWrap}>
              <View style={styles.onTheGoSuggestionsHeader}>
                <Text style={styles.sectionLabel}>Quick Picks We Can Build Around</Text>
                <Pressable style={styles.onTheGoMoreBtn} onPress={() => lookForMoreOnTheGoPlaces().catch(() => null)}>
                  <Text style={[styles.onTheGoMoreBtnText, { color: accent }]}>Look for More ↻</Text>
                </Pressable>
              </View>
              {onTheGoLoadingLive ? (
                <Text style={styles.onTheGoLoadingText}>Checking live nearby place details...</Text>
              ) : null}
              {(onTheGoLiveSuggestions.length > 0 ? onTheGoLiveSuggestions : onTheGoSuggestions).map((option) => (
                <View key={option.id} style={styles.onTheGoSuggestionCard}>
                  <View style={styles.onTheGoSuggestionHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.onTheGoSuggestionTitle}>{option.title}</Text>
                      <Text style={styles.onTheGoSuggestionVenue}>{option.venue} · {option.placeType}</Text>
                      <Text style={styles.onTheGoSuggestionVenue}>{option.addressHint}</Text>
                      {option.ratingText ? <Text style={styles.onTheGoSuggestionRating}>{option.ratingText}</Text> : null}
                    </View>
                    <View style={styles.onTheGoSuggestionActionsTop}>
                      <Pressable
                        style={[styles.onTheGoFavoriteBtn, favoriteOnTheGoIds.includes(option.id) ? { borderColor: accent, backgroundColor: accentSoft } : null]}
                        onPress={() => toggleFavoriteOnTheGo(option.id).catch(() => null)}
                      >
                        <Text style={styles.onTheGoFavoriteBtnText}>{favoriteOnTheGoIds.includes(option.id) ? '★' : '☆'}</Text>
                      </Pressable>
                      <View style={[styles.onTheGoSuggestionPill, { borderColor: accentBorder, backgroundColor: accentSoft }]}>
                        <Text style={[styles.onTheGoSuggestionPillText, { color: accent }]}>{option.bestFor}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.onTheGoSuggestionMacros}>{option.macros}</Text>
                  <Text style={styles.onTheGoSuggestionCoach}>{option.coachNote}</Text>
                  <View style={styles.onTheGoLinkRow}>
                    <Pressable style={styles.onTheGoLinkBtn} onPress={() => openOnTheGoDirections(option).catch(() => null)}>
                      <Text style={[styles.onTheGoLinkBtnText, { color: accent }]}>Directions</Text>
                    </Pressable>
                    <Pressable style={styles.onTheGoLinkBtn} onPress={() => openOnTheGoWebsite(option).catch(() => null)}>
                      <Text style={[styles.onTheGoLinkBtnText, { color: accent }]}>Website</Text>
                    </Pressable>
                    <Pressable style={styles.onTheGoLinkBtn} onPress={() => openOnTheGoReviews(option).catch(() => null)}>
                      <Text style={[styles.onTheGoLinkBtnText, { color: accent }]}>Reviews</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>

              <Text style={styles.onTheGoComingSoon}>
                Saved ZIPs, current-location lookup, favorites, and coach-guided quick picks are live. Add a Google Places key to enrich these cards with live venue details and links automatically.
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <FoodScanModal
        visible={scanVisible}
        onClose={() => setScanVisible(false)}
        onResult={handleScanResult}
        scanContext={{
          caloriesRemaining: calGoal - totals.calories,
          carbsRemaining: carbsGoal - totals.carbs,
          fatRemaining: fatGoal - totals.fat,
          goal: profile?.goal,
          proteinRemaining: proteinGoal - totals.protein,
        }}
      />
      <VideoPlayerModal
        visible={!!selectedRecipeVideo}
        youtubeId={selectedRecipeVideo?.id ?? ''}
        title={selectedRecipeVideo?.title ?? 'Quick Recipe'}
        onClose={() => setSelectedRecipeVideo(null)}
        actionLabel={`Ask ${activeCoachVoice?.label ?? 'your coach'} to Use This Recipe`}
        actionLoading={recipeCoachLoading}
        actionTint={accent}
        onAction={selectedRecipeVideo ? promptRecipeCoachAction : undefined}
      />
      <MealDetailModal
        accent={accent}
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />
      <Modal visible={servingsModalVisible} transparent animationType="fade" onRequestClose={() => setServingsModalVisible(false)}>
        <View style={styles.modalOverlayCenter}>
          <View style={styles.servingsModal}>
            <Text style={styles.modalTitle}>How many servings?</Text>
            <Text style={styles.servingsSub}>
              We found {pendingBarcodeFood?.name ?? 'this product'}. Choose servings before saving or editing.
            </Text>
            <Text style={styles.formLabel}>Servings</Text>
            <TextInput
              style={[styles.formInput, { marginBottom: 16 }]}
              keyboardType="numeric"
              value={barcodeServings}
              onChangeText={setBarcodeServings}
              placeholder="1"
              placeholderTextColor={C.muted}
            />
            <View style={styles.modalBtns}>
              <Pressable
                style={styles.btnGhost}
                onPress={() => {
                  setServingsModalVisible(false);
                  setPendingBarcodeFood(null);
                }}
              >
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.btnGhost}
                onPress={() => {
                  const servings = Math.max(1, Number(barcodeServings || 1));
                  if (pendingBarcodeFood) {
                    applyFoodToManualEditor(pendingBarcodeFood, servings);
                  }
                  setServingsModalVisible(false);
                  setPendingBarcodeFood(null);
                }}
              >
                <Text style={styles.btnGhostText}>Edit first</Text>
              </Pressable>
              <Pressable
                style={[styles.btnPrimary, { flex: 1.4, backgroundColor: accent }]}
                onPress={async () => {
                  const servings = Math.max(1, Number(barcodeServings || 1));
                  if (pendingBarcodeFood) {
                    await saveScannedFood(pendingBarcodeFood, servings);
                  }
                  setServingsModalVisible(false);
                  setPendingBarcodeFood(null);
                }}
              >
                <Text style={styles.btnPrimaryText}>Add to Diary</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Hidden meal share card — image capture so Instagram/TikTok/Facebook show in share sheet */}
      <View style={{ position: 'absolute', left: -9999, top: 0 }} pointerEvents="none">
        <ViewShot
          ref={mealShareRef}
          options={{ format: 'png', quality: 1, width: MEAL_CARD_W, height: MEAL_CARD_H }}
        >
          {mealShareData ? (
            <MealShareCard {...mealShareData} />
          ) : (
            <View style={{ width: MEAL_CARD_W, height: MEAL_CARD_H }} />
          )}
        </ViewShot>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  scroll: { flex: 1 },
  content: { padding: 14, paddingBottom: 32 },
  sectionLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 10,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.black,
  },
  tabBtn: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabBtnActive: { borderColor: C.border, backgroundColor: C.dark },
  tabBtnText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_500Medium' },
  tabBtnTextActive: { color: C.green },
  proPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: C.orangeSoft,
    borderWidth: 1,
    borderColor: C.orangeBorder,
  },
  proPillText: {
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 8,
    letterSpacing: 0.8,
  },
  aiBar: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  aiBarAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'transparent',
    marginTop: 1,
    flexShrink: 0,
  },
  aiBarIcon: { fontSize: 16, marginTop: 1, flexShrink: 0 },
  aiBarText: { flex: 1, fontSize: 12.5, lineHeight: 20, color: '#bbb', fontFamily: 'DMSans_400Regular' },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 14 },
  calorieHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  calorieSummaryRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  calorieSummaryCol: { flex: 1, alignItems: 'center' },
  calNum: { fontFamily: 'BebasNeue_400Regular', fontSize: 22, color: C.green },
  calLabel: { fontSize: 10, color: C.muted, fontFamily: 'SpaceMono_400Regular' },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  macroName: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },
  macroGrams: { fontSize: 11, color: C.muted, fontFamily: 'SpaceMono_400Regular' },
  barTrack: { height: 5, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 12 },
  barFill: { height: '100%', borderRadius: 3 },
  scanRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  scanBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
  },
  scanBtnIcon: { fontSize: 18 },
  scanBtnText: { color: C.green, fontFamily: 'DMSans_500Medium', fontSize: 13 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    color: C.text,
    paddingHorizontal: 16,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },
  searchButton: {
    minWidth: 110,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  searchButtonText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 12 },
  manualRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  metricInput: {
    width: '48%',
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    color: C.text,
    paddingHorizontal: 12,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },
  saveManualButton: {
    minHeight: 44,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  saveManualButtonText: { color: C.green, fontFamily: 'DMSans_500Medium', fontSize: 13 },
  resultList: { gap: 8, marginBottom: 12 },
  searchItem: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
  },
  itemTitle: { fontSize: 13, color: C.text, fontFamily: 'DMSans_500Medium' },
  itemMeta: { fontSize: 11, color: C.muted, marginTop: 3, fontFamily: 'DMSans_400Regular' },
  foodItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 11,
    marginBottom: 6,
  },
  foodName: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },
  foodServing: { fontSize: 11, color: C.muted, marginTop: 1, fontFamily: 'DMSans_400Regular' },
  foodCal: { fontSize: 12, color: C.green, fontFamily: 'SpaceMono_400Regular' },
  mealDetailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
    marginBottom: 18,
  },
  mealDetailCell: {
    width: '47%',
    minHeight: 74,
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  mealDetailValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    letterSpacing: 0.6,
  },
  mealDetailLabel: {
    marginTop: 4,
    fontSize: 10,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    fontFamily: 'SpaceMono_400Regular',
  },
  emptyMeal: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  emptyMealText: { color: C.muted, fontSize: 13, fontFamily: 'DMSans_400Regular' },
  recipeCard: {
    width: 160,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  recipeThumb: {
    width: 160,
    height: 90,
    backgroundColor: C.card,
  },
  recipeInfo: {
    padding: 8,
    gap: 3,
  },
  recipeTitle: {
    color: C.text,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
  },
  recipeChannel: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
  },
  progCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
    flexDirection: 'row',
  },
  progThumb: { width: 70, alignItems: 'center', justifyContent: 'center' },
  progBody: { flex: 1, padding: 12 },
  progName: { fontSize: 14, color: C.text, fontFamily: 'DMSans_500Medium', marginBottom: 3 },
  progMeta: { fontSize: 11, color: C.muted, fontFamily: 'SpaceMono_400Regular' },
  progTag: { fontSize: 10, color: C.green, marginTop: 5, fontFamily: 'SpaceMono_400Regular' },
  waterEmoji: { fontSize: 64, marginBottom: 12 },
  waterVal: { fontFamily: 'BebasNeue_400Regular', fontSize: 56, color: C.blue, lineHeight: 60 },
  waterUnit: { fontSize: 22, color: C.muted },
  waterSub: { color: C.muted, fontSize: 13, marginVertical: 8, fontFamily: 'DMSans_400Regular' },
  waterButtonRow: { flexDirection: 'row', gap: 8 },
  btnPrimary: {
    backgroundColor: C.green,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 12 },
  btnGhost: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  btnGhostText: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalOverlayCenter: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    paddingBottom: 32,
  },
  modalHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontFamily: 'BebasNeue_400Regular', fontSize: 22, letterSpacing: 2, color: C.text, marginBottom: 16 },
  servingsModal: {
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
  },
  servingsSub: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'DMSans_400Regular',
    marginBottom: 14,
  },
  formLabel: { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'SpaceMono_400Regular', marginBottom: 5 },
  formInput: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
  },
  modalBtns: { flexDirection: 'row', gap: 8 },
  // Hydration tracker
  waterUnitRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  waterUnitLabel: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', flex: 1 },
  unitChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  unitChipActive: { borderColor: C.greenStrongBorder, backgroundColor: C.greenSoft },
  unitChipText: { fontSize: 12, color: C.muted, fontFamily: 'SpaceMono_400Regular' },
  waterTipTitle: { fontSize: 13, color: C.text, fontFamily: 'DMSans_500Medium', marginBottom: 6 },
  waterTipBody: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 19 },
  // BMR targets note
  bmrtargetCard: {
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  bmrTargetLabel: { fontSize: 11, color: C.green, fontFamily: 'SpaceMono_400Regular', marginBottom: 2 },
  bmrTargetMeta: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },
  // Meal plan
  planHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  planSubtitle: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  coachEditBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 8,
  },
  coachEditAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'transparent',
  },
  coachEditIcon: { fontSize: 16 },
  coachEditInput: {
    flex: 1,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    paddingVertical: 4,
  },
  coachEditSendBtn: {
    backgroundColor: C.green,
    borderRadius: 20,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachEditSendText: {
    color: '#000',
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    lineHeight: 20,
  },
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 10,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.border,
  },
  orText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },
  manualMealPlanCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  manualMealPlanHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  manualMealPlanEyebrow: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 8,
  },
  manualMealPlanTitle: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 18,
  },
  manualMealPlanBody: {
    marginTop: 4,
    color: C.muted,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'DMSans_400Regular',
  },
  manualMealPlanPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.dark,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  manualMealPlanPillText: {
    color: C.text,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 0.8,
  },
  manualMealDraftRow: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  manualMealDraftLabel: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  manualMealDraftInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    color: C.text,
    paddingHorizontal: 12,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },
  manualMealDraftMetaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  manualMealDraftMetaInput: {
    flex: 1,
  },
  premiumGateCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
  },
  premiumGateEyebrow: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 8,
  },
  premiumGateTitle: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 28,
    lineHeight: 30,
    letterSpacing: 1.2,
  },
  premiumGateBody: {
    marginTop: 10,
    color: C.muted,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'DMSans_400Regular',
  },
  premiumList: {
    gap: 8,
    marginTop: 14,
    marginBottom: 16,
  },
  premiumListItem: {
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'DMSans_400Regular',
  },
  templatesCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  templatesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  templatesTitle: {
    fontSize: 18,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
  },
  templatesSub: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 18,
    marginTop: 4,
  },
  templatesPill: {
    backgroundColor: 'rgba(0,255,135,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.3)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  templatesPillText: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  templateBlock: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  templateBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  templateLabel: {
    fontSize: 13,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  templateMealName: {
    fontSize: 14,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    marginTop: 4,
  },
  templateBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  templateBullet: {
    color: C.green,
    fontSize: 15,
    lineHeight: 18,
  },
  templateBulletText: {
    flex: 1,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12.5,
    lineHeight: 18,
  },
  templateCoachTip: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  refreshBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: C.card,
  },
  refreshBtnText: { fontSize: 11, color: C.muted, fontFamily: 'SpaceMono_400Regular' },
  planDayCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  planDayTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: C.green,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  planMealRow: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  planMealTime: { fontSize: 9, color: C.muted, fontFamily: 'SpaceMono_400Regular', width: 50, paddingTop: 2 },
  planMealName: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },
  planMealMeta: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 1 },
  historyPlanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  historyPlanTitle: {
    color: C.text,
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
  },
  historyPlanMeta: {
    color: C.muted,
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'SpaceMono_400Regular',
  },
  historyPlanAction: {
    color: C.green,
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
  },

  // ── Grocery List ──────────────────────────────────────────────────────────
  groceryErrorCard: {
    backgroundColor: 'rgba(255,107,53,0.08)',
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  groceryErrorTitle: {
    color: C.orange,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
  },
  groceryErrorBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  groceryErrorRetry: {
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  groceryErrorRetryText: {
    color: C.orange,
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
  },
  groceryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    marginBottom: 8,
    gap: 12,
  },
  groceryCtaTitle: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold' },
  groceryCtaSub: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 3, flexWrap: 'wrap' },

  // Modal
  groceryModal: {
    flex: 1,
    backgroundColor: C.black,
    marginTop: 60,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
  },
  groceryModalHandle: {
    width: 36,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  groceryModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  groceryModalTitle: { fontSize: 18, color: C.text, fontFamily: 'DMSans_700Bold' },
  groceryModalSub: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  groceryStoresSub: { fontSize: 11, color: C.green, fontFamily: 'DMSans_400Regular', marginTop: 4 },
  groceryTipBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
  },
  groceryTipIcon: { fontSize: 18, marginTop: 1 },
  groceryTipTitle: { fontSize: 13, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 2 },
  groceryTipBody: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 17 },

  // AI assistant bar
  groceryAiSection: { marginHorizontal: 16, marginTop: 10, marginBottom: 2 },
  groceryAiToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,255,136,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.25)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  groceryAiToggleIcon: { fontSize: 20 },
  groceryAiToggleTitle: { fontSize: 13, color: C.text, fontFamily: 'DMSans_700Bold' },
  groceryAiToggleSub: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 1 },
  groceryAiBar: {
    backgroundColor: 'rgba(0,255,136,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.25)',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  groceryAiBarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groceryAiBarTitle: { fontSize: 13, color: C.green, fontFamily: 'DMSans_700Bold' },
  groceryAiInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  groceryAiInput: {
    flex: 1,
    backgroundColor: C.dark,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    minHeight: 44,
    maxHeight: 100,
  },
  groceryAiSendBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groceryAiSendBtnText: { color: '#000', fontSize: 20, fontFamily: 'DMSans_700Bold' },
  groceryAiHint: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 15 },

  onTheGoCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  onTheGoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  onTheGoEyebrow: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 6,
  },
  onTheGoTitle: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 18,
  },
  onTheGoBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  onTheGoCoachAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  onTheGoEmoji: {
    fontSize: 28,
    marginTop: 4,
  },
  onTheGoTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  onTheGoTag: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  onTheGoTagText: {
    color: C.text,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  onTheGoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  onTheGoFooterText: {
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
  },
  onTheGoFooterAction: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 12,
  },
  onTheGoSheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: C.border,
    maxHeight: '88%',
  },
  onTheGoSheetContent: {
    padding: 22,
    paddingBottom: 36,
    gap: 14,
  },
  onTheGoSheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  onTheGoSheetTitle: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 28,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  onTheGoSheetBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
  onTheGoSheetClose: {
    color: C.muted,
    fontSize: 22,
  },
  onTheGoStatusCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  onTheGoStatusEyebrow: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.3,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 6,
  },
  onTheGoStatusTitle: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 16,
  },
  onTheGoStatusBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  onTheGoActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  onTheGoPrimaryBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  onTheGoPrimaryBtnText: {
    color: '#000',
    fontFamily: 'DMSans_700Bold',
    fontSize: 13,
  },
  onTheGoGhostBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.dark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  onTheGoGhostBtnDisabled: {
    opacity: 0.5,
  },
  onTheGoGhostBtnText: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
  },
  onTheGoSuggestionsWrap: {
    gap: 10,
  },
  onTheGoSuggestionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  onTheGoMoreBtn: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  onTheGoMoreBtnText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 12,
  },
  onTheGoSuggestionCard: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    gap: 7,
  },
  onTheGoSuggestionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  onTheGoSuggestionActionsTop: {
    alignItems: 'flex-end',
    gap: 8,
  },
  onTheGoSuggestionTitle: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
  },
  onTheGoSuggestionVenue: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
  onTheGoSuggestionRating: {
    color: C.green,
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    marginTop: 4,
  },
  onTheGoSuggestionPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  onTheGoSuggestionPillText: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 0.5,
  },
  onTheGoFavoriteBtn: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onTheGoFavoriteBtnText: {
    color: C.text,
    fontSize: 18,
    lineHeight: 20,
  },
  onTheGoSuggestionMacros: {
    color: C.text,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 0.4,
  },
  onTheGoSuggestionCoach: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12.5,
    lineHeight: 18,
  },
  onTheGoLinkRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  onTheGoLinkBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  onTheGoLinkBtnText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
  },
  onTheGoLoadingText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    marginBottom: 8,
  },
  onTheGoComingSoon: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },

  // ── ZIP prompt modal ──
  zipOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  zipSheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  zipHandle: {
    width: 40,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  zipTitle: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 26,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  zipBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
  },
  zipInput: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    marginBottom: 14,
    letterSpacing: 1,
  },
  zipSkipText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    paddingVertical: 6,
  },

  // Budget row
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  budgetLabel: { fontSize: 13, color: C.text, fontFamily: 'DMSans_500Medium' },
  budgetInput: {
    flex: 1,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
  },
  budgetStatus: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  budgetStatusGood: { borderColor: C.greenBorder, backgroundColor: C.greenSoft },
  budgetStatusOver: { borderColor: '#ff6b35', backgroundColor: 'rgba(255,107,53,0.1)' },
  budgetStatusText: { fontSize: 12, fontFamily: 'DMSans_700Bold' },

  // Trim to budget button
  trimBudgetBtn: {
    backgroundColor: C.orange,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  trimBudgetBtnText: {
    color: '#000',
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
  },

  // Total bar
  groceryTotalBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  groceryTotalLabel: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular' },
  groceryTotalValue: { fontSize: 18, color: C.green, fontFamily: 'DMSans_700Bold' },

  // Category sections
  groceryCategorySection: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    gap: 2,
  },
  groceryCategoryTitle: {
    fontSize: 10,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  groceryItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.border + '55',
  },
  groceryCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  groceryCheckboxChecked: {
    backgroundColor: C.green,
    borderColor: C.green,
  },
  groceryItemName: { fontSize: 14, color: C.text, fontFamily: 'DMSans_400Regular' },
  groceryItemNameDone: { textDecorationLine: 'line-through', color: C.muted },
  groceryItemQty: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 1 },
  groceryItemPrice: { fontSize: 14, color: C.text, fontFamily: 'DMSans_700Bold', flexShrink: 0 },
});

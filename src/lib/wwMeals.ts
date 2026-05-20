/**
 * wwMeals.ts
 *
 * Walk & Water Challenge Edition — meal library.
 * 3 categories × 5 options each = 15 total meal cards.
 * Users see 1 card per category at a time and can refresh
 * to cycle through the pool.
 *
 * imageUrl: Supabase Storage public URLs — one bucket per meal.
 */

export type WWMacros = {
  calories: number;
  protein:  number; // grams
  carbs:    number; // grams
  fat:      number; // grams
};

export type WWMeal = {
  id:           string;
  category:     'breakfast' | 'lunch' | 'dinner';
  name:         string;
  tagline:      string;
  macros:       WWMacros;
  ingredients:  string[];
  instructions: string[];
  imageUrl:     string; // swap with Supabase Storage URL
};

// ─── Breakfast (5 options) ────────────────────────────────────────────────────

const BREAKFAST: WWMeal[] = [
  {
    id:       'breakfast-1',
    category: 'breakfast',
    name:     'Egg & Veggie Scramble',
    tagline:  'High-protein start that keeps you full until lunch.',
    macros:   { calories: 350, protein: 28, carbs: 18, fat: 19 },
    ingredients: [
      '3 large eggs',
      '½ cup bell peppers, diced',
      '¼ cup spinach',
      '¼ cup cherry tomatoes, halved',
      '1 tbsp olive oil',
      'Salt, pepper, garlic powder',
    ],
    instructions: [
      'Heat olive oil in a non-stick pan over medium heat.',
      'Add bell peppers and cook 2 minutes until slightly soft.',
      'Add spinach and tomatoes, stir for 1 minute.',
      'Whisk eggs with salt, pepper, and garlic powder.',
      'Pour eggs over the vegetables and scramble until just set.',
      'Serve immediately.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Egg%20&%20Veggie%20Scramble/Egg%20&%20Veggie%20Scramble.png',
  },
  {
    id:       'breakfast-2',
    category: 'breakfast',
    name:     'Greek Yogurt Parfait',
    tagline:  'Quick, no-cook, and packed with protein.',
    macros:   { calories: 320, protein: 24, carbs: 38, fat: 7 },
    ingredients: [
      '1 cup plain Greek yogurt (2% or full fat)',
      '½ cup blueberries or mixed berries',
      '¼ cup granola',
      '1 tbsp honey',
      '1 tbsp chia seeds',
    ],
    instructions: [
      'Spoon half the yogurt into a glass or bowl.',
      'Add half the berries and half the granola.',
      'Add remaining yogurt, then top with remaining berries and granola.',
      'Drizzle with honey and sprinkle chia seeds.',
      'Eat immediately or refrigerate overnight.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Greek%20Yogurt%20Parfait/Greek%20Yogurt%20Parfait%20.png',
  },
  {
    id:       'breakfast-3',
    category: 'breakfast',
    name:     'Overnight Oats',
    tagline:  'Prep the night before. Grab and go in the morning.',
    macros:   { calories: 380, protein: 16, carbs: 56, fat: 10 },
    ingredients: [
      '½ cup rolled oats',
      '¾ cup almond milk (or any milk)',
      '1 scoop vanilla protein powder',
      '1 banana, sliced',
      '1 tbsp peanut butter',
      '1 tsp cinnamon',
    ],
    instructions: [
      'Combine oats, milk, and protein powder in a jar or container.',
      'Stir well and refrigerate overnight (at least 6 hours).',
      'In the morning, top with sliced banana and peanut butter.',
      'Sprinkle cinnamon and enjoy cold or warmed for 60 seconds.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Overnight%20Oats/Overnight%20Oats%20.png',
  },
  {
    id:       'breakfast-4',
    category: 'breakfast',
    name:     'Avocado Toast & Eggs',
    tagline:  'Healthy fats + protein. The combo that fuels all morning.',
    macros:   { calories: 420, protein: 22, carbs: 32, fat: 24 },
    ingredients: [
      '2 slices whole grain bread, toasted',
      '1 ripe avocado',
      '2 eggs, poached or fried',
      'Juice of ½ lemon',
      'Red pepper flakes',
      'Salt and black pepper',
    ],
    instructions: [
      'Toast the bread until golden.',
      'Mash avocado in a bowl with lemon juice, salt, and pepper.',
      'Spread mashed avocado generously on both slices.',
      'Poach or fry eggs to your preference.',
      'Place an egg on each slice, season with red pepper flakes.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Avocado%20Toast%20&%20Eggs/Avocado%20Toast%20&%20Eggs.png',
  },
  {
    id:       'breakfast-5',
    category: 'breakfast',
    name:     'Protein Smoothie Bowl',
    tagline:  'Thick, filling, and fast. Better than any cereal.',
    macros:   { calories: 340, protein: 30, carbs: 40, fat: 6 },
    ingredients: [
      '1 scoop vanilla or chocolate protein powder',
      '1 frozen banana',
      '½ cup frozen mixed berries',
      '¼ cup almond milk',
      'Toppings: granola, sliced banana, hemp seeds',
    ],
    instructions: [
      'Blend protein powder, frozen banana, berries, and almond milk.',
      'Use minimal liquid — blend thick, not drinkable.',
      'Pour into a bowl (it should hold its shape).',
      'Top with granola, banana slices, and hemp seeds.',
      'Eat with a spoon immediately.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Protein%20Smoothie%20Bowl/Protein%20Smoothie%20Bowl.png',
  },
];

// ─── Lunch (5 options) ────────────────────────────────────────────────────────

const LUNCH: WWMeal[] = [
  {
    id:       'lunch-1',
    category: 'lunch',
    name:     'Chicken & Quinoa Bowl',
    tagline:  'Clean fuel. Hits every macro target in one bowl.',
    macros:   { calories: 480, protein: 42, carbs: 44, fat: 12 },
    ingredients: [
      '150g grilled chicken breast',
      '½ cup cooked quinoa',
      '1 cup baby spinach',
      '¼ cup cucumber, diced',
      '¼ cup cherry tomatoes',
      '2 tbsp olive oil & lemon dressing',
    ],
    instructions: [
      'Cook quinoa in salted water per packet instructions.',
      'Season and grill or pan-fry chicken breast until cooked through.',
      'Slice chicken and arrange over quinoa in a bowl.',
      'Add spinach, cucumber, and tomatoes.',
      'Drizzle with olive oil and lemon dressing.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Chicken%20&%20Quinoa%20Bowl/Chicken%20&%20Quinoa%20Bowl%20.png',
  },
  {
    id:       'lunch-2',
    category: 'lunch',
    name:     'Turkey & Avocado Wrap',
    tagline:  'Five minutes to make. Easy to take anywhere.',
    macros:   { calories: 440, protein: 36, carbs: 36, fat: 16 },
    ingredients: [
      '1 large whole wheat tortilla',
      '120g sliced turkey breast',
      '½ avocado, sliced',
      '2 romaine lettuce leaves',
      '2 tbsp hummus',
      'Sliced tomato and cucumber',
    ],
    instructions: [
      'Lay the tortilla flat and spread hummus evenly.',
      'Layer lettuce, turkey, avocado, tomato, and cucumber.',
      'Fold in the sides and roll tightly from the bottom.',
      'Slice in half and serve, or wrap in foil for later.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Turkey%20&%20Avocado%20Wrap/Turkey%20&%20Avocado%20Wrap%20.png',
  },
  {
    id:       'lunch-3',
    category: 'lunch',
    name:     'Salmon & Sweet Potato',
    tagline:  'Omega-3s and complex carbs. The best recovery meal.',
    macros:   { calories: 520, protein: 38, carbs: 42, fat: 16 },
    ingredients: [
      '150g salmon fillet',
      '1 medium sweet potato',
      '1 cup steamed broccoli',
      '1 tbsp olive oil',
      'Garlic, lemon, dill',
    ],
    instructions: [
      'Bake sweet potato at 200°C / 400°F for 40 minutes.',
      'Season salmon with olive oil, garlic, lemon, and dill.',
      'Pan-sear salmon skin-side down for 4 minutes, flip for 3 more.',
      'Steam broccoli for 5 minutes.',
      'Plate everything together and serve.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Salmon%20&%20Sweet%20Potato/Salmon%20&%20Sweet%20Potato%20.png',
  },
  {
    id:       'lunch-4',
    category: 'lunch',
    name:     'Tuna Lettuce Wraps',
    tagline:  'High protein, low carb, done in 5 minutes.',
    macros:   { calories: 310, protein: 36, carbs: 10, fat: 14 },
    ingredients: [
      '2 cans light tuna in water, drained',
      '4 large romaine lettuce leaves',
      '2 tbsp Greek yogurt or light mayo',
      '1 tbsp Dijon mustard',
      '¼ cup celery, finely diced',
      'Lemon juice, salt, pepper',
    ],
    instructions: [
      'Drain tuna thoroughly.',
      'Mix tuna with Greek yogurt, mustard, celery, lemon juice, salt, and pepper.',
      'Spoon the tuna mixture into lettuce leaf cups.',
      'Serve immediately.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Tuna%20Lettuce%20Wraps/Tuna%20Lettuce%20Wraps%20.png',
  },
  {
    id:       'lunch-5',
    category: 'lunch',
    name:     'Lentil & Veggie Soup',
    tagline:  'Batch cook once, eat all week. Gut health in a bowl.',
    macros:   { calories: 370, protein: 20, carbs: 52, fat: 7 },
    ingredients: [
      '1 cup red lentils',
      '1 can diced tomatoes',
      '1 carrot, diced',
      '2 celery stalks, diced',
      '1 onion, diced',
      '2 cups vegetable broth',
      'Cumin, turmeric, garlic',
    ],
    instructions: [
      'Sauté onion, carrot, and celery in olive oil for 5 minutes.',
      'Add garlic, cumin, and turmeric, cook 1 minute.',
      'Add lentils, tomatoes, and broth. Bring to a boil.',
      'Reduce heat and simmer 20–25 minutes until lentils are soft.',
      'Season with salt and pepper. Serve with crusty bread.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Lentil%20&%20Veggie%20Soup/Lentil%20&%20Veggie%20Soup%20.png',
  },
];

// ─── Dinner (5 options) ───────────────────────────────────────────────────────

const DINNER: WWMeal[] = [
  {
    id:       'dinner-1',
    category: 'dinner',
    name:     'Baked Salmon & Roasted Veg',
    tagline:  'Anti-inflammatory. Fills you up without slowing you down.',
    macros:   { calories: 480, protein: 40, carbs: 28, fat: 22 },
    ingredients: [
      '200g salmon fillet',
      '1 cup broccoli florets',
      '1 cup bell peppers, sliced',
      '1 zucchini, sliced',
      '2 tbsp olive oil',
      'Garlic powder, lemon, herbs',
    ],
    instructions: [
      'Preheat oven to 200°C / 400°F.',
      'Toss vegetables with 1 tbsp olive oil, garlic powder, salt, and pepper.',
      'Spread on a baking sheet and roast 15 minutes.',
      'Season salmon, place on the same tray, bake another 12–15 minutes.',
      'Squeeze lemon over everything before serving.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Baked%20Salmon%20&%20Roasted%20Veg/Baked%20Salmon%20&%20Roasted%20Veg.png',
  },
  {
    id:       'dinner-2',
    category: 'dinner',
    name:     'Lean Beef Stir Fry',
    tagline:  'Fast, hot, and packed. Better than any takeout.',
    macros:   { calories: 520, protein: 38, carbs: 52, fat: 14 },
    ingredients: [
      '150g lean beef strips',
      '1 cup cooked brown rice',
      '1 cup broccoli florets',
      '1 cup snap peas',
      '2 tbsp low-sodium soy sauce',
      '1 tbsp sesame oil, garlic, ginger',
    ],
    instructions: [
      'Cook brown rice per packet instructions.',
      'Heat sesame oil in a wok or pan over high heat.',
      'Stir-fry beef strips 2–3 minutes until browned, set aside.',
      'Add broccoli and snap peas, stir-fry 3 minutes.',
      'Return beef, add soy sauce, garlic, and ginger. Toss together.',
      'Serve over brown rice.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Lean%20Beef%20Stir%20Fry/Lean%20Beef%20Stir%20Fry%20.png',
  },
  {
    id:       'dinner-3',
    category: 'dinner',
    name:     'Grilled Chicken & Sweet Potato',
    tagline:  'The reliable classic. Never wrong for recovery.',
    macros:   { calories: 460, protein: 44, carbs: 40, fat: 9 },
    ingredients: [
      '200g chicken breast',
      '1 large sweet potato, cubed',
      '2 cups mixed greens',
      '1 tbsp olive oil',
      'Paprika, garlic, salt, pepper',
    ],
    instructions: [
      'Toss sweet potato cubes with olive oil, paprika, salt, and pepper.',
      'Roast at 200°C / 400°F for 25 minutes until golden.',
      'Season chicken with same spices and grill 6–7 min each side.',
      'Rest chicken 3 minutes before slicing.',
      'Plate over mixed greens with sweet potato on the side.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Grilled%20Chicken%20&%20Sweet%20Potato/Chicken%20&%20Sweet%20Potato.png',
  },
  {
    id:       'dinner-4',
    category: 'dinner',
    name:     'Turkey Meatballs & Zoodles',
    tagline:  'All the comfort, none of the carb crash.',
    macros:   { calories: 420, protein: 40, carbs: 22, fat: 18 },
    ingredients: [
      '200g lean ground turkey',
      '2 large zucchini, spiralized',
      '½ cup marinara sauce (low sugar)',
      '1 egg',
      '2 tbsp breadcrumbs',
      'Garlic, parsley, salt, pepper',
    ],
    instructions: [
      'Mix turkey with egg, breadcrumbs, garlic, parsley, salt, and pepper.',
      'Roll into golf-ball sized meatballs.',
      'Pan-fry meatballs in olive oil 8–10 minutes, turning occasionally.',
      'Add marinara sauce to the pan, simmer 5 minutes.',
      'Lightly sauté zucchini noodles 2 minutes in a separate pan.',
      'Serve meatballs and sauce over zoodles.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Turkey%20Meatballs%20&%20Zoodles/Turkey%20Meatballs%20&%20Zoodles%20.png',
  },
  {
    id:       'dinner-5',
    category: 'dinner',
    name:     'Shrimp & Brown Rice Bowl',
    tagline:  'Light but satisfying. Great for evening meals.',
    macros:   { calories: 440, protein: 36, carbs: 50, fat: 10 },
    ingredients: [
      '200g large shrimp, peeled and deveined',
      '¾ cup cooked brown rice',
      '1 cup edamame',
      '½ avocado, sliced',
      '2 tbsp soy sauce',
      'Sesame seeds, lime, sriracha',
    ],
    instructions: [
      'Cook brown rice per packet instructions.',
      'Season shrimp with soy sauce and a pinch of garlic powder.',
      'Pan-fry shrimp in a hot pan 2 minutes each side until pink.',
      'Assemble: rice at the bottom, then shrimp, edamame, and avocado.',
      'Drizzle with sriracha and lime juice, top with sesame seeds.',
    ],
    imageUrl: 'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Shrimp%20&%20Brown%20Rice%20Bowl/Shrimp%20&%20Brown%20Rice%20Bowl.png',
  },
];

// ─── Exports ──────────────────────────────────────────────────────────────────

export const WW_MEALS: WWMeal[] = [...BREAKFAST, ...LUNCH, ...DINNER];

export const WW_MEAL_CATEGORIES = [
  { key: 'breakfast' as const, label: 'Breakfast', emoji: '🌅' },
  { key: 'lunch'     as const, label: 'Lunch',     emoji: '☀️' },
  { key: 'dinner'    as const, label: 'Dinner',    emoji: '🌙' },
];

export function getMealsByCategory(category: WWMeal['category']): WWMeal[] {
  return WW_MEALS.filter(m => m.category === category);
}

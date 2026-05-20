import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const LANGUAGE_STORAGE_KEY = 'apex.language';

const resources = {
  en: {
    translation: {
      common: {
        back: 'Back',
        cancel: 'Cancel',
        continue: 'Continue →',
        ok: 'OK',
        save: 'Save',
        share: 'Share',
      },
      onboarding: {
        kicker: 'TRAIN. EAT. THRIVE TOGETHER.',
        logoSubtitle: 'Personal training, nutrition, tribe support, and AI coaching in one place.',
        getStarted: 'Get Started',
        signIn: 'Sign In',
      },
      auth: {
        createAccount: 'Create Account',
        creatingAccount: 'Creating Account...',
        alreadyHaveAccount: 'Already have an account? Sign In',
        email: 'Email',
        loginSubtitle: 'Sign in to continue your progress.',
        needAccount: 'Need an account? Get Started',
        password: 'Password',
        signIn: 'Sign In',
        signingIn: 'Signing In...',
        signInFailed: 'Sign in failed',
        signUp: 'Sign Up',
        signUpFailed: 'Sign up failed',
        signUpSubtitle: 'Start your APEX journey today.',
        welcomeBack: 'Welcome Back',
      },
      goalSetup: {
        colorSubtitle: 'Your app accent — change it anytime in Profile.',
        colorTitle: 'PICK YOUR\nCOLOUR',
        experience: 'Training Experience',
        goalSubtitle: 'Your coach will build everything around this.',
        goalTitle: "WHAT'S\nYOUR GOAL?",
        letsGo: "Let's Go ⚡",
        nameSubtitle: "We'll personalize everything around you.",
        nameTitle: "WHAT'S\nYOUR NAME?",
        skip: 'Skip for now',
        statsSubtitle: 'Used to calibrate calorie targets and program intensity.',
        statsTitle: 'YOUR\nSTATS',
        step: 'Step {{current}} of {{total}}',
        languageSubtitle: 'Choose the language you want to use in APEX.',
        languageTitle: 'CHOOSE\nYOUR LANGUAGE',
        fullName: 'Full Name',
        username: 'Username',
        weight: 'Weight (lbs)',
        height: 'Height (ft)',
      },
      tabs: {
        coach: 'COACH',
        dashboard: 'HOME',
        fuel: 'FUEL',
        plans: 'PLANS',
        train: 'TRAIN',
        tribe: 'TRIBE',
      },
      suggestions: {
        empty: 'No ideas yet. Share the first one.',
        placeholder: 'What feature would make APEX better for you?',
        submit: 'Submit Idea',
        subtitle: 'Vote on what we build next and share ideas with the team.',
        title: 'FEATURE VOTING',
        votes: '{{count}} votes',
      },
      walkTracker: {
        currentPace: 'Current pace',
        distance: 'Distance',
        start: 'Start Walk',
        statusIdle: 'Tap start to track your walk in real time.',
        statusTracking: 'Tracking your steps live. Keep the app open for the smoothest update stream.',
        stop: 'Stop Walk',
        subtitle: 'Track your route, distance, and live location while you walk.',
        title: 'WALK TRACKER',
      },
    },
  },
  es: {
    translation: {
      common: {
        back: 'Atrás',
        cancel: 'Cancelar',
        continue: 'Continuar →',
        ok: 'OK',
        save: 'Guardar',
        share: 'Compartir',
      },
      onboarding: {
        kicker: 'ENTRENA. COME. MEJORA EN EQUIPO.',
        logoSubtitle: 'Entrenamiento personal, nutrición, comunidad y coaching con IA en un solo lugar.',
        getStarted: 'Comenzar',
        signIn: 'Iniciar sesión',
      },
      auth: {
        createAccount: 'Crear cuenta',
        creatingAccount: 'Creando cuenta...',
        alreadyHaveAccount: '¿Ya tienes cuenta? Inicia sesión',
        email: 'Correo',
        loginSubtitle: 'Inicia sesión para continuar tu progreso.',
        needAccount: '¿Necesitas una cuenta? Comenzar',
        password: 'Contraseña',
        signIn: 'Iniciar sesión',
        signingIn: 'Entrando...',
        signInFailed: 'Error al iniciar sesión',
        signUp: 'Registrarse',
        signUpFailed: 'Error al registrarse',
        signUpSubtitle: 'Empieza tu camino con APEX hoy.',
        welcomeBack: 'Bienvenido de nuevo',
      },
      goalSetup: {
        colorSubtitle: 'El acento de tu app — puedes cambiarlo luego en Perfil.',
        colorTitle: 'ELIGE TU\nCOLOR',
        experience: 'Experiencia de entrenamiento',
        goalSubtitle: 'Tu coach construirá todo alrededor de esto.',
        goalTitle: '¿CUÁL ES\nTU META?',
        letsGo: 'Vamos ⚡',
        nameSubtitle: 'Vamos a personalizar todo alrededor de ti.',
        nameTitle: '¿CÓMO\nTE LLAMAS?',
        skip: 'Omitir por ahora',
        statsSubtitle: 'Se usa para calibrar calorías e intensidad del programa.',
        statsTitle: 'TUS\nDATOS',
        step: 'Paso {{current}} de {{total}}',
        languageSubtitle: 'Elige el idioma que quieres usar en APEX.',
        languageTitle: 'ELIGE\nTU IDIOMA',
        fullName: 'Nombre completo',
        username: 'Usuario',
        weight: 'Peso (lbs)',
        height: 'Altura (ft)',
      },
      tabs: {
        coach: 'COACH',
        dashboard: 'HOME',
        fuel: 'FUEL',
        plans: 'PLANES',
        train: 'TRAIN',
        tribe: 'TRIBU',
      },
      suggestions: {
        empty: 'Aún no hay ideas. Comparte la primera.',
        placeholder: '¿Qué función haría APEX mejor para ti?',
        submit: 'Enviar idea',
        subtitle: 'Vota lo que construimos después y comparte ideas con el equipo.',
        title: 'VOTACIÓN DE FUNCIONES',
        votes: '{{count}} votos',
      },
      walkTracker: {
        currentPace: 'Ritmo actual',
        distance: 'Distancia',
        start: 'Empezar caminata',
        statusIdle: 'Toca empezar para seguir tu caminata en tiempo real.',
        statusTracking: 'Registrando tu caminata en vivo. Mantén la app abierta para actualizaciones más fluidas.',
        stop: 'Detener caminata',
        subtitle: 'Sigue tu ruta, distancia y ubicación en vivo mientras caminas.',
        title: 'SEGUIDOR DE CAMINATA',
      },
    },
  },
} as const;

async function detectLanguage() {
  const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored) return stored;
  return getLocales()[0]?.languageCode ?? 'en';
}

void i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: 'v4',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    resources,
  })
  .then(async () => {
    const detected = await detectLanguage();
    await i18n.changeLanguage(detected.startsWith('es') ? 'es' : 'en');
  });

export default i18n;

const read = (value?: string) => value?.trim() ?? '';
const readBool = (value?: string) => /^(1|true|yes|on)$/i.test(value?.trim() ?? '');

export const env = {
  bundleId: read(process.env.EXPO_PUBLIC_APP_BUNDLE_ID),
  easProjectId: read(process.env.EXPO_PUBLIC_EAS_PROJECT_ID),
  elevenLabsApiKey: read(process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY),
  elevenLabsVoiceId: read(process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID),
  elevenLabsAgentMarcusId: read(process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_MARCUS_ID),
  elevenLabsAgentSerenaId: read(process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_SERENA_ID),
  // Single Coach Josh conversational agent — set to the Coach Josh agent id.
  elevenLabsAgentJoshId: read(process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_JOSH_ID),
  elevenLabsAgentEnabled: readBool(process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ENABLED),
  nutritionixAppId: read(process.env.EXPO_PUBLIC_NUTRITIONIX_APP_ID),
  nutritionixAppKey: read(process.env.EXPO_PUBLIC_NUTRITIONIX_APP_KEY),
  openaiRealtimeModel: read(process.env.EXPO_PUBLIC_OPENAI_REALTIME_MODEL),
  openaiRealtimeAndroidVadMode: read(process.env.EXPO_PUBLIC_OPENAI_REALTIME_ANDROID_VAD_MODE),
  openaiRealtimeProxyUrl: read(process.env.EXPO_PUBLIC_OPENAI_REALTIME_PROXY_URL),
  openaiRealtimeTransport: read(process.env.EXPO_PUBLIC_OPENAI_REALTIME_TRANSPORT),
  openaiSpeechToSpeechEnabled: readBool(process.env.EXPO_PUBLIC_OPENAI_SPEECH_TO_SPEECH_ENABLED),
  youtubeApiKey: read(process.env.EXPO_PUBLIC_YOUTUBE_API_KEY),
  rapidApiKey: read(process.env.EXPO_PUBLIC_RAPIDAPI_KEY),
  posthogHost: read(process.env.EXPO_PUBLIC_POSTHOG_HOST),
  posthogApiKey: read(process.env.EXPO_PUBLIC_POSTHOG_API_KEY),
  revenueCatAppleApiKey: read(process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY),
  revenueCatGoogleApiKey: read(process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY),
  stripePublishableKey: read(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY),
  stripeMerchantIdentifier: read(process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER),
  coachSchedulingUrl: read(process.env.EXPO_PUBLIC_COACH_SCHEDULING_URL),
  googlePlacesApiKey: read(process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY),
  supabaseAnonKey: read(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  supabaseUrl: read(process.env.EXPO_PUBLIC_SUPABASE_URL),
  zoomJoinUrl: read(process.env.EXPO_PUBLIC_ZOOM_JOIN_URL),
  zoomHostUserId: read(process.env.EXPO_PUBLIC_ZOOM_HOST_USER_ID),
  // Coach access password — set this in .env and EAS secrets, never commit the value
  EXPO_PUBLIC_COACH_ACCESS_PASSWORD: process.env.EXPO_PUBLIC_COACH_ACCESS_PASSWORD?.trim() ?? '',
  // fal.ai API key for Demo Studio video generation
  falApiKey: read(process.env.EXPO_PUBLIC_FAL_KEY),
  // Hosted reference image URLs for Marcus and Serena (upload to Supabase Storage)
  demoRefMarcusUrl: read(process.env.EXPO_PUBLIC_DEMO_REF_MARCUS_URL),
  demoRefSerenaUrl: read(process.env.EXPO_PUBLIC_DEMO_REF_SERENA_URL),
};

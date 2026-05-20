import React, { useRef } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Alert, Animated, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { usePro } from '@/hooks/usePro';
import { useAuth } from '@/contexts/AuthContext';
import { hydrateProfileFromSupabase, syncProfileToSupabase } from '@/lib/profileSync';
import {
  PROGRAM_LIBRARY,
  getMembershipCta,
  getMembershipDescription,
  getMembershipLabel,
  getPlanById,
  getSuggestedPlanId,
  type ProgramDefinition,
} from '@/lib/plans';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { getAIProgram, saveAIProgram, parseProgramTag, type AIProgram } from '@/lib/aiWorkout';
import { getOrComputeMacroTargets } from '@/lib/bmr';
import { supabase } from '@/lib/supabase';
import { getCoachPersonaPrefix, getSelectedCoachVoice, type CoachVoiceOption } from '@/lib/coachVoice';
import { apexColors as C } from '@/theme/colors';
import { useTheme } from '@/contexts/ThemeContext';

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function ProgressBar({ color = C.green, pct }: { color?: string; pct: number }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

function ProgramCard({
  active,
  bgColor,
  icon,
  isSuggested,
  meta,
  name,
  onPress,
  reason,
  tag,
}: {
  active?: boolean;
  bgColor: string;
  icon: string;
  isSuggested?: boolean;
  meta: string;
  name: string;
  onPress?: () => void;
  reason: string;
  tag: string;
}) {
  return (
    <Pressable style={[styles.progCard, active ? { borderColor: C.green } : null]} onPress={onPress}>
      <View style={[styles.progThumb, { backgroundColor: bgColor }]}>
        <Text style={{ fontSize: 36 }}>{icon}</Text>
      </View>
      <View style={styles.progBody}>
        <View style={styles.programTitleRow}>
          <Text style={styles.progName}>{name}</Text>
          {isSuggested ? (
            <View style={styles.suggestedPill}>
              <Text style={styles.suggestedPillText}>SUGGESTED</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.progMeta}>{meta}</Text>
        <Text style={styles.progReason}>{reason}</Text>
        <Text style={[styles.progTag, active ? { color: C.green } : null]}>{tag}</Text>
      </View>
    </Pressable>
  );
}

/** Premium card shown at the top of Program Library for the AI-built Pro plan */
function ProAIProgramCard({
  aiProgram,
  coachVoice,
  isActive,
  isPro,
  generating,
  onPress,
}: {
  aiProgram: AIProgram | null;
  coachVoice: CoachVoiceOption | null;
  isActive: boolean;
  isPro: boolean;
  generating?: boolean;
  onPress?: () => void;
}) {
  const hasProgram = aiProgram !== null;
  const coachLabel = coachVoice?.label ?? 'Coach';

  // Slow border pulse for the "generate" CTA state
  const pulseBorder = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!isActive) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseBorder, { toValue: 1, duration: 1800, useNativeDriver: false }),
          Animated.timing(pulseBorder, { toValue: 0, duration: 1800, useNativeDriver: false }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
  }, [isActive, pulseBorder]);

  const animatedBorderColor = pulseBorder.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,152,0,0.3)', 'rgba(255,152,0,1)'],
  });

  return (
    <Animated.View style={[styles.proAiCard, isActive ? styles.proAiCardActive : null, !isActive && { borderColor: animatedBorderColor }]}>
    <Pressable
      style={{ flex: 1 }}
      onPress={onPress}
      disabled={isActive || generating}
    >
      {/* Thumbnail strip */}
      <View style={styles.proAiThumb}>
        {/* Subtle diagonal stripe overlay — pure View layers */}
        <View style={styles.proAiThumbStripe1} />
        <View style={styles.proAiThumbStripe2} />

        {/* Icon + PRO EXCLUSIVE label stacked */}
        <View style={styles.proAiThumbContent}>
          <Text style={styles.proAiThumbIcon}>{hasProgram ? (aiProgram!.icon ?? '⚡') : '⚡'}</Text>
          <View style={styles.proExclusivePill}>
            <Text style={styles.proExclusivePillText}>⚡ PRO EXCLUSIVE</Text>
          </View>
        </View>

        {/* Corner badge */}
        {!isPro ? (
          <View style={styles.proLockCorner}>
            <Text style={styles.proLockCornerText}>🔒</Text>
          </View>
        ) : isActive ? (
          <View style={[styles.proLockCorner, { backgroundColor: C.green }]}>
            <Text style={[styles.proLockCornerText, { color: '#000' }]}>✓</Text>
          </View>
        ) : null}
      </View>

      {/* Body */}
      <View style={styles.proAiBody}>
        {/* Title row */}
        <View style={styles.proAiTitleRow}>
          <Text style={styles.proAiName} numberOfLines={1}>
            {hasProgram ? aiProgram!.title : 'AI Blueprint Builder'}
          </Text>
          <View style={styles.proAiBadge}>
            {coachVoice?.avatar ? <Image source={coachVoice.avatar} style={styles.proAiBadgeAvatar} /> : null}
            <Text style={styles.proAiBadgeText}>{coachLabel}</Text>
          </View>
        </View>

        {/* Meta */}
        <Text style={styles.proAiMeta}>
          {hasProgram
            ? `${aiProgram!.durationWeeks} wks · ${aiProgram!.daysPerWeek} days · ${aiProgram!.level}`
            : 'Built from your stats, goals & training history'}
        </Text>

        {/* Description */}
        <Text style={styles.proAiReason}>
          {hasProgram
            ? (aiProgram!.coachNote ?? 'Your AI Coach built this entire program from your profile, goals, nutrition targets, and training history.')
            : 'Every rep, every set, every week — generated specifically for your body, goal weight, and recovery patterns. No template. Yours alone.'}
        </Text>

        {/* CTA strip */}
        <View style={styles.proAiCtaRow}>
          {generating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={C.orange} />
              <Text style={[styles.proAiCtaText, { color: C.orange }]}>Building your program…</Text>
            </View>
          ) : (
            <Text style={[
              styles.proAiCtaText,
              isActive ? { color: C.green } : isPro ? { color: C.orange } : { color: C.orange },
            ]}>
              {isActive
                ? `✓ Your active ${coachLabel} plan`
                : isPro
                  ? `→ Generate with ${coachLabel}`
                  : '→ Upgrade to Pro to unlock'}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
    </Animated.View>
  );
}

const PLAN_ACCENTS: Record<ProgramDefinition['id'], string> = {
  'power-build': C.greenSoft,
  'hiit-burn': 'rgba(255,107,53,0.07)',
  'body-recomp-pro': C.purpleSoft,
  'elite-performance': 'rgba(255,215,0,0.05)',
};

export default function PlansScreen() {
  const { accent, accentSoft, accentBorder, accentStrongBorder } = useTheme();
  const navigation = useNavigation<any>();
  const { session } = useAuth();
  const { isPro, isLoading: proLoading } = usePro();
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [activeCoachVoice, setActiveCoachVoice] = React.useState<CoachVoiceOption | null>(null);
  const [pendingPlan, setPendingPlan] = React.useState<ProgramDefinition | null>(null);
  const [aiProgram, setAiProgram] = React.useState<AIProgram | null>(null);
  const [generatingAI, setGeneratingAI] = React.useState(false);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const libraryAnim = useRef(new Animated.Value(0)).current;
  const libraryChevronAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    React.useCallback(() => {
      hydrateProfileFromSupabase(session?.user?.id)
        .then((hydrated) => setProfile(hydrated))
        .catch(() => setProfile(null));
      getSelectedCoachVoice()
        .then(setActiveCoachVoice)
        .catch(() => null);
      getAIProgram()
        .then((prog) => setAiProgram(prog))
        .catch(() => setAiProgram(null));
    }, [session?.user?.id]),
  );

  const suggestedPlanId = getSuggestedPlanId(profile?.goal ?? 'recomp', profile?.experience ?? 'intermediate');
  const isAiActive = profile?.activePlanId === 'ai-generated' && aiProgram !== null;
  const activePlan = isAiActive ? null : getPlanById(profile?.activePlanId ?? suggestedPlanId);
  const suggestedPlan = getPlanById(suggestedPlanId);
  const membershipLabel = getMembershipLabel(isPro);
  const membershipDescription = getMembershipDescription(isPro);
  const membershipCta = getMembershipCta(isPro);

  const handleConfirmPlanChange = async () => {
    if (!pendingPlan) return;
    const nextProfile: UserProfile = {
      ...(profile ?? {
        displayName: 'Athlete',
        username: 'athlete',
        goal: 'recomp',
        weightLbs: '',
        heightFt: '',
        age: '',
        goalWeightLbs: '',
        gender: 'male',
        experience: 'intermediate',
      }),
      activePlanId: pendingPlan.id,
    };

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await syncProfileToSupabase(session?.user?.id, nextProfile);
      setProfile(nextProfile);
      setPendingPlan(null);
    } catch {
      Alert.alert(
        'Plan switch failed',
        'We could not sync your new active program to your account yet. Please try again in a moment.',
      );
    }
  };

  // ── Inline AI program generation ─────────────────────────────────────────
  const handleGenerateAIProgram = React.useCallback(async () => {
    if (generatingAI) return;
    setGeneratingAI(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);

    try {
      const p = profile;
      const macros = getOrComputeMacroTargets(p);
      const goal = p?.goal ?? 'recomp';
      const experience = p?.experience ?? 'intermediate';
      const gender = p?.gender ?? 'not specified';
      const firstName = p?.displayName?.split(' ')[0] ?? null;
      const currentWeight = p?.weightLbs ? Number(p.weightLbs) : null;
      const targetWeight = p?.goalWeightLbs ? Number(p.goalWeightLbs) : null;
      const lbsToGoal = currentWeight && targetWeight ? Math.abs(currentWeight - targetWeight) : null;
      const weightLbs = currentWeight ? `${currentWeight} lbs` : 'not specified';
      const goalWeightLbs = targetWeight ? `${targetWeight} lbs` : 'not specified';
      const age = p?.age ?? 'not specified';

      // Build a personalised note using real stats for the fallback
      const buildPersonalisedNote = (): string => {
        const namePart = firstName ? `${firstName}, ` : '';
        if (lbsToGoal && lbsToGoal > 0 && lbsToGoal <= 100) {
          const direction = goal === 'lose' ? 'lose' : goal === 'build' ? 'gain' : 'recomp';
          if (direction === 'lose') return `${namePart}you're ${lbsToGoal} lbs from your target — this program keeps your ${macros.dailyCalorieTarget} kcal deficit in check while preserving muscle. Stay consistent.`;
          if (direction === 'gain') return `${namePart}${lbsToGoal} lbs of quality muscle to build — this program is designed around your ${macros.dailyProtein}g protein target and progressive overload. Trust the process.`;
        }
        if (currentWeight && macros.dailyCalorieTarget) {
          return `${namePart}your program is calibrated to your ${currentWeight} lb bodyweight and ${macros.dailyCalorieTarget} kcal target. Every session moves the needle.`;
        }
        return `${namePart}this program is built specifically for your ${goal.replace('_', ' ')} goal. Every rep counts — let's get to work.`;
      };

      const prompt = `Build me a complete personalised training program:
- Name: ${firstName ?? 'Athlete'}
- Goal: ${goal}
- Experience: ${experience}
- Gender: ${gender}
- Current weight: ${weightLbs} | Target: ${goalWeightLbs}
- Age: ${age}
- Daily targets: ${macros.dailyCalorieTarget} kcal · ${macros.dailyProtein}g protein · ${macros.dailyCarbs}g carbs · ${macros.dailyFat}g fat

Design the optimal program duration, days per week, and intensity. Address me by first name (${firstName ?? 'Athlete'}) in the coachNote. Push it to my Plans page now.`;

      const personaPrefix = await getCoachPersonaPrefix().catch(() => '');
      const SYSTEM = `${personaPrefix}You are APEX AI Coach. When asked to build a training program, always embed a [[PROGRAM:{...}]] tag at the very end of your reply.
[[PROGRAM:{"title":"Program Name","icon":"💪","durationWeeks":8,"daysPerWeek":4,"level":"Intermediate","subtitle":"Short tagline","focus":"Primary focus","coachNote":"One motivating sentence addressing the user by first name, referencing their specific weight/goal stats"}]]
Choose a fitting emoji icon, realistic duration (4-16 weeks), days per week (3-6), and correct level. The coachNote MUST include the user's first name and reference their specific weight or calorie target.`;

      const activatePlan = async (prog: AIProgram) => {
        await saveAIProgram(prog);
        const base = profile ?? ({} as UserProfile);
        const updated: UserProfile = { ...base, activePlanId: 'ai-generated' };
        // Sync to Supabase — error is non-fatal (42P10 constraint handled in profileSync)
        await syncProfileToSupabase(session?.user?.id, updated).catch(() => null);
        setProfile(updated);
        setAiProgram(prog);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
      };

      let program: AIProgram | null = null;

      try {
        const { data, error } = await supabase.functions.invoke('anthropic', {
          body: {
            max_tokens: 600,
            messages: [{ role: 'user', content: prompt }],
            system: SYSTEM,
          },
        });
        if (!error) {
          const rawReply: string =
            data?.content?.map((block: { text?: string }) => block.text ?? '').join('') ?? '';
          const parsed = parseProgramTag(rawReply);
          program = parsed.program;
        }
      } catch { /* network issue — fall through to local fallback */ }

      if (!program) {
        // Fallback: build a sensible program from profile data locally
        program = {
          title: goal === 'lose' ? 'Fat Loss Accelerator' : goal === 'build' ? 'Hypertrophy Blueprint' : 'Peak Performance Protocol',
          icon: goal === 'lose' ? '🔥' : goal === 'build' ? '💪' : '⚡',
          durationWeeks: experience === 'beginner' ? 6 : experience === 'advanced' ? 12 : 8,
          daysPerWeek: experience === 'beginner' ? 3 : experience === 'advanced' ? 5 : 4,
          level: experience === 'beginner' ? 'Beginner' : experience === 'advanced' ? 'Advanced' : 'Intermediate',
          subtitle: `Built for your ${goal.replace(/_/g, ' ')} goal`,
          focus: goal === 'lose' ? 'Fat loss + cardio conditioning' : goal === 'build' ? 'Hypertrophy + progressive overload' : 'Strength + body recomposition',
          coachNote: buildPersonalisedNote(),
          generatedAt: new Date().toISOString(),
        };
      }

      await activatePlan(program);
    } catch {
      Alert.alert('Could not generate program', 'Check your connection and try again.');
    } finally {
      setGeneratingAI(false);
    }
  }, [generatingAI, profile, session?.user?.id]);

  return (
    <View style={styles.screen}>
      <AppHeader />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {isAiActive && aiProgram ? (
          <View style={[styles.progHero, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
            <View style={styles.heroEyebrowRow}>
              <Text style={[styles.heroEyebrow, { color: accent }]}>ACTIVE PROGRAM</Text>
              <View style={[styles.aiProgramBadge, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
                {activeCoachVoice ? <Image source={activeCoachVoice.avatar} style={styles.aiProgramBadgeAvatar} /> : null}
                <Text style={[styles.aiProgramBadgeText, { color: accent }]}>
                  {activeCoachVoice ? activeCoachVoice.label : 'AI Coach'}
                </Text>
              </View>
            </View>
            <Text style={styles.heroEmoji}>{aiProgram.icon}</Text>
            <Text style={styles.heroTitle}>{aiProgram.title} — {aiProgram.durationWeeks} Week</Text>
            <Text style={styles.heroMeta}>
              {aiProgram.daysPerWeek} days/week · {aiProgram.level} · {aiProgram.subtitle}
            </Text>
            {aiProgram.focus ? (
              <Text style={[styles.heroMeta, { marginTop: 0 }]}>Focus: {aiProgram.focus}</Text>
            ) : null}
            <ProgressBar color={accent} pct={4} />
            {aiProgram.coachNote ? (
              <Text style={styles.heroSub}>💬 {aiProgram.coachNote}</Text>
            ) : (
              <Text style={styles.heroSub}>Custom program built by {activeCoachVoice?.label ?? 'your AI coach'}.</Text>
            )}
          </View>
        ) : activePlan ? (
          <View style={[styles.progHero, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
            <Text style={[styles.heroEyebrow, { color: accent }]}>ACTIVE PROGRAM</Text>
            <Text style={styles.heroEmoji}>{activePlan.icon}</Text>
            <Text style={styles.heroTitle}>{activePlan.title} — {activePlan.durationWeeks} Week</Text>
            <Text style={styles.heroMeta}>
              {activePlan.daysPerWeek} days/week · {activePlan.level} · {activePlan.subtitle}
            </Text>
            <ProgressBar color={accent} pct={profile?.activePlanId === activePlan.id ? 14 : 8} />
            <Text style={styles.heroSub}>
              {activePlan.id === suggestedPlan.id
                ? 'This matches the goal you selected during setup.'
                : `Recommended for your goal: ${suggestedPlan.title}`}
            </Text>
          </View>
        ) : null}

        {/* ── Collapsible Program Library ── */}
        <Pressable
          style={[
            styles.libraryHeader,
            { borderColor: libraryOpen ? accentStrongBorder : accentBorder, backgroundColor: libraryOpen ? accentSoft : `${accent}12` },
          ]}
          onPress={() => {
            const next = !libraryOpen;
            setLibraryOpen(next);
            Haptics.selectionAsync().catch(() => null);
            Animated.parallel([
              Animated.spring(libraryAnim, {
                toValue: next ? 1 : 0,
                useNativeDriver: false,
                speed: 18,
                bounciness: 4,
              }),
              Animated.timing(libraryChevronAnim, {
                toValue: next ? 1 : 0,
                duration: 220,
                useNativeDriver: true,
              }),
            ]).start();
          }}
        >
          <View style={[styles.libraryHeaderIconWrap, { backgroundColor: accent, borderColor: accentStrongBorder }]}>
            <Text style={styles.libraryHeaderIcon}>📚</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.libraryTitle, { color: accent }]}>Program Library</Text>
            <Text style={styles.librarySubtitle}>
              {PROGRAM_LIBRARY.length + 1} programs ready. Tap here to {libraryOpen ? 'collapse your library' : 'browse, compare, and switch fast'}.
            </Text>
          </View>
          <Animated.Text
            style={[
              styles.libraryChevron,
              { color: libraryOpen ? accent : C.muted },
              {
                transform: [{
                  rotate: libraryChevronAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '180deg'],
                  }),
                }],
              },
            ]}
          >
            ⌄
          </Animated.Text>
        </Pressable>

        {libraryOpen ? (
          <>
            <ProAIProgramCard
              aiProgram={aiProgram}
              coachVoice={activeCoachVoice}
              isActive={isAiActive}
              isPro={isPro}
              generating={generatingAI}
              onPress={
                isAiActive
                  ? undefined
                  : () => {
                      if (!isPro) {
                        navigation.navigate('Upgrade');
                        return;
                      }
                      handleGenerateAIProgram().catch(() => null);
                    }
              }
            />
            {PROGRAM_LIBRARY.map((plan) => {
              const isActive = !isAiActive && activePlan?.id === plan.id;
              const isSuggested = suggestedPlan.id === plan.id;
              return (
                <ProgramCard
                  key={plan.id}
                  icon={plan.icon}
                  bgColor={PLAN_ACCENTS[plan.id]}
                  name={plan.title}
                  meta={`${plan.durationWeeks} wks · ${plan.daysPerWeek} days · ${plan.level}`}
                  reason={plan.reason}
                  tag={
                    isActive
                      ? 'Your active plan'
                      : isSuggested
                        ? 'Recommended for your goal'
                        : 'Tap to review and switch'
                  }
                  active={isActive}
                  isSuggested={isSuggested}
                  onPress={isActive ? undefined : () => setPendingPlan(plan)}
                />
              );
            })}
          </>
        ) : (
          /* Collapsed preview — show small plan chips so the user knows what's inside */
          <View style={styles.libraryPreviewRow}>
            {[aiProgram ? {
              id: 'ai',
              icon: aiProgram.icon ?? '⚡',
              title: `${activeCoachVoice?.label ?? 'Coach'} Program`,
              avatar: activeCoachVoice?.avatar,
            } : null,
              ...PROGRAM_LIBRARY.slice(0, 4),
            ].filter(Boolean).map((plan) => (
              <View key={plan!.id} style={styles.libraryPreviewChip}>
                {'avatar' in plan! && plan!.avatar ? (
                  <Image source={plan!.avatar} style={styles.libraryPreviewAvatar} />
                ) : (
                  <Text style={styles.libraryPreviewIcon}>{plan!.icon}</Text>
                )}
                <Text style={styles.libraryPreviewName} numberOfLines={1}>{plan!.title}</Text>
              </View>
            ))}
            {PROGRAM_LIBRARY.length > 4 ? (
              <View style={styles.libraryPreviewChip}>
                <Text style={styles.libraryPreviewName}>+{PROGRAM_LIBRARY.length - 4} more</Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Modal visible={Boolean(pendingPlan)} transparent animationType="fade" onRequestClose={() => setPendingPlan(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>Switch Program</Text>
            <Text style={styles.modalTitle}>{pendingPlan?.title}</Text>
            <Text style={styles.modalBody}>
              Switching plans will end your current program and replace the workout structure you see in Train. Your logged workout history stays saved.
            </Text>
            <Text style={styles.modalBody}>
              Choose this plan if: {pendingPlan?.reason}
            </Text>
            <View style={styles.modalBtns}>
              <Pressable style={styles.btnGhost} onPress={() => setPendingPlan(null)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.btnPrimary} onPress={() => handleConfirmPlanChange().catch(() => null)}>
                <Text style={styles.btnPrimaryText}>Confirm Switch</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  scroll: { flex: 1, backgroundColor: C.black },
  content: { padding: 14, paddingBottom: 32 },
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 16,
    padding: 15,
    marginBottom: 14,
  },
  upgradeEyebrow: {
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  upgradeTitle: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  upgradeSub: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  upgradeCta: {
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 11,
  },
  sectionLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 4,
    marginTop: 8,
  },
  libraryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    marginTop: 4,
    gap: 10,
  },
  libraryHeaderIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  libraryHeaderIcon: {
    fontSize: 20,
  },
  libraryTitle: {
    fontSize: 18,
    fontFamily: 'BebasNeue_400Regular',
    letterSpacing: 1,
  },
  librarySubtitle: {
    fontSize: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    marginTop: 2,
    lineHeight: 18,
  },
  libraryChevron: {
    fontSize: 22,
    color: C.muted,
    fontFamily: 'DMSans_700Bold',
    lineHeight: 26,
  },
  libraryPreviewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  libraryPreviewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  libraryPreviewIcon: {
    fontSize: 13,
  },
  libraryPreviewAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  libraryPreviewName: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
  },
  progHero: {
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  heroEyebrow: { fontSize: 10, color: C.green, fontFamily: 'SpaceMono_400Regular' },
  aiProgramBadge: { backgroundColor: 'rgba(0,255,136,0.15)', borderWidth: 1, borderColor: C.greenBorder, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 6 },
  aiProgramBadgeAvatar: { width: 16, height: 16, borderRadius: 8, backgroundColor: 'transparent' },
  aiProgramBadgeText: { color: C.green, fontFamily: 'SpaceMono_400Regular', fontSize: 8, letterSpacing: 0.8 },
  heroEmoji: { fontSize: 36, marginBottom: 8 },
  heroTitle: { fontFamily: 'BebasNeue_400Regular', fontSize: 22, letterSpacing: 2, color: C.text },
  heroMeta: { fontSize: 11, color: C.muted, marginVertical: 4, fontFamily: 'DMSans_400Regular' },
  heroSub: { fontSize: 11, color: C.muted, marginTop: 5, fontFamily: 'DMSans_400Regular' },
  barTrack: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden', marginVertical: 5 },
  barFill: { height: '100%', borderRadius: 4 },
  lockedCoachCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  lockedCoachTitle: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 14, marginBottom: 6 },
  lockedCoachBody: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  // Live coaching CTA card
  liveCoachCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.greenStrongBorder, borderRadius: 14, padding: 14, marginBottom: 10 },
  liveCoachAva: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  liveCoachTitle: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 2 },
  liveCoachSub: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 17 },
  liveCoachCta: { fontSize: 12, color: C.green, fontFamily: 'DMSans_700Bold', marginTop: 4 },
  liveCoachBtn: { backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  liveCoachBtnText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 12 },
  coachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 13,
    marginBottom: 8,
  },
  coachAva: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachInfo: { flex: 1, minWidth: 0 },
  coachName: { fontSize: 13, color: C.text, fontFamily: 'DMSans_500Medium' },
  coachSpec: { fontSize: 11, color: C.muted, marginTop: 2, marginBottom: 6, fontFamily: 'DMSans_400Regular' },
  coachCompliance: { fontSize: 10, color: C.muted, marginTop: 3, fontFamily: 'DMSans_400Regular' },
  progCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
    flexDirection: 'column',
  },
  progThumb: { height: 70, alignItems: 'center', justifyContent: 'center' },
  progBody: { padding: 12 },
  programTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  progName: { flex: 1, fontSize: 14, color: C.text, fontFamily: 'DMSans_500Medium', marginBottom: 3 },
  progMeta: { fontSize: 11, color: C.muted, fontFamily: 'SpaceMono_400Regular' },
  progReason: { fontSize: 12, color: C.text, fontFamily: 'DMSans_400Regular', lineHeight: 18, marginTop: 8 },
  progTag: { fontSize: 10, color: C.muted, marginTop: 8, fontFamily: 'SpaceMono_400Regular' },
  suggestedPill: {
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  suggestedPillText: { color: C.green, fontFamily: 'SpaceMono_400Regular', fontSize: 8 },

  // ── Pro AI Plan Card ──────────────────────────────────────────────────────
  proAiCard: {
    backgroundColor: C.card,
    borderWidth: 2,
    borderColor: 'rgba(255,107,53,0.45)',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
  },
  proAiCardActive: {
    borderColor: C.green,
  },
  proAiThumb: {
    height: 90,
    backgroundColor: 'rgba(255,107,53,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Decorative angled stripe layers
  proAiThumbStripe1: {
    position: 'absolute',
    top: -20,
    left: -40,
    width: 120,
    height: 200,
    backgroundColor: 'rgba(255,107,53,0.06)',
    transform: [{ rotate: '25deg' }],
  },
  proAiThumbStripe2: {
    position: 'absolute',
    top: -20,
    right: -60,
    width: 160,
    height: 200,
    backgroundColor: 'rgba(255,107,53,0.04)',
    transform: [{ rotate: '25deg' }],
  },
  proAiThumbContent: {
    alignItems: 'center',
    gap: 6,
  },
  proAiThumbIcon: {
    fontSize: 32,
  },
  proExclusivePill: {
    backgroundColor: 'rgba(255,107,53,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.5)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  proExclusivePillText: {
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 1,
  },
  proLockCorner: {
    position: 'absolute',
    top: 8,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,107,53,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  proLockCornerText: {
    fontSize: 12,
    color: C.orange,
  },
  proAiBody: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,107,53,0.2)',
  },
  proAiTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  proAiName: {
    flex: 1,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    letterSpacing: 1.5,
    color: C.text,
  },
  proAiBadge: {
    backgroundColor: 'rgba(255,107,53,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.4)',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  proAiBadgeAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  proAiBadgeText: {
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 8,
    letterSpacing: 0.5,
  },
  proAiMeta: {
    fontSize: 10,
    color: 'rgba(255,107,53,0.7)',
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  proAiReason: {
    fontSize: 12.5,
    color: '#ccc',
    fontFamily: 'DMSans_400Regular',
    lineHeight: 19,
    marginBottom: 10,
  },
  proAiCtaRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,107,53,0.18)',
    paddingTop: 10,
  },
  proAiCtaText: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    flex: 1,
  },
  btnGhostText: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 12 },
  btnPrimary: {
    backgroundColor: C.green,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    flex: 1.2,
  },
  btnPrimaryText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.orangeBorder,
    padding: 18,
  },
  modalEyebrow: { color: C.orange, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 1.2, marginBottom: 8 },
  modalTitle: { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 28, letterSpacing: 1.4 },
  modalBody: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, marginTop: 10 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 18 },
});

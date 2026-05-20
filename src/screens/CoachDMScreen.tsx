/**
 * CoachDMScreen
 *
 * Full-screen AI-powered chat that simulates Josh (the coach) DMing the user,
 * collects key info, then books a fit call.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { fetchFitCallSlots, bookFitCall } from '@/lib/calendarIntegration';
import { supabase } from '@/lib/supabase';
import {
  type DMConversationState,
  type DMMessage,
  type DMStage,
  bookingConfirmationMessages,
  bookingErrorMessage,
  cancelSilenceFollowUps,
  challengeQuestionMessage,
  clearConversation,
  daySelectionMessage,
  greetingMessages,
  greetingReplyMessage,
  hasPriceObjection,
  isAcknowledgmentOnly,
  loadConversation,
  makeMessage,
  parseRescheduleRequest,
  phoneCollectionMessage,
  priceObjectionMessage,
  priceObjectionReaskMessage,
  rescheduleAckMessage,
  rescheduleConfirmMessage,
  rescheduleFollowUpMessage,
  resetDMFlowForTesting,
  resourceMessages,
  saveConversation,
  scheduleMorningReminder,
  scheduleSilenceFollowUps,
  socialProofMessages,
  timeSelectionMessage,
  TYPING_IMAGE,
  TYPING_LONG,
  TYPING_SHORT,
} from '@/lib/coachDM';
import { env } from '@/lib/env';
import { getWalkWaterQuizAnswers } from '@/lib/walkWaterMode';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { apexColors as C } from '@/theme/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { WalkWaterStackParamList } from '@/navigation/WalkWaterNavigator';

// ─── Constants ────────────────────────────────────────────────────────────────

const COACH_AVATAR = require('../../assets/josh-coach.png');

const STAGES_WITH_FREE_INPUT: DMStage[] = [
  'greeting',
  'awaiting_diet',
  'awaiting_challenge',
  'phone_collection',
  'reschedule_slot_selection',
];

// After booking the real coach takes over — show input but skip AI
const STAGES_DIRECT_TO_COACH: DMStage[] = ['booked', 'rescheduled'];

const TRANSFORMATION_MAX_WIDTH = 220;
const TRANSFORMATION_MAX_HEIGHT = 320;

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(600),
        ]),
      );

    const a1 = pulse(dot1, 0);
    const a2 = pulse(dot2, 200);
    const a3 = pulse(dot3, 400);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.typingRow}>
      <Image source={COACH_AVATAR} style={styles.coachAvatarSmall} />
      <View style={styles.typingBubble}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View
            key={i}
            style={[
              styles.typingDot,
              {
                opacity: dot,
                transform: [
                  {
                    translateY: dot.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -4],
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function fitImageIntoBox(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
) {
  const widthRatio = maxWidth / sourceWidth;
  const heightRatio = maxHeight / sourceHeight;
  const scale = Math.min(widthRatio, heightRatio);

  return {
    width: Math.round(sourceWidth * scale),
    height: Math.round(sourceHeight * scale),
  };
}

function TransformationMessageImage({ imageUrl }: { imageUrl: string }) {
  const [dimensions, setDimensions] = useState({
    width: TRANSFORMATION_MAX_WIDTH,
    height: 280,
  });

  useEffect(() => {
    let active = true;
    Image.getSize(
      imageUrl,
      (width, height) => {
        if (!active || !width || !height) return;
        setDimensions(
          fitImageIntoBox(
            width,
            height,
            TRANSFORMATION_MAX_WIDTH,
            TRANSFORMATION_MAX_HEIGHT,
          ),
        );
      },
      () => {
        if (!active) return;
        setDimensions({
          width: TRANSFORMATION_MAX_WIDTH,
          height: 280,
        });
      },
    );

    return () => {
      active = false;
    };
  }, [imageUrl]);

  return (
    <View style={styles.transformationImageCard}>
      <Image
        source={{ uri: imageUrl }}
        style={[
          styles.transformationImage,
          {
            width: dimensions.width,
            height: dimensions.height,
          },
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

const WW_BLUE = '#0EA5E9';
const WW_BLUE_BORDER = 'rgba(14,165,233,0.3)';

type MessageBubbleProps = {
  message: DMMessage;
  showAvatar: boolean;
  activeQuickReplies: boolean;
  onQuickReply: (value: string, label: string) => void;
  accentColor: string;
  accentBorderColor: string;
};

function MessageBubble({
  message,
  showAvatar,
  activeQuickReplies,
  onQuickReply,
  accentColor,
  accentBorderColor,
}: MessageBubbleProps) {
  const isCoach = message.role === 'coach';

  if (message.kind === 'image' && message.imageUrl) {
    return (
      <View style={styles.coachMessageRow}>
        {showAvatar ? (
          <Image source={COACH_AVATAR} style={styles.coachAvatarSmall} />
        ) : (
          <View style={styles.coachAvatarSpacer} />
        )}
        <TransformationMessageImage imageUrl={message.imageUrl} />
      </View>
    );
  }

  if (message.kind === 'quickReplies') {
    return (
      <View style={styles.coachMessageRow}>
        {showAvatar ? (
          <Image source={COACH_AVATAR} style={styles.coachAvatarSmall} />
        ) : (
          <View style={styles.coachAvatarSpacer} />
        )}
        <View style={{ flex: 1 }}>
          {message.text ? (
            <View style={styles.coachBubble}>
              <Text style={styles.coachBubbleText}>{message.text}</Text>
            </View>
          ) : null}
          {activeQuickReplies && message.quickReplies ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.quickRepliesScroll}
              contentContainerStyle={styles.quickRepliesContent}
            >
              {message.quickReplies.map((qr) => (
                <Pressable
                  key={qr.value}
                  style={[styles.quickReplyChip, { borderColor: accentBorderColor }]}
                  onPress={() => onQuickReply(qr.value, qr.label)}
                >
                  <Text style={[styles.quickReplyChipText, { color: accentColor }]}>
                    {qr.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      </View>
    );
  }

  if (isCoach) {
    return (
      <View style={styles.coachMessageRow}>
        {showAvatar ? (
          <Image source={COACH_AVATAR} style={styles.coachAvatarSmall} />
        ) : (
          <View style={styles.coachAvatarSpacer} />
        )}
        <View style={styles.coachBubble}>
          <Text style={styles.coachBubbleText}>{message.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.userMessageRow}>
      <View style={[styles.userBubble, { backgroundColor: accentColor }]}>
        <Text style={styles.userBubbleText}>{message.text}</Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CoachDMScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<WalkWaterStackParamList>>();
  const route = useRoute<RouteProp<WalkWaterStackParamList, 'CoachDM'>>();
  const isReschedule = route.params?.reschedule === true;
  const isWW = route.params?.brand === 'ww';
  const theme = useTheme();
  const accentColor = isWW ? WW_BLUE : theme.accent;
  const accentBorderColor = isWW ? WW_BLUE_BORDER : theme.accentBorder;
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

  const flatListRef = useRef<FlatList<DMMessage>>(null);

  const [conversation, setConversation] = useState<DMConversationState | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [activeQuickReplyMessageId, setActiveQuickReplyMessageId] = useState<string | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    if (flatListRef.current && conversation?.messages.length) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [conversation?.messages.length]);

  const persistState = useCallback((state: DMConversationState) => {
    saveConversation(state).catch(() => null);
  }, []);

  /** Append a message and optionally advance the stage. */
  const appendMessage = useCallback(
    (
      prev: DMConversationState,
      message: DMMessage,
      nextStage?: DMStage,
    ): DMConversationState => {
      const updated: DMConversationState = {
        ...prev,
        messages: [...prev.messages, message],
        stage: nextStage ?? prev.stage,
      };
      return updated;
    },
    [],
  );

  /** Deliver a single coach message with a typing delay. */
  const deliverCoachMessage = useCallback(
    (
      message: DMMessage,
      typingDuration: number,
      nextStage?: DMStage,
    ): Promise<void> => {
      return new Promise((resolve) => {
        setIsTyping(true);
        setTimeout(() => {
          setIsTyping(false);
          setConversation((prev) => {
            if (!prev) return prev;
            const updated = appendMessage(prev, message, nextStage);
            persistState(updated);
            return updated;
          });
          // Activate quick replies for the last quickReply message
          if (message.kind === 'quickReplies') {
            setActiveQuickReplyMessageId(message.id);
          }
          setTimeout(scrollToBottom, 50);
          resolve();
        }, typingDuration);
      });
    },
    [appendMessage, persistState, scrollToBottom],
  );

  /** Deliver a sequence of messages one after another. */
  const deliverSequence = useCallback(
    async (
      messages: DMMessage[],
      durations: number[],
      finalStage?: DMStage,
    ): Promise<void> => {
      for (let i = 0; i < messages.length; i++) {
        const isLast = i === messages.length - 1;
        const stage = isLast ? finalStage : undefined;
        await deliverCoachMessage(messages[i], durations[i] ?? TYPING_SHORT, stage);
      }
    },
    [deliverCoachMessage],
  );

  // ── Initialization ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // --- Reschedule mode — preserve history, append new flow ---
      if (isReschedule) {
        // Load existing conversation so history is preserved
        const existing = await loadConversation();

        let userName = existing?.userName ?? 'there';
        // Prefer the live session ID over a stale cached value
        let userId = session?.user?.id ?? existing?.userId ?? 'anon';
        const userTimezone = existing?.userTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        let clientPhone = existing?.collected?.phone ?? '';
        let gender = existing?.gender ?? ('other' as DMConversationState['gender']);

        // Always re-read gender from current quiz/profile so reschedule picks up any updates
        try {
          const wwAnswers = await getWalkWaterQuizAnswers();
          if (wwAnswers?.gender) gender = wwAnswers.gender as DMConversationState['gender'];
          const rawProfile = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
          if (rawProfile) {
            const profile = JSON.parse(rawProfile) as UserProfile;
            if (profile.gender) gender = profile.gender as DMConversationState['gender'];
          }
        } catch { /* non-fatal — keep existing gender */ }

        if (!clientPhone) {
          try {
            const { data } = await supabase
              .from('coaching_fit_calls')
              .select('client_phone')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (data?.client_phone) clientPhone = data.client_phone;
          } catch { /* non-fatal */ }
        }

        // Build tomorrow's date string
        const tom = new Date();
        tom.setDate(tom.getDate() + 1);
        const pad = (n: number) => String(n).padStart(2, '0');
        const tomorrowStr = `${tom.getFullYear()}-${pad(tom.getMonth() + 1)}-${pad(tom.getDate())}`;

        // Start from existing messages, not empty
        const rescheduleState: DMConversationState = {
          ...(existing ?? {}),
          stage: 'reschedule_slot_selection',
          messages: existing?.messages ?? [],
          collected: { ...(existing?.collected ?? {}), phone: clientPhone, preferredDate: tomorrowStr },
          gender,
          userName,
          userId,
          userTimezone,
          silenceNotifIds: [],
        };

        if (cancelled) return;
        setConversation(rescheduleState);
        persistState(rescheduleState);

        setTimeout(async () => {
          if (cancelled) return;

          // Append user "I need to reschedule." to existing history
          const userMsg = makeMessage('user', 'text', { text: 'I need to reschedule.' });
          setConversation((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, messages: [...prev.messages, userMsg] };
            persistState(updated);
            return updated;
          });
          setTimeout(scrollToBottom, 50);

          // Fetch tomorrow's slots
          setIsLoadingSlots(true);
          let slots: string[] = [];
          try {
            const result = await fetchFitCallSlots(tomorrowStr, env.supabaseUrl, env.supabaseAnonKey, userTimezone);
            slots = result.slots.length ? result.slots : ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
          } catch {
            slots = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
          } finally {
            setIsLoadingSlots(false);
          }

          if (cancelled) return;
          const ackMsg = rescheduleAckMessage(slots, 'tomorrow');
          await deliverCoachMessage(ackMsg, TYPING_LONG, 'reschedule_slot_selection');
          if (cancelled) return;
          const ids = await scheduleSilenceFollowUps();
          setConversation((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, silenceNotifIds: ids };
            persistState(updated);
            return updated;
          });
        }, 400);
        return;
      }

      // --- Normal greeting mode ---
      const stored = await loadConversation();
      if (cancelled) return;

      if (stored) {
        // Always re-read gender from current quiz/profile answers so that
        // changing gender in the quiz updates the DM flow without needing
        // to clear the conversation from AsyncStorage.
        let freshGender = stored.gender;
        try {
          const wwAnswers = await getWalkWaterQuizAnswers();
          if (wwAnswers?.gender) freshGender = wwAnswers.gender as DMConversationState['gender'];
          const rawProfile = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
          if (rawProfile) {
            const profile = JSON.parse(rawProfile) as UserProfile;
            if (profile.gender) freshGender = profile.gender as DMConversationState['gender'];
          }
        } catch { /* non-fatal — keep stored gender */ }

        // Also prefer live session ID over a stale 'anon' cached value
        const liveId = session?.user?.id;
        const freshUserId = liveId ?? stored.userId;

        const loadedConversation =
          freshGender !== stored.gender || freshUserId !== stored.userId
            ? { ...stored, gender: freshGender, userId: freshUserId }
            : stored;

        if (loadedConversation !== stored) persistState(loadedConversation);
        setConversation(loadedConversation);

        const lastQR = [...loadedConversation.messages]
          .reverse()
          .find((m) => m.role === 'coach' && m.kind === 'quickReplies');
        if (lastQR) {
          const isInputStage = STAGES_WITH_FREE_INPUT.indexOf(loadedConversation.stage) !== -1;
          const isRescheduled = loadedConversation.stage === 'rescheduled';
          if (!isInputStage && !isRescheduled) {
            setActiveQuickReplyMessageId(lastQR.id);
          }
        }
        return;
      }

      let userName = 'there';
      // WW context defaults to 'lose_weight' so goalLabel always reads naturally
      // even when quiz answers were cleared by a dev tool reset
      let goal = isWW ? 'lose_weight' : 'lose';
      // WW is a female-skewed product — default to 'female' so any quiz/profile
      // read failure still shows the correct transformation photo for WW users.
      let gender: DMConversationState['gender'] = isWW ? 'female' : 'other';
      let userId = session?.user?.id ?? 'anon';
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      try {
        // WW quiz answers take priority — read first so they can override the profile goal
        if (isWW) {
          const wwAnswers = await getWalkWaterQuizAnswers();
          if (wwAnswers?.primaryGoal) goal = wwAnswers.primaryGoal;
          if (wwAnswers?.gender) gender = wwAnswers.gender as DMConversationState['gender'];
        }

        const rawProfile = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
        if (rawProfile) {
          const profile = JSON.parse(rawProfile) as UserProfile;
          if (profile.displayName) userName = profile.displayName.split(' ')[0];
          // For WW, only take the profile goal if it's a known WW goal key
          // so an old APEX profile ('lose', 'build', etc.) doesn't override the WW default
          if (!isWW && profile.goal) goal = profile.goal;
          if (isWW && profile.goal && ['lose_weight', 'more_energy', 'build_habit', 'feel_better'].includes(profile.goal)) {
            goal = profile.goal;
          }
          if (profile.gender) gender = profile.gender as DMConversationState['gender'];
        }

        // For APEX: also check WW quiz answers as a fallback (shouldn't normally be set)
        if (!isWW) {
          const wwAnswers = await getWalkWaterQuizAnswers();
          if (wwAnswers?.primaryGoal) goal = wwAnswers.primaryGoal;
          if (wwAnswers?.gender) gender = wwAnswers.gender as DMConversationState['gender'];
        }
      } catch { /* use defaults */ }

      // Fallback: WW sign-in path skips the profile write — read from Supabase auth metadata
      if (userName === 'there' && session?.user?.user_metadata?.display_name) {
        userName = String(session.user.user_metadata.display_name).split(' ')[0];
      }

      const initial: DMConversationState = {
        stage: 'greeting',
        messages: [],
        collected: { goal },
        gender,
        userName,
        userId,
        userTimezone,
        silenceNotifIds: [],
      };

      setConversation(initial);

      setTimeout(async () => {
        if (cancelled) return;
        const msgs = greetingMessages(userName, goal);
        await deliverSequence(msgs, [TYPING_LONG], 'greeting');
        if (!cancelled) {
          const ids = await scheduleSilenceFollowUps();
          setConversation((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, silenceNotifIds: ids };
            persistState(updated);
            return updated;
          });
        }
      }, 500);
    }

    init().catch(() => null);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── User reply handler ────────────────────────────────────────────────────

  const handleUserReply = useCallback(
    async (text: string) => {
      if (!conversation) return;
      const { stage, gender, collected } = conversation;

      // Cancel silence notifications on any user reply
      if (conversation.silenceNotifIds.length) {
        cancelSilenceFollowUps(conversation.silenceNotifIds).catch(() => null);
      }

      // Check for price objection at any point before booked
      if (stage !== 'booked' && hasPriceObjection(text)) {
        const userMsg = makeMessage('user', 'text', { text });
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, messages: [...prev.messages, userMsg], lastUserReplyAt: Date.now(), silenceNotifIds: [] };
          persistState(updated);
          return updated;
        });
        setInputText('');
        await deliverCoachMessage(priceObjectionMessage(), TYPING_LONG);

        // Re-ask whatever question was in play when the objection fired
        const reask = priceObjectionReaskMessage(stage);
        if (reask) {
          await deliverCoachMessage(reask, TYPING_SHORT);
        }

        // Re-schedule silence notifications after objection response
        const ids = await scheduleSilenceFollowUps();
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, silenceNotifIds: ids };
          persistState(updated);
          return updated;
        });
        return;
      }

      const userMsg = makeMessage('user', 'text', { text });

      // After booking/rescheduling — pass directly to real coach, no AI response
      if (STAGES_DIRECT_TO_COACH.includes(stage)) {
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, messages: [...prev.messages, userMsg], lastUserReplyAt: Date.now() };
          persistState(updated);
          return updated;
        });
        setInputText('');
        // Use live session ID; fall back to cached userId if it looks like a UUID.
        // Inserts for unauthenticated users fail RLS silently — that's fine.
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const dmUserId = session?.user?.id ?? (UUID_RE.test(conversation.userId ?? '') ? conversation.userId : null);
        supabase.from('coach_messages').insert({
          user_id: dmUserId ?? null,
          sender_role: 'user',
          content: text,
          sent_at: new Date().toISOString(),
        }).then(() => null, () => null);
        setTimeout(scrollToBottom, 50);
        return;
      }

      if (stage === 'reschedule_slot_selection') {
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            messages: [...prev.messages, userMsg],
            lastUserReplyAt: Date.now(),
            silenceNotifIds: [],
          };
          persistState(updated);
          return updated;
        });
        setInputText('');

        // Parse natural language date/time from user's message
        const parsed = parseRescheduleRequest(text);
        const pad = (n: number) => String(n).padStart(2, '0');
        const dateToCheck = parsed.date ?? (() => {
          const tm = new Date();
          tm.setDate(tm.getDate() + 1);
          return `${tm.getFullYear()}-${pad(tm.getMonth() + 1)}-${pad(tm.getDate())}`;
        })();

        // Get day label for coach's message
        const dateObj = new Date(`${dateToCheck}T12:00:00`);
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const todayStr = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`;
        const tomStr = (() => { const t = new Date(); t.setDate(t.getDate() + 1); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; })();
        const dateLabel = dateToCheck === todayStr ? 'today' : dateToCheck === tomStr ? 'tomorrow' : dayNames[dateObj.getDay()];

        setIsLoadingSlots(true);
        let allSlots: string[] = [];
        try {
          const result = await fetchFitCallSlots(dateToCheck, env.supabaseUrl, env.supabaseAnonKey, conversation.userTimezone);
          allSlots = result.slots.length ? result.slots : ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
        } catch {
          allSlots = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
        } finally {
          setIsLoadingSlots(false);
        }

        // Sort slots by proximity to requested hour
        let nearbySlots = allSlots;
        if (parsed.approxHour !== null) {
          const h = parsed.approxHour;
          nearbySlots = [...allSlots]
            .sort((a, b) => Math.abs(parseInt(a) - h) - Math.abs(parseInt(b) - h))
            .slice(0, 5);
        }

        // Store the new preferred date
        setConversation((prev) => {
          if (!prev) return prev;
          return { ...prev, collected: { ...prev.collected, preferredDate: dateToCheck } };
        });

        await deliverCoachMessage(rescheduleFollowUpMessage(nearbySlots, dateLabel), TYPING_SHORT, 'reschedule_slot_selection');
        const ids = await scheduleSilenceFollowUps();
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, silenceNotifIds: ids };
          persistState(updated);
          return updated;
        });
        return;
      }

      if (stage === 'greeting') {
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, messages: [...prev.messages, userMsg], lastUserReplyAt: Date.now(), silenceNotifIds: [] };
          persistState(updated);
          return updated;
        });
        setInputText('');
        await deliverCoachMessage(greetingReplyMessage(), TYPING_LONG, 'awaiting_diet');
        const ids = await scheduleSilenceFollowUps();
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, silenceNotifIds: ids };
          persistState(updated);
          return updated;
        });
        return;
      }

      if (stage === 'awaiting_diet') {
        // If user just acknowledged without giving real diet info, re-ask
        if (isAcknowledgmentOnly(text)) {
          setConversation((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, messages: [...prev.messages, userMsg], lastUserReplyAt: Date.now(), silenceNotifIds: [] };
            persistState(updated);
            return updated;
          });
          setInputText('');
          await deliverCoachMessage(
            makeMessage('coach', 'text', { text: 'What does your current nutrition & workout routine look like now?' }),
            TYPING_SHORT,
            'awaiting_diet',
          );
          const ids = await scheduleSilenceFollowUps();
          setConversation((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, silenceNotifIds: ids };
            persistState(updated);
            return updated;
          });
          return;
        }

        setConversation((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            messages: [...prev.messages, userMsg],
            collected: { ...prev.collected, dietHabits: text },
            lastUserReplyAt: Date.now(),
            silenceNotifIds: [],
          };
          persistState(updated);
          return updated;
        });
        setInputText('');
        const proofMsgs = socialProofMessages(gender);
        await deliverSequence(
          proofMsgs,
          [TYPING_LONG, TYPING_IMAGE],
          'social_proof',
        );
        const challengeMsg = challengeQuestionMessage();
        await deliverCoachMessage(challengeMsg, TYPING_SHORT, 'awaiting_challenge');
        // Re-schedule silence notifications
        const ids = await scheduleSilenceFollowUps();
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, silenceNotifIds: ids };
          persistState(updated);
          return updated;
        });
        return;
      }

      if (stage === 'awaiting_challenge') {
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            messages: [...prev.messages, userMsg],
            collected: { ...prev.collected, biggestChallenge: text },
            lastUserReplyAt: Date.now(),
            silenceNotifIds: [],
          };
          persistState(updated);
          return updated;
        });
        setInputText('');
        const dayMsg = daySelectionMessage(conversation.collected.biggestChallenge ?? text);
        await deliverCoachMessage(dayMsg, TYPING_LONG, 'day_selection');
        // Re-schedule silence notifications
        const ids = await scheduleSilenceFollowUps();
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, silenceNotifIds: ids };
          persistState(updated);
          return updated;
        });
        return;
      }

      if (stage === 'phone_collection') {
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            messages: [...prev.messages, userMsg],
            collected: { ...prev.collected, phone: text },
            lastUserReplyAt: Date.now(),
            silenceNotifIds: [],
          };
          persistState(updated);
          return updated;
        });
        setInputText('');
        // Book the call
        await handleBookCall(text);
        return;
      }
    },
    [conversation, deliverCoachMessage, deliverSequence, persistState, session],
  );

  // ── Realtime: show incoming coach messages after booking ──────────────────

  useEffect(() => {
    const userId = session?.user?.id;
    const stage = conversation?.stage;
    if (!userId || !stage || !STAGES_DIRECT_TO_COACH.includes(stage)) return;

    // Load any coach messages already in DB that aren't yet in local state
    supabase
      .from('coach_messages')
      .select('sender_role, content, sent_at')
      .eq('user_id', userId)
      .eq('sender_role', 'coach')
      .order('sent_at', { ascending: true })
      .then(({ data }) => {
        if (!data?.length) return;
        setConversation((prev) => {
          if (!prev) return prev;
          const existingMs = new Set(prev.messages.map((m) => m.createdAt));
          const incoming = data
            .filter((row) => !existingMs.has(new Date(row.sent_at).getTime()))
            .map((row) => ({
              ...makeMessage('coach', 'text', { text: row.content }),
              createdAt: new Date(row.sent_at).getTime(),
            }));
          if (!incoming.length) return prev;
          const merged = [...prev.messages, ...incoming].sort((a, b) => a.createdAt - b.createdAt);
          const updated = { ...prev, messages: merged };
          persistState(updated);
          return updated;
        });
        setTimeout(scrollToBottom, 80);
      })
      .catch(() => null);

    // Subscribe to new coach messages in real time
    const channel = supabase
      .channel(`dm-coach-replies-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'coach_messages',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { sender_role: string; content: string; sent_at: string };
          if (row.sender_role !== 'coach') return;
          const coachMsg = {
            ...makeMessage('coach', 'text', { text: row.content }),
            createdAt: new Date(row.sent_at).getTime(),
          };
          setConversation((prev) => {
            if (!prev) return prev;
            // Deduplicate by timestamp in case the initial load already caught this
            if (prev.messages.some((m) => m.createdAt === coachMsg.createdAt)) return prev;
            const updated = { ...prev, messages: [...prev.messages, coachMsg] };
            persistState(updated);
            return updated;
          });
          setTimeout(scrollToBottom, 50);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.stage, session?.user?.id, persistState, scrollToBottom]);

  // ── Quick reply handler ───────────────────────────────────────────────────

  const handleQuickReply = useCallback(
    async (value: string, label: string) => {
      if (!conversation) return;
      const { stage, collected, userId, userName, userTimezone } = conversation;

      // Deactivate quick replies immediately
      setActiveQuickReplyMessageId(null);

      // Cancel silence notifications
      if (conversation.silenceNotifIds.length) {
        cancelSilenceFollowUps(conversation.silenceNotifIds).catch(() => null);
      }

      // Social links — open and return (do not advance stage)
      if (value === 'tiktok') {
        Linking.openURL('https://www.tiktok.com/@bodybyreasonbbr').catch(() => null);
        return;
      }
      if (value === 'instagram') {
        Linking.openURL('https://instagram.com/BodyByReason').catch(() => null);
        return;
      }

      // PDF links — open in-app viewer
      if (value.startsWith('pdf:')) {
        const pdfUrl = value.slice(4);
        navigation.navigate('PDFViewer', { url: pdfUrl, title: label.replace(/^[^\w]+/, '').trim() });
        return;
      }

      // Female resource offer responses
      if (value === 'send_resources') {
        const userMsg = makeMessage('user', 'text', { text: label });
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            messages: [...prev.messages, userMsg],
            lastUserReplyAt: Date.now(),
          };
          persistState(updated);
          return updated;
        });
        setTimeout(scrollToBottom, 50);
        const msgs = resourceMessages(conversation.collected.preferredDate);
        await deliverSequence(msgs, [TYPING_SHORT, TYPING_SHORT, TYPING_SHORT], 'booked');
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            collected: { ...prev.collected, resourcesSent: true },
          };
          persistState(updated);
          return updated;
        });
        return;
      }

      if (value === 'resources_later') {
        const userMsg = makeMessage('user', 'text', { text: label });
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            messages: [...prev.messages, userMsg],
            stage: 'booked' as DMStage,
            lastUserReplyAt: Date.now(),
          };
          persistState(updated);
          return updated;
        });
        setTimeout(scrollToBottom, 50);
        await deliverCoachMessage(
          makeMessage('coach', 'text', { text: 'No worries! Just let me know when you\'re ready 😊 speak more then.' }),
          TYPING_SHORT,
          'booked',
        );
        return;
      }

      const userMsg = makeMessage('user', 'text', { text: label });

      if (stage === 'reschedule_slot_selection') {
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            messages: [...prev.messages, userMsg],
            collected: { ...prev.collected, preferredTime: value },
            lastUserReplyAt: Date.now(),
            silenceNotifIds: [],
          };
          persistState(updated);
          return updated;
        });
        setTimeout(scrollToBottom, 50);
        await handleRescheduleBook(value);
        return;
      }

      if (stage === 'day_selection') {
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            messages: [...prev.messages, userMsg],
            collected: { ...prev.collected, preferredDate: value },
            lastUserReplyAt: Date.now(),
            silenceNotifIds: [],
          };
          persistState(updated);
          return updated;
        });
        setTimeout(scrollToBottom, 50);

        // Fetch slots
        setIsLoadingSlots(true);
        try {
          const result = await fetchFitCallSlots(
            value,
            env.supabaseUrl,
            env.supabaseAnonKey,
            userTimezone,
          );
          const slots = result.slots.length
            ? result.slots
            : ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
          setIsLoadingSlots(false);
          const timeMsg = timeSelectionMessage(slots);
          await deliverCoachMessage(timeMsg, TYPING_SHORT, 'time_selection');
        } catch {
          setIsLoadingSlots(false);
          const fallbackSlots = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
          const timeMsg = timeSelectionMessage(fallbackSlots);
          await deliverCoachMessage(timeMsg, TYPING_SHORT, 'time_selection');
        }

        // Re-schedule silence notifications
        const ids = await scheduleSilenceFollowUps();
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, silenceNotifIds: ids };
          persistState(updated);
          return updated;
        });
        return;
      }

      if (stage === 'time_selection') {
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            messages: [...prev.messages, userMsg],
            collected: { ...prev.collected, preferredTime: value },
            lastUserReplyAt: Date.now(),
            silenceNotifIds: [],
          };
          persistState(updated);
          return updated;
        });
        setTimeout(scrollToBottom, 50);
        await deliverCoachMessage(phoneCollectionMessage(), TYPING_SHORT, 'phone_collection');
        // Re-schedule silence notifications
        const ids = await scheduleSilenceFollowUps();
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, silenceNotifIds: ids };
          persistState(updated);
          return updated;
        });
        return;
      }
    },
    [conversation, deliverCoachMessage, deliverSequence, handleRescheduleBook, navigation, persistState, scrollToBottom],
  );

  // ── Book call ─────────────────────────────────────────────────────────────

  const handleBookCall = useCallback(
    async (phone: string) => {
      if (!conversation) return;
      const { collected, userName, userId, userTimezone } = conversation;

      // Prefer the live session ID over a stale cached value (e.g. 'anon' from
      // a race condition during auth loading). The edge function validates UUID
      // format and stores null if invalid, so sending the best available ID is safe.
      const safeUserId = session?.user?.id ?? userId;

      // Update the cached userId in state so future calls use the correct value
      if (safeUserId !== userId) {
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, userId: safeUserId };
          persistState(updated);
          return updated;
        });
      }

      try {
        const result = await bookFitCall({
          userId: safeUserId,
          clientName: userName,
          clientPhone: phone,
          challenge: collected.biggestChallenge ?? '',
          date: collected.preferredDate ?? '',
          time: collected.preferredTime ?? '',
          supabaseUrl: env.supabaseUrl,
          supabaseAnonKey: env.supabaseAnonKey,
          userTimezone,
          goal: collected.goal,
          dietHabits: collected.dietHabits,
        });

        if (result.ok) {
          setConversation((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, bookingId: result.bookingId, stage: 'booked' as DMStage, silenceNotifIds: [] };
            persistState(updated);
            return updated;
          });
          const confirmMsgs = bookingConfirmationMessages(conversation.gender);
          const confirmStage = conversation.gender === 'female' ? 'awaiting_resources' : 'booked';
          await deliverSequence(confirmMsgs, [TYPING_LONG, TYPING_SHORT], confirmStage);

          // Mirror the full DM conversation to coach_messages so it's visible
          // in the coach inbox thread. Only insert messages newer than the latest
          // already stored (safe on reschedule — avoids duplicates).
          const allMessages = conversation.messages;
          if (safeUserId && allMessages.length > 0) {
            supabase
              .from('coach_messages')
              .select('sent_at')
              .eq('user_id', safeUserId)
              .order('sent_at', { ascending: false })
              .limit(1)
              .maybeSingle()
              .then(({ data }) => {
                const cutoffMs = data?.sent_at ? new Date(data.sent_at).getTime() : 0;
                const rows = allMessages
                  .filter((m) => m.createdAt > cutoffMs)
                  .map((m) => {
                    const content =
                      m.text?.trim() ||
                      (m.kind === 'image' ? '📸 Transformation photo' : '') ||
                      (m.quickReplies?.length ? m.quickReplies.map((r) => r.label).join(' · ') : '');
                    if (!content) return null;
                    return {
                      user_id: safeUserId,
                      coach_id: null as string | null,
                      sender_role: m.role === 'user' ? 'user' : 'coach',
                      content,
                      sent_at: new Date(m.createdAt).toISOString(),
                    };
                  })
                  .filter((r): r is NonNullable<typeof r> => r !== null);
                if (rows.length > 0) {
                  supabase.from('coach_messages').insert(rows).then(() => null, () => null);
                }
              })
              .catch(() => null);
          }

          // Schedule morning reminder and store ID for later cancellation
          if (collected.preferredDate && collected.preferredTime) {
            scheduleMorningReminder(collected.preferredDate, collected.preferredTime)
              .then((reminderId) => {
                if (!reminderId) return;
                setConversation((prev) => {
                  if (!prev) return prev;
                  const updated = { ...prev, morningReminderId: reminderId };
                  persistState(updated);
                  return updated;
                });
              })
              .catch(() => null);
          }
        } else {
          setConversation((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, silenceNotifIds: [] };
            persistState(updated);
            return updated;
          });
          await deliverCoachMessage(bookingErrorMessage(), TYPING_SHORT);
        }
      } catch {
        setConversation((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, silenceNotifIds: [] };
          persistState(updated);
          return updated;
        });
        await deliverCoachMessage(bookingErrorMessage(), TYPING_SHORT);
      }
    },
    [conversation, deliverCoachMessage, deliverSequence, persistState, session],
  );

  // ── Reschedule book ───────────────────────────────────────────────────────

  const handleRescheduleBook = useCallback(
    async (time: string) => {
      if (!conversation) return;
      const { collected, userName, userId, userTimezone } = conversation;
      try {
        const result = await bookFitCall({
          userId,
          clientName: userName,
          clientPhone: collected.phone ?? '',
          challenge: 'Rescheduled call',
          date: collected.preferredDate ?? '',
          time,
          supabaseUrl: env.supabaseUrl,
          supabaseAnonKey: env.supabaseAnonKey,
          userTimezone,
        });
        if (result.ok) {
          setConversation((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, bookingId: result.bookingId, stage: 'rescheduled' as DMStage, silenceNotifIds: [] };
            persistState(updated);
            return updated;
          });
          await deliverCoachMessage(rescheduleConfirmMessage(), TYPING_LONG, 'rescheduled');
          if (collected.preferredDate) {
            scheduleMorningReminder(collected.preferredDate, time).catch(() => null);
          }
        } else {
          await deliverCoachMessage(bookingErrorMessage(), TYPING_SHORT);
        }
      } catch {
        await deliverCoachMessage(bookingErrorMessage(), TYPING_SHORT);
      }
    },
    [conversation, deliverCoachMessage, persistState],
  );

  // ── Derived state ─────────────────────────────────────────────────────────

  const showInput = useMemo(() => {
    if (!conversation) return false;
    return (
      STAGES_WITH_FREE_INPUT.includes(conversation.stage) ||
      STAGES_DIRECT_TO_COACH.includes(conversation.stage)
    );
  }, [conversation]);

  const isDirectToCoach = useMemo(
    () => !!conversation && STAGES_DIRECT_TO_COACH.includes(conversation.stage),
    [conversation],
  );

  const messages = conversation?.messages ?? [];

  // ── Render ────────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item, index }: { item: DMMessage; index: number }) => {
      const prevMsg = index > 0 ? messages[index - 1] : null;
      const showAvatar =
        item.role === 'coach' && (!prevMsg || prevMsg.role !== 'coach');
      const isActiveQR =
        item.id === activeQuickReplyMessageId && item.kind === 'quickReplies';

      return (
        <MessageBubble
          message={item}
          showAvatar={showAvatar}
          activeQuickReplies={isActiveQR}
          onQuickReply={handleQuickReply}
          accentColor={accentColor}
          accentBorderColor={accentBorderColor}
        />
      );
    },
    [messages, activeQuickReplyMessageId, handleQuickReply, accentColor, accentBorderColor],
  );

  const keyExtractor = useCallback((item: DMMessage) => item.id, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Image source={COACH_AVATAR} style={styles.headerAvatar} />
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>Joshua Saunders</Text>
          <Text style={styles.headerSubtitle}>APEX Head Coach · Swoldier Nation</Text>
        </View>
        <Pressable
          style={styles.headerClose}
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={styles.headerCloseText}>✕</Text>
        </Pressable>
      </View>

      {/* ── Message list ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToBottom}
          onLayout={scrollToBottom}
          ListFooterComponent={
            <>
              {isTyping ? <TypingIndicator /> : null}
              {isLoadingSlots ? (
                <View style={styles.loadingRow}>
                  <Text style={styles.loadingText}>Checking availability…</Text>
                </View>
              ) : null}
            </>
          }
        />

        {/* ── Input bar ── */}
        {showInput ? (
          <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
            {isDirectToCoach ? (
              <View style={styles.directCoachBanner}>
                <Text style={[styles.directCoachBannerText, { color: accentColor }]}>💬 Messages go directly to your coach</Text>
              </View>
            ) : null}
            <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder={
                conversation?.stage === 'phone_collection'
                  ? 'Your phone number…'
                  : isDirectToCoach
                  ? 'Message your coach…'
                  : 'Type a message…'
              }
              placeholderTextColor={C.muted}
              multiline={conversation?.stage !== 'phone_collection'}
              returnKeyType={conversation?.stage === 'phone_collection' ? 'done' : 'send'}
              blurOnSubmit
              onSubmitEditing={() => {
                const trimmed = inputText.trim();
                if (trimmed) handleUserReply(trimmed).catch(() => null);
              }}
              keyboardType={
                conversation?.stage === 'phone_collection' ? 'phone-pad' : 'default'
              }
            />
            <Pressable
              style={[
                styles.sendButton,
                inputText.trim() ? { backgroundColor: accentColor } : null,
                !inputText.trim() ? styles.sendButtonDisabled : null,
              ]}
              onPress={() => {
                const trimmed = inputText.trim();
                if (trimmed) handleUserReply(trimmed).catch(() => null);
              }}
              disabled={!inputText.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              <Text style={styles.sendButtonText}>↑</Text>
            </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ height: insets.bottom }} />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.dark,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    fontFamily: 'DMSans_700Bold',
  },
  headerSubtitle: {
    fontSize: 12,
    color: C.muted,
    marginTop: 1,
    fontFamily: 'DMSans_400Regular',
  },
  headerClose: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: C.card,
  },
  headerCloseText: {
    fontSize: 14,
    color: C.muted,
    fontWeight: '600',
  },

  // List
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 16,
    paddingBottom: 8,
  },

  // Coach message row
  coachMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 6,
    maxWidth: '85%',
  },
  coachAvatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
    marginBottom: 2,
  },
  coachAvatarSpacer: {
    width: 36,
  },
  coachBubble: {
    backgroundColor: '#1c1c1c',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '100%',
  },
  coachBubbleText: {
    fontSize: 15,
    color: '#ffffff',
    lineHeight: 21,
    fontFamily: 'DMSans_400Regular',
  },

  // User message row
  userMessageRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 6,
  },
  userBubble: {
    backgroundColor: C.green,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '75%',
  },
  userBubbleText: {
    fontSize: 15,
    color: '#000000',
    lineHeight: 21,
    fontFamily: 'DMSans_400Regular',
  },

  // Transformation image
  transformationImageCard: {
    backgroundColor: '#121212',
    borderRadius: 14,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transformationImage: {
    borderRadius: 14,
  },

  // Quick replies
  quickRepliesScroll: {
    marginTop: 8,
  },
  quickRepliesContent: {
    paddingRight: 12,
    gap: 8,
    flexDirection: 'row',
  },
  quickReplyChip: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  quickReplyChipText: {
    fontSize: 14,
    color: C.green,
    fontFamily: 'DMSans_500Medium',
  },

  // Typing indicator
  typingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 6,
    marginLeft: 12,
  },
  typingBubble: {
    backgroundColor: '#1c1c1c',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: C.muted,
  },

  // Loading
  loadingRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 13,
    color: C.muted,
    fontStyle: 'italic',
    fontFamily: 'DMSans_400Regular',
  },

  // Input bar
  inputBar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.dark,
  },
  directCoachBanner: {
    paddingVertical: 5,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  directCoachBannerText: {
    fontSize: 11,
    color: C.green,
    fontFamily: 'DMSans_500Medium',
    textAlign: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    maxHeight: 120,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: C.subtle,
  },
  sendButtonText: {
    fontSize: 18,
    color: '#000000',
    fontWeight: '700',
  },
});

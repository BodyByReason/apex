import React, { useEffect, useState } from 'react';

import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { loadSuggestionCycleState, type Suggestion } from '@/lib/suggestions';
import { supabase } from '@/lib/supabase';
import { apexColors as C } from '@/theme/colors';

export default function SuggestionsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [activeSuggestion, setActiveSuggestion] = useState<Suggestion | null>(null);
  const [minutesRemaining, setMinutesRemaining] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [userVoted, setUserVoted] = useState(false);
  const [voteCount, setVoteCount] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const state = await loadSuggestionCycleState(session?.user?.id);
      setActiveSuggestion(state.activeSuggestion);
      setMinutesRemaining(state.minutesRemaining);
      setQueueCount(state.queueCount);
      setUserVoted(state.userVoted);
      setVoteCount(state.voteCount);
    } catch (error) {
      Alert.alert('Suggestions unavailable', error instanceof Error ? error.message : 'Try again.');
    }
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [session?.user?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      load().catch(() => null);
    }, 30_000);

    return () => clearInterval(interval);
  }, [session?.user?.id]);

  const handleSubmit = async () => {
    if (!title.trim() || !session?.user?.id || submitting) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);

    // ── AI moderation ──────────────────────────────────────────────────────────
    // Screen the suggestion with Claude before it hits the feed.
    // Expects JSON: { "approved": true|false, "reason": "..." }
    try {
      const { data: modData, error: modError } = await supabase.functions.invoke('anthropic', {
        body: {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 128,
          system:
            'You are a content moderator for APEX, a fitness app. ' +
            'Evaluate the feature request below and decide if it should be shown to the community. ' +
            'Reject it if it is: spam, offensive, completely unrelated to fitness or the app, or gibberish. ' +
            'Approve anything that is a genuine fitness/app improvement idea, even if niche or unusual. ' +
            'Reply with ONLY valid JSON: {"approved":true,"reason":""} or {"approved":false,"reason":"one sentence explanation for the user"}',
          messages: [{ role: 'user', content: title.trim() }],
        },
      });

      if (!modError && modData) {
        const text: string =
          (modData as { content: Array<{ text: string }> }).content?.[0]?.text?.trim() ?? '';
        try {
          const parsed = JSON.parse(text) as { approved: boolean; reason: string };
          if (!parsed.approved) {
            setSubmitting(false);
            Alert.alert(
              "We couldn't post that",
              parsed.reason ||
                'Your suggestion was flagged as off-topic or inappropriate. Try rephrasing it as a fitness or app feature idea.',
            );
            return;
          }
        } catch {
          // JSON parse failed — fall through and allow the post (fail open)
        }
      }
    } catch {
      // Network/function error — fail open so users aren't blocked
    }
    // ── End moderation ─────────────────────────────────────────────────────────

    const { error } = await supabase.from('suggestions').insert({
      title: title.trim(),
      user_id: session.user.id,
    });
    setSubmitting(false);
    if (error) {
      Alert.alert('Could not submit', error.message);
      return;
    }
    setTitle('');
    await load();
  };

  const toggleVote = async () => {
    if (!session?.user?.id || !activeSuggestion) return;
    await Haptics.selectionAsync();
    if (userVoted) {
      const { error } = await supabase
        .from('suggestion_votes')
        .delete()
        .eq('suggestion_id', activeSuggestion.id)
        .eq('user_id', session.user.id);
      if (error) {
        Alert.alert('Vote failed', error.message);
        return;
      }
    } else {
      const { error } = await supabase.from('suggestion_votes').insert({
        suggestion_id: activeSuggestion.id,
        user_id: session.user.id,
      });
      if (error) {
        Alert.alert('Vote failed', error.message);
        return;
      }
    }
    await load();
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t('suggestions.title')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>{t('suggestions.subtitle')}</Text>
        {!loading && activeSuggestion ? (
          <Text style={styles.helper}>One feature is live at a time. {voteCount}/5 votes · {minutesRemaining} min left · {queueCount} queued next.</Text>
        ) : null}

        <View style={styles.composeCard}>
          <TextInput
            style={styles.input}
            placeholder={t('suggestions.placeholder')}
            placeholderTextColor={C.muted}
            value={title}
            onChangeText={setTitle}
          />
          <Pressable
            style={[styles.submitBtn, (!title.trim() || submitting) ? { opacity: 0.6 } : null]}
            onPress={handleSubmit}
            disabled={!title.trim() || submitting}
          >
            <Text style={styles.submitText}>{t('suggestions.submit')}</Text>
          </Pressable>
        </View>

        {loading ? <Text style={styles.helper}>Loading ideas...</Text> : null}
        {!loading && !activeSuggestion ? <Text style={styles.helper}>No live feature vote right now. Add a new suggestion to start the next round.</Text> : null}

        {activeSuggestion ? (
          <View key={activeSuggestion.id} style={styles.card}>
            <Text style={styles.cardTitle}>{activeSuggestion.title}</Text>
            <Text style={styles.cardMeta}>{voteCount}/5 votes · {minutesRemaining} min remaining</Text>
            <Pressable
              style={[styles.voteBtn, userVoted ? styles.voteBtnActive : null]}
              onPress={() => toggleVote().catch(() => null)}
            >
              <Text style={[styles.voteText, userVoted ? styles.voteTextActive : null]}>
                {userVoted ? '▲ Voted' : '△ Upvote'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: 'rgba(8,8,8,0.95)',
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 4, minWidth: 60 },
  backText: { color: C.green, fontFamily: 'DMSans_400Regular', fontSize: 14 },
  headerTitle: { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 22, letterSpacing: 3 },
  scroll: { flex: 1 },
  content: { padding: 14, paddingBottom: 40 },
  subtitle: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, marginBottom: 12 },
  composeCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.dark,
    color: C.text,
    paddingHorizontal: 14,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },
  submitBtn: {
    marginTop: 10,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 14 },
  helper: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 13, marginTop: 6 },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 21 },
  cardMeta: { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 10, marginTop: 8 },
  voteBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.dark,
  },
  voteBtnActive: {
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
  },
  voteText: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  voteTextActive: { color: C.green },
});

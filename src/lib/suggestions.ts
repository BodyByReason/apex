import { supabase } from '@/lib/supabase';

export type Suggestion = {
  created_at: string;
  id: string;
  status: 'open' | 'planned' | 'shipped';
  title: string;
  user_id: string;
};

export type SuggestionVote = {
  suggestion_id: string;
  user_id: string;
};

export type SuggestionCycleState = {
  activeSuggestion: Suggestion | null;
  minutesRemaining: number;
  queueCount: number;
  userVoted: boolean;
  voteCount: number;
};

const REQUIRED_VOTES = 5;
const WINDOW_MINUTES = 60;

async function fetchSuggestionsAndVotes() {
  const [{ data: suggestionData, error: suggestionError }, { data: voteData, error: voteError }] = await Promise.all([
    supabase
      .from('suggestions')
      .select('id, title, user_id, created_at, status')
      .in('status', ['open', 'planned', 'shipped'])
      .order('created_at', { ascending: true }),
    supabase.from('suggestion_votes').select('suggestion_id, user_id'),
  ]);

  if (suggestionError || voteError) {
    throw new Error(suggestionError?.message || voteError?.message || 'Could not load feature voting.');
  }

  return {
    suggestions: ((suggestionData as Suggestion[]) ?? []).filter((item) => item.status === 'open'),
    votes: (voteData as SuggestionVote[]) ?? [],
  };
}

export async function loadSuggestionCycleState(userId?: string): Promise<SuggestionCycleState> {
  let { suggestions, votes } = await fetchSuggestionsAndVotes();

  while (suggestions.length > 0) {
    const current = suggestions[0];
    const currentVotes = votes.filter((vote) => vote.suggestion_id === current.id);
    const voteCount = currentVotes.length;
    const ageMs = Date.now() - new Date(current.created_at).getTime();
    const expired = ageMs >= WINDOW_MINUTES * 60 * 1000;

    if (voteCount >= REQUIRED_VOTES) {
      await supabase.from('suggestions').update({ status: 'planned' }).eq('id', current.id);
      suggestions = suggestions.slice(1);
      continue;
    }

    if (expired) {
      await supabase.from('suggestions').delete().eq('id', current.id);
      suggestions = suggestions.slice(1);
      votes = votes.filter((vote) => vote.suggestion_id !== current.id);
      continue;
    }

    return {
      activeSuggestion: current,
      minutesRemaining: Math.max(0, WINDOW_MINUTES - Math.floor(ageMs / 60000)),
      queueCount: Math.max(0, suggestions.length - 1),
      userVoted: Boolean(userId && currentVotes.some((vote) => vote.user_id === userId)),
      voteCount,
    };
  }

  return {
    activeSuggestion: null,
    minutesRemaining: 0,
    queueCount: 0,
    userVoted: false,
    voteCount: 0,
  };
}

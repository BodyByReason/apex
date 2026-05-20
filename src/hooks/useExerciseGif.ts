/**
 * useExerciseGif.ts
 *
 * Returns a YouTube thumbnail URL + video ID for an exercise.
 *
 * Priority order:
 *  1. providedYoutubeId — hardcoded on the exercise; uses img.youtube.com, no API needed.
 *  2. AsyncStorage cache — result from a previous successful API search.
 *  3. YouTube Search API — falls back to this only when neither of the above exists.
 *
 * Thumbnail URL format (no API key required):
 *   https://img.youtube.com/vi/{videoId}/hqdefault.jpg
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from '@/lib/env';

const CACHE_PREFIX = 'apex.ww.exerciseYT.';

export type ExerciseMediaState = {
  gifUrl:   string | null; // YouTube thumbnail used as preview image
  videoId:  string | null; // YouTube video ID used for in-app WebView player
  loading:  boolean;
};

function thumbnailFromId(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export function useExerciseGif(
  exerciseDbName: string,
  providedYoutubeId?: string,
): ExerciseMediaState {
  const [state, setState] = useState<ExerciseMediaState>({
    gifUrl: null, videoId: null, loading: true,
  });

  useEffect(() => {
    if (!exerciseDbName && !providedYoutubeId) {
      setState({ gifUrl: null, videoId: null, loading: false });
      return;
    }

    // Fast path: hardcoded ID — derive thumbnail immediately, no network needed.
    if (providedYoutubeId) {
      setState({
        gifUrl: thumbnailFromId(providedYoutubeId),
        videoId: providedYoutubeId,
        loading: false,
      });
      return;
    }

    let cancelled = false;
    const cacheKey = `${CACHE_PREFIX}${exerciseDbName.toLowerCase().replace(/\s+/g, '-')}`;

    async function fetchMedia() {
      // Check cache before hitting the network.
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { gifUrl: string; videoId: string };
          if (parsed.videoId) {
            if (!cancelled) setState({ ...parsed, loading: false });
            return;
          }
        }
      } catch {
        // cache miss — continue
      }

      // No API key configured — give up gracefully.
      if (!env.youtubeApiKey) {
        if (!cancelled) setState({ gifUrl: null, videoId: null, loading: false });
        return;
      }

      try {
        const query = encodeURIComponent(`${exerciseDbName} exercise how to`);
        const res = await globalThis.fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=1&key=${env.youtubeApiKey}`,
        );

        if (!res.ok) {
          // 403 = quota exceeded or key restricted; 400 = bad key. Don't cache.
          if (!cancelled) setState({ gifUrl: null, videoId: null, loading: false });
          return;
        }

        const data = await res.json() as {
          items?: Array<{
            id?: { videoId?: string };
            snippet?: { thumbnails?: { maxres?: { url?: string }; high?: { url?: string } } };
          }>;
        };

        const item    = data?.items?.[0];
        const videoId = item?.id?.videoId ?? null;
        const gifUrl  = videoId
          ? thumbnailFromId(videoId)
          : (item?.snippet?.thumbnails?.maxres?.url ?? item?.snippet?.thumbnails?.high?.url ?? null);

        if (videoId) {
          await AsyncStorage.setItem(cacheKey, JSON.stringify({ gifUrl, videoId })).catch(() => null);
        }

        if (!cancelled) setState({ gifUrl, videoId, loading: false });
      } catch {
        if (!cancelled) setState({ gifUrl: null, videoId: null, loading: false });
      }
    }

    fetchMedia();
    return () => { cancelled = true; };
  }, [exerciseDbName, providedYoutubeId]);

  return state;
}

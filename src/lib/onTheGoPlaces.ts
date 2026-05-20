import { env } from '@/lib/env';

export type OnTheGoSuggestion = {
  addressHint: string;
  bestFor: string;
  coachNote: string;
  distanceHint: string;
  googleMapsUri?: string;
  id: string;
  macros: string;
  placeType: string;
  ratingText?: string;
  reviewsUrl?: string;
  title: string;
  venue: string;
  websiteUri?: string;
};

type EnrichInput = {
  suggestions: OnTheGoSuggestion[];
  zipCode?: string;
};

type GooglePlaceSearchResponse = {
  places?: Array<{
    displayName?: { text?: string };
    formattedAddress?: string;
    googleMapsUri?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
    primaryTypeDisplayName?: { text?: string };
  }>;
};

function getGooglePlacesApiKey() {
  return env.googlePlacesApiKey.trim();
}

function buildRatingText(rating?: number, count?: number) {
  if (typeof rating !== 'number') return undefined;
  const rounded = rating.toFixed(1);
  if (typeof count === 'number' && count > 0) {
    return `${rounded} ★ · ${count.toLocaleString()} reviews`;
  }
  return `${rounded} ★`;
}

async function searchVenue(venue: string, zipCode?: string) {
  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) return null;

  const textQuery = `${venue}${zipCode?.trim() ? ` near ${zipCode.trim()}` : ''}`;
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.displayName,places.formattedAddress,places.googleMapsUri,places.websiteUri,places.rating,places.userRatingCount,places.primaryTypeDisplayName',
    },
    body: JSON.stringify({
      maxResultCount: 1,
      textQuery,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Places returned ${response.status}`);
  }

  const payload = (await response.json()) as GooglePlaceSearchResponse;
  return payload.places?.[0] ?? null;
}

export async function enrichOnTheGoSuggestions({ suggestions, zipCode }: EnrichInput) {
  const apiKey = getGooglePlacesApiKey();
  if (!apiKey || suggestions.length === 0) {
    return suggestions;
  }

  return Promise.all(
    suggestions.map(async (suggestion) => {
      try {
        const place = await searchVenue(suggestion.venue, zipCode);
        if (!place) return suggestion;

        const displayName = place.displayName?.text?.trim() || suggestion.venue;
        const formattedAddress = place.formattedAddress?.trim();
        const ratingText = buildRatingText(place.rating, place.userRatingCount);
        const googleMapsUri = place.googleMapsUri?.trim();
        const websiteUri = place.websiteUri?.trim();

        return {
          ...suggestion,
          addressHint: formattedAddress || suggestion.addressHint,
          distanceHint: formattedAddress || suggestion.distanceHint,
          googleMapsUri,
          placeType: place.primaryTypeDisplayName?.text?.trim() || suggestion.placeType,
          ratingText,
          reviewsUrl: googleMapsUri || suggestion.reviewsUrl,
          venue: displayName,
          websiteUri: websiteUri || suggestion.websiteUri,
        };
      } catch {
        return suggestion;
      }
    }),
  );
}

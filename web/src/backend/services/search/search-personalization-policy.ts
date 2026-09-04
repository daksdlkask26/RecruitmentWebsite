import "server-only";

export const SEARCH_PERSONALIZATION_POLICY_VERSION =
  "personalization-v1" as const;

export type ConsentBoundPreference = Readonly<{
  consent: boolean;
  enabled: boolean;
  skillIds?: readonly string[];
  preferredLocations?: readonly string[];
}>;

export function applyConsentBoundPersonalization<
  T extends {
    id: string;
    lexicalScore: number;
    exactTitle?: boolean;
    skills?: readonly string[];
    location?: string;
  },
>(candidates: readonly T[], preference: ConsentBoundPreference) {
  if (!preference.consent || !preference.enabled) return [...candidates];
  const skills = new Set(preference.skillIds ?? []);
  const locations = new Set(preference.preferredLocations ?? []);
  return [...candidates].sort((left, right) => {
    const score = (candidate: T) => {
      const skillBoost = candidate.skills?.some((skill) => skills.has(skill))
        ? 0.08
        : 0;
      const locationBoost =
        candidate.location && locations.has(candidate.location) ? 0.08 : 0;
      return candidate.lexicalScore + skillBoost + locationBoost;
    };
    if (Boolean(right.exactTitle) !== Boolean(left.exactTitle))
      return (
        Number(Boolean(right.exactTitle)) - Number(Boolean(left.exactTitle))
      );
    return score(right) - score(left) || left.id.localeCompare(right.id);
  });
}

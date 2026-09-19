import { homeCopy } from "./home-copy";
import type { HomeLocale, SmartMatchInsight } from "./home-page-model";

export function illustrativeSmartMatch(
  locale: HomeLocale = "vi",
): SmartMatchInsight {
  void locale;
  // The Home explainer is educational only. Numeric scores are reserved for
  // actual Profile estimates or immutable CV Match results.
  return { kind: "illustrative" };
}

export const homeDisplayData = {
  vi: {
    feed: homeCopy.vi.whatsNew.cards,
    careerPaths: homeCopy.vi.careerPaths.cards,
    growth: homeCopy.vi.growth.cards,
    events: homeCopy.vi.events.cards,
  },
  en: {
    feed: homeCopy.en.whatsNew.cards,
    careerPaths: homeCopy.en.careerPaths.cards,
    growth: homeCopy.en.growth.cards,
    events: homeCopy.en.events.cards,
  },
} as const;

export const feedItems = {
  vi: homeCopy.vi.whatsNew.cards,
  en: homeCopy.en.whatsNew.cards,
};
export const careerPaths = {
  vi: homeCopy.vi.careerPaths.cards,
  en: homeCopy.en.careerPaths.cards,
};
export const growthItems = {
  vi: homeCopy.vi.growth.cards,
  en: homeCopy.en.growth.cards,
};
export const eventItems = {
  vi: homeCopy.vi.events.cards,
  en: homeCopy.en.events.cards,
};

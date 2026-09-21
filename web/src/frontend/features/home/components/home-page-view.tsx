"use client";

import { CsrfProofProvider } from "@/frontend/features/authentication/client/csrf-proof-context";
import {
  HomeLocaleProvider,
  useHomeLocale,
} from "../client/home-locale-provider";
import { homeCopy } from "../home-copy";
import type { HomePageModel } from "../home-page-model";
import { HomeHeader } from "./home-header";
import { HomeHeroSearch } from "./home-hero-search";
import { HomeHeroCtas } from "./home-hero-ctas";
import { HomeCvScan } from "./home-cv-scan";
import { HomeHowItWorks } from "./home-how-it-works";
import { HomeSmartMatch } from "./home-smart-match";
import { HomeCareerPaths } from "./home-career-paths";
import { HomeTrendingJobs } from "./home-trending-jobs";
import { HomeCandidateTrust } from "./home-candidate-trust";
import { HomeCompaniesHiring } from "./home-companies-hiring";
import { HomeFinalCta } from "./home-final-cta";
import { HomeFooter } from "./home-footer";
import { AppProviders } from "@/frontend/providers/app-providers";

function HomeContent({ model }: { model: HomePageModel }) {
  const { locale } = useHomeLocale();
  const copy = homeCopy[locale];
  return (
    <main className="home-page">
      <HomeHeader
        viewer={model.viewer}
        showCompanies={model.spotlights.items.length > 0}
      />
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <p>{copy.hero.eyebrow}</p>
          <h1 id="home-title">{copy.hero.title}</h1>
          <p className="home-hero-description">{copy.hero.description}</p>
          <HomeHeroCtas locale={locale} viewer={model.viewer} />
          <HomeHeroSearch />
        </div>
        <HomeCvScan locale={locale} />
      </section>
      <HomeCareerPaths locale={locale} paths={model.careerPaths} />
      <HomeTrendingJobs model={model} locale={locale} />
      <HomeSmartMatch model={model} locale={locale} />
      <HomeHowItWorks locale={locale} />
      <HomeCandidateTrust locale={locale} />
      <HomeCompaniesHiring model={model} locale={locale} />
      <HomeFinalCta viewer={model.viewer} locale={locale} />
      <HomeFooter
        locale={locale}
        showCompanies={model.spotlights.items.length > 0}
      />
    </main>
  );
}

export function HomePageView({ model }: { model: HomePageModel }) {
  const csrfProof = model.viewer.kind === "guest" ? "" : model.viewer.csrfProof;
  return (
    <AppProviders>
      <CsrfProofProvider value={csrfProof}>
        <HomeLocaleProvider initialLocale={model.initialLocale}>
          <HomeContent model={model} />
        </HomeLocaleProvider>
      </CsrfProofProvider>
    </AppProviders>
  );
}

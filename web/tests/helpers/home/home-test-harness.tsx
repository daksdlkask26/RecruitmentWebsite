import type { ReactNode } from "react";
import { AppProviders } from "@/frontend/providers/app-providers";
import { HomePageView } from "@/frontend/features/home/components/home-page-view";
import type { HomePageModel } from "@/frontend/features/home/home-page-model";

/** Mirrors the provider boundary used by the root layout for Home tests. */
export function HomeTestHarness({
  model,
  children,
}: {
  model?: HomePageModel;
  children?: ReactNode;
}) {
  return (
    <AppProviders>
      {children ?? (model ? <HomePageView model={model} /> : null)}
    </AppProviders>
  );
}

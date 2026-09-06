import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  HomeLocaleProvider,
  useHomeLocale,
} from "@/frontend/features/home/client/home-locale-provider";
import { HomeHeroSearch } from "@/frontend/features/home/components/home-hero-search";
import { HomeLanguageSelector } from "@/frontend/features/home/components/home-language-selector";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function Harness() {
  const { locale } = useHomeLocale();
  return (
    <>
      <output>{locale}</output>
      <HomeLanguageSelector />
      <HomeHeroSearch />
    </>
  );
}

describe("Home locale provider", () => {
  it("preserves concise discovery values when the Home language changes", () => {
    render(
      <HomeLocaleProvider initialLocale="en">
        <Harness />
      </HomeLocaleProvider>,
    );
    const values = {
      Keyword: "frontend",
      Location: "Hà Nội",
    } as const;
    for (const [label, value] of Object.entries(values))
      fireEvent.change(screen.getByLabelText(label), { target: { value } });

    fireEvent.change(screen.getByRole("combobox", { name: "Home language" }), {
      target: { value: "vi" },
    });

    expect(screen.getByText("vi")).toBeInTheDocument();
    expect(screen.getByLabelText("Từ khóa")).toHaveValue("frontend");
    expect(screen.getByLabelText("Địa điểm")).toHaveValue("Hà Nội");
    expect(window.localStorage.getItem("smarthire.home.locale")).toBe("vi");
    expect(window.sessionStorage).toHaveLength(0);
  });
});

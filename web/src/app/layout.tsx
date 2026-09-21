import type { Metadata } from "next";
import Script from "next/script";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource-variable/manrope/wght.css";
import { serverEnvironment } from "@/backend/env/runtime";
import { ThemeProvider } from "@/frontend/providers/theme-provider";
import "./globals.css";
import "@/frontend/components/ui/design-system.css";
import { Toaster } from "sonner";
import "@/frontend/features/jobs/image-search/styles/image-search.css";
import "@/frontend/features/notifications/styles/notifications.css";

export const metadata: Metadata = {
  title: "SmartHire - A secure talent workspace",
  description:
    "A secure talent workspace designed to help candidates and hiring teams make meaningful connections.",
};
const themeBootstrapScript = [
  "(function () {",
  "  try {",
  "    var pathname = window.location.pathname;",
  "    var publicRoutes = [",
  '      "/login", "/register", "/forgot-password",',
  '      "/reset-password", "/two-factor", "/check-email", "/verify-email",',
  '      "/verify-company-email", "/verify-email-change", "/account-recovery",',
  '      "/business", "/help", "/legal"',
  "    ];",
  "    var forceLight = publicRoutes.some(function (route) {",
  '      return pathname === route || (route !== "/" && pathname.indexOf(route + "/") === 0);',
  "    });",
  '    var stored = window.localStorage.getItem("smarthire-theme");',
  "    var theme =",
  '      forceLight ? "light" : stored === "dark" || stored === "light"',
  "        ? stored",
  "        : window.matchMedia &&",
  '            window.matchMedia("(prefers-color-scheme: dark)").matches',
  '          ? "dark"',
  '          : "light";',
  "    document.documentElement.dataset.theme = theme;",
  "    document.documentElement.style.colorScheme = theme;",
  "  } catch (error) {",
  '    document.documentElement.dataset.theme = "light";',
  "  }",
  "})();",
].join("\n");

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-app-environment={serverEnvironment.APP_ENV}
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <Script
          id="smarthire-theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <Toaster
            className="app-toaster"
            position="top-right"
            richColors
            toastOptions={{ className: "app-toast" }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}

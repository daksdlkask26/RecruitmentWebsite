import { homeCopy } from "../home-copy";
import type { HomeLocale } from "../home-page-model";

/** A decorative CV scan that explains Smart Hire's AI-assisted CV scoring. */
export function HomeCvScan({ locale }: { locale: HomeLocale }) {
  const copy = homeCopy[locale].hero;

  return (
    <div className="home-cv-scan" aria-hidden="true">
      <div className="home-cv-scan-stage">
        <article className="home-cv-scan-document">
          <header className="home-cv-scan-document-header">
            <span className="home-cv-scan-mark">{copy.cvLabel}</span>
            <span>{copy.cvScanLabel}</span>
          </header>
          <div className="home-cv-scan-profile">
            <span className="home-cv-scan-avatar" />
            <div>
              <span className="home-cv-scan-name" />
              <span className="home-cv-scan-role" />
            </div>
          </div>
          <section className="home-cv-scan-section">
            <span className="home-cv-scan-section-label" />
            <span className="home-cv-scan-text home-cv-scan-text--long" />
            <span className="home-cv-scan-text home-cv-scan-text--highlight home-cv-scan-text--medium" />
            <span className="home-cv-scan-text home-cv-scan-text--short" />
          </section>
          <section className="home-cv-scan-section">
            <span className="home-cv-scan-section-label" />
            <span className="home-cv-scan-text home-cv-scan-text--highlight home-cv-scan-text--long" />
            <span className="home-cv-scan-text home-cv-scan-text--medium" />
          </section>
          <span className="home-cv-scan-line" />
        </article>
        <div className="home-cv-score-card">
          <span className="home-cv-score-ai">{copy.aiLabel}</span>
          <strong>{copy.cvScoreLabel}</strong>
          <small>{copy.cvScoreLabel}</small>
          <span className="home-cv-score-check">
            <svg viewBox="0 0 16 16">
              <path d="m3.2 8.15 3.05 3.05 6.55-6.45" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

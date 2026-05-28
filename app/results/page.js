'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

function localeKey(locale) {
  return `${locale.country}::${locale.language}`;
}

function localeLabel(locale) {
  return `${locale.language.toUpperCase()}-${locale.country.toUpperCase()}`;
}

function copyToClipboard(text, setter, timeout = 2500) {
  navigator.clipboard.writeText(text).then(() => {
    setter(true);
    setTimeout(() => setter(false), timeout);
  });
}

function StarRating({ score }) {
  const rounded = Math.round((score || 0) * 2) / 2;
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= rounded) stars.push(<span key={i} className="text-yellow-400">★</span>);
    else if (i - 0.5 === rounded) stars.push(<span key={i} className="text-yellow-400">½</span>);
    else stars.push(<span key={i} className="text-gray-300">★</span>);
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-sm">
      {stars}
      <span className="ml-1 text-xs text-gray-500 font-normal">
        {score ? score.toFixed(1) : 'N/A'}
      </span>
    </span>
  );
}

function gapColor(frequency) {
  if (frequency >= 8) return 'bg-red-100 text-red-800 border-red-200';
  if (frequency >= 5) return 'bg-orange-100 text-orange-800 border-orange-200';
  return 'bg-yellow-100 text-yellow-800 border-yellow-200';
}

function FieldCard({ label, value, count, limit }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        {typeof count === 'number' && limit && (
          <span className={`text-xs ${count > limit ? 'text-red-600' : 'text-gray-400'}`}>
            {count}/{limit}
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-gray-900 leading-relaxed whitespace-pre-line">
        {value || '—'}
      </p>
    </div>
  );
}

function StoreCard({ storeName, storeData, locale }) {
  if (!storeData) {
    return (
      <div className="bg-gray-50 rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
        No {storeName === 'google' ? 'Google Play' : 'App Store'} data — App ID not provided.
      </div>
    );
  }

  const { myApp, competitors, keywordAnalysis, asoPlan } = storeData;
  const { gaps = [], competitorTitleKeywords = [] } = keywordAnalysis || {};
  const title = storeName === 'google' ? 'Google Play' : 'App Store';

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="text-xs text-gray-400">{localeLabel(locale)}</span>
      </div>

      <div>
        <p className="text-lg font-bold leading-tight">{myApp.title}</p>
        {myApp.subtitle && <p className="text-sm text-gray-600">{myApp.subtitle}</p>}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
          <StarRating score={myApp.score} />
          {myApp.installs && <span>· {myApp.installs} installs</span>}
          {myApp.category && <span>· {myApp.category}</span>}
        </div>
      </div>

      {/* Draft plan */}
      {asoPlan && (
        <div className="grid grid-cols-1 gap-2">
          <FieldCard
            label="Draft Title"
            value={asoPlan.title}
            count={asoPlan.characterCounts?.title}
            limit={30}
          />
          {storeName === 'apple' && (
            <>
              <FieldCard
                label="Draft Subtitle"
                value={asoPlan.subtitle}
                count={asoPlan.characterCounts?.subtitle}
                limit={30}
              />
              <FieldCard
                label="Draft Keyword Field"
                value={asoPlan.keywordField}
                count={asoPlan.characterCounts?.keywordField}
                limit={100}
              />
            </>
          )}
          {storeName === 'google' && (
            <FieldCard
              label="Draft Short Description"
              value={asoPlan.shortDescription}
              count={asoPlan.characterCounts?.shortDescription}
              limit={80}
            />
          )}
        </div>
      )}

      {/* Gaps */}
      {gaps.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Top keyword gaps
          </p>
          <div className="flex flex-wrap gap-1.5">
            {gaps.slice(0, 12).map(({ word, frequency }) => (
              <span
                key={word}
                className={`text-xs font-medium border rounded-full px-2 py-0.5 ${gapColor(frequency)}`}
                title={`Used by ${frequency} competitors`}
              >
                {word} ×{frequency}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Competitor titles */}
      {competitorTitleKeywords.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Top words in competitor titles
          </p>
          <div className="flex flex-wrap gap-1.5">
            {competitorTitleKeywords.slice(0, 10).map(({ word, frequency }) => (
              <span
                key={word}
                className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5"
              >
                {word} ×{frequency}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Competitor count */}
      <p className="text-xs text-gray-400 mt-auto">
        {competitors.length} competitor{competitors.length !== 1 ? 's' : ''} scraped
      </p>
    </div>
  );
}

function AiResultPanel({ payload, label }) {
  if (!payload?.finalContent) return null;
  const fc = payload.finalContent;
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3">
      <h4 className="text-sm font-semibold text-gray-700">{label}</h4>
      {label.includes('Apple') && (
        <>
          <FieldCard label="Title" value={fc.apple.title} count={fc.apple.title.length} limit={30} />
          <FieldCard label="Subtitle" value={fc.apple.subtitle} count={fc.apple.subtitle.length} limit={30} />
          <FieldCard label="Keyword Field" value={fc.apple.keywordField} count={fc.apple.keywordField.length} limit={100} />
          <FieldCard label="Promotional Text" value={fc.apple.promotionalText} count={fc.apple.promotionalText.length} limit={170} />
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Description</p>
            <p className="text-sm text-gray-800 whitespace-pre-line">{fc.apple.description}</p>
          </div>
          {fc.apple.rationale && <p className="text-xs text-gray-500 italic">{fc.apple.rationale}</p>}
        </>
      )}
      {label.includes('Google') && (
        <>
          <FieldCard label="Title" value={fc.google.title} count={fc.google.title.length} limit={30} />
          <FieldCard label="Short Description" value={fc.google.shortDescription} count={fc.google.shortDescription.length} limit={80} />
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Full Description ({fc.google.fullDescription.length}/4000)
            </p>
            <p className="text-sm text-gray-800 whitespace-pre-line">{fc.google.fullDescription}</p>
          </div>
          {fc.google.rationale && <p className="text-xs text-gray-500 italic">{fc.google.rationale}</p>}
        </>
      )}
    </div>
  );
}

export default function ResultsPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [finalByLocale, setFinalByLocale] = useState({});
  const [generatingLocale, setGeneratingLocale] = useState(null);
  const [errorByLocale, setErrorByLocale] = useState({});
  const [jsonCopied, setJsonCopied] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('aso_result');
    if (!raw) {
      router.push('/');
      return;
    }
    try {
      const parsed = JSON.parse(raw);

      // Back-compat shapes:
      if (!parsed.results) {
        if (parsed.myApp) {
          // Very old: single-store, single-locale top-level
          const store = parsed.meta?.store || 'google';
          parsed.results = [
            {
              locale: parsed.meta?.locale || { country: 'us', language: 'en' },
              stores: {
                [store]: {
                  myApp: parsed.myApp,
                  competitors: parsed.competitors,
                  keywordAnalysis: parsed.keywordAnalysis,
                  asoPlan: store === 'apple' ? parsed.asoPlan?.apple : parsed.asoPlan?.google,
                },
              },
              asoPlanJson: parsed.asoPlanJson,
            },
          ];
        }
      } else if (parsed.results[0] && !parsed.results[0].stores) {
        // Single-store multi-locale shape from previous phase
        parsed.results = parsed.results.map((r) => {
          const store = parsed.meta?.store || 'google';
          return {
            locale: r.locale,
            stores: {
              [store]: {
                myApp: r.myApp,
                competitors: r.competitors,
                keywordAnalysis: r.keywordAnalysis,
                asoPlan: store === 'apple' ? r.asoPlan?.apple : r.asoPlan?.google,
              },
            },
            asoPlanJson: r.asoPlanJson,
          };
        });
      }

      setData(parsed);
    } catch {
      router.push('/');
    }
  }, [router]);

  if (!data) {
    return <div className="flex items-center justify-center py-32 text-gray-400">Loading…</div>;
  }

  const results = data.results || [];
  if (results.length === 0) {
    return <div className="flex items-center justify-center py-32 text-gray-400">No results.</div>;
  }

  const active = results[activeIdx] || results[0];
  const { locale, stores, asoPlanJson } = active;
  const activeKey = localeKey(locale);
  const finalAsoContent = finalByLocale[activeKey];
  const finalError = errorByLocale[activeKey];
  const isGeneratingActive = generatingLocale === activeKey;

  async function generateForLocale(localeData) {
    const key = localeKey(localeData.locale);
    setErrorByLocale((prev) => ({ ...prev, [key]: '' }));
    setGeneratingLocale(key);

    try {
      const response = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asoPlanJson: localeData.asoPlanJson,
          locale: localeData.locale,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setErrorByLocale((prev) => ({
          ...prev,
          [key]: payload.error || 'Failed to generate.',
        }));
        return false;
      }
      setFinalByLocale((prev) => ({ ...prev, [key]: payload }));
      return true;
    } catch (err) {
      setErrorByLocale((prev) => ({ ...prev, [key]: err.message || 'Failed.' }));
      return false;
    } finally {
      setGeneratingLocale(null);
    }
  }

  async function handleGenerateActive() {
    await generateForLocale(active);
  }

  async function handleGenerateAll() {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const key = localeKey(r.locale);
      if (finalByLocale[key]) continue;
      setActiveIdx(i);
      // eslint-disable-next-line no-await-in-loop
      await generateForLocale(r);
    }
  }

  function handleCopyAsoJson() {
    copyToClipboard(JSON.stringify(asoPlanJson, null, 2), setJsonCopied, 3000);
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <button
          onClick={() => router.push('/')}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          ← Analyze another app
        </button>
      </div>

      {/* Detected brand banner */}
      {asoPlanJson?.brandName && (
        <section className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-emerald-900">
            <span className="text-xs uppercase tracking-wide font-semibold mr-2">
              Brand detected
            </span>
            <span className="font-bold">{asoPlanJson.brandName}</span>
            {asoPlanJson.requestedBrandName ? (
              <span className="ml-2 text-xs text-emerald-700">(you set this)</span>
            ) : (
              <span className="ml-2 text-xs text-emerald-700">(auto-extracted from your title)</span>
            )}
          </div>
          {!asoPlanJson.requestedBrandName && (
            <button
              onClick={() => {
                try {
                  const raw = localStorage.getItem('aso_form_state');
                  const saved = raw ? JSON.parse(raw) : {};
                  saved.targetAppName = asoPlanJson.brandName;
                  localStorage.setItem('aso_form_state', JSON.stringify(saved));
                } catch {}
                router.push('/');
              }}
              className="text-xs px-3 py-1 rounded-full bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100"
            >
              Lock this brand → edit form
            </button>
          )}
        </section>
      )}

      {/* Locale tabs */}
      <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap gap-2">
            {results.map((r, idx) => {
              const key = localeKey(r.locale);
              const done = !!finalByLocale[key];
              const isActive = idx === activeIdx;
              return (
                <button
                  key={key}
                  onClick={() => setActiveIdx(idx)}
                  className={`text-sm px-3 py-1.5 rounded-full border transition-colors
                    ${isActive
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >
                  {localeLabel(r.locale)}
                  {done && <span className="ml-1.5 text-xs">✓</span>}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            {results.length > 1 && (
              <button
                onClick={handleGenerateAll}
                disabled={!!generatingLocale}
                className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white
                           hover:bg-indigo-700 disabled:bg-indigo-300 transition-colors"
              >
                {generatingLocale ? 'Generating…' : 'Generate all locales'}
              </button>
            )}
            <button
              onClick={handleCopyAsoJson}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors
                ${jsonCopied
                  ? 'bg-green-600 text-white border-green-700'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            >
              {jsonCopied ? 'Copied' : 'Copy ASO JSON'}
            </button>
          </div>
        </div>
        {data.errors?.length > 0 && (
          <div className="mt-3 text-xs text-red-700">
            {data.errors.length} scrape error(s):{' '}
            {data.errors.map((e, i) => (
              <span key={i}>
                [{localeLabel(e.locale)}::{e.store}: {e.error}]{' '}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Per-store side-by-side */}
      <section>
        <h2 className="text-xl font-semibold mb-4 pb-2 border-b border-gray-200">
          {localeLabel(locale)} · scraped data
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <StoreCard storeName="google" storeData={stores.google} locale={locale} />
          <StoreCard storeName="apple" storeData={stores.apple} locale={locale} />
        </div>
      </section>

      {/* Synthesize */}
      <section>
        <div className="mb-4 pb-2 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">
                Final ASO Content ({localeLabel(locale)})
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Claude-generated native copy for both stores at {localeLabel(locale)}.
              </p>
            </div>
            <button
              onClick={handleGenerateActive}
              disabled={!!generatingLocale}
              className="px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium
                         hover:bg-gray-800 disabled:bg-gray-400 transition-colors"
            >
              {isGeneratingActive ? 'Generating…' : finalAsoContent ? 'Regenerate' : 'Generate Final ASO Content'}
            </button>
          </div>
        </div>

        {finalError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
            {finalError}
          </div>
        )}

        {finalAsoContent?.validationIssues?.length > 0 && (
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800 mb-4">
            {finalAsoContent.validationIssues.join(' · ')}
          </div>
        )}

        {finalAsoContent?.finalContent && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <AiResultPanel payload={finalAsoContent} label="Google Final Copy" />
            <AiResultPanel payload={finalAsoContent} label="Apple Final Copy" />

            <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                Screenshot Copy
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {finalAsoContent.finalContent.screenshots.map((s) => (
                  <div key={s.screen} className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-gray-400 mb-1">Screen {s.screen}</p>
                    <p className="text-sm font-semibold text-gray-900">{s.headline}</p>
                    <p className="text-xs text-gray-600 mt-1">{s.supportingText}</p>
                  </div>
                ))}
              </div>
            </div>

            {finalAsoContent.finalContent.keywordStrategy && (
              <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                  Keyword Strategy
                </p>
                <div className="text-sm text-gray-800 space-y-2">
                  <p><strong>Primary:</strong> {finalAsoContent.finalContent.keywordStrategy.primary.join(', ')}</p>
                  <p><strong>Secondary:</strong> {finalAsoContent.finalContent.keywordStrategy.secondary.join(', ')}</p>
                  <p><strong>Apple keyword field terms:</strong> {finalAsoContent.finalContent.keywordStrategy.appleKeywordFieldTerms.join(', ')}</p>
                  {finalAsoContent.finalContent.keywordStrategy.reasoning?.length > 0 && (
                    <ul className="list-disc list-inside text-xs text-gray-600 mt-2">
                      {finalAsoContent.finalContent.keywordStrategy.reasoning.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {finalAsoContent.meta && (
              <p className="lg:col-span-2 text-xs text-gray-400">
                Generated via {finalAsoContent.meta.model || 'claude'} ·{' '}
                {finalAsoContent.meta.durationMs
                  ? Math.round(finalAsoContent.meta.durationMs / 1000) + 's'
                  : '?'}
                {typeof finalAsoContent.meta.costUsd === 'number' &&
                  ` · $${finalAsoContent.meta.costUsd.toFixed(4)}`}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Competitor screenshots — show from both stores combined */}
      <CompetitorScreenshots stores={stores} locale={locale} />
    </div>
  );
}

function CompetitorScreenshots({ stores, locale }) {
  const allCompetitors = [];
  if (stores.google) {
    stores.google.competitors.forEach((c) => allCompetitors.push({ ...c, _store: 'google' }));
  }
  if (stores.apple) {
    stores.apple.competitors.forEach((c) => allCompetitors.push({ ...c, _store: 'apple' }));
  }

  const withScreens = allCompetitors.filter((c) => c.screenshots?.length > 0);
  if (withScreens.length === 0) return null;

  return (
    <section>
      <h2 className="text-xl font-semibold mb-1 pb-2 border-b border-gray-200">
        Competitor Screenshots ({localeLabel(locale)})
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Visual reference from both stores' competitors.
      </p>

      <div className="flex flex-col gap-8">
        {withScreens.map((comp) => (
          <div key={`${comp._store}-${comp.appId}`}>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              <span className="text-xs px-1.5 py-0.5 mr-2 rounded bg-gray-100 text-gray-600 uppercase">
                {comp._store === 'google' ? 'Play' : 'Apple'}
              </span>
              {comp.title}
              <span className="ml-2 text-xs text-gray-400 font-normal">
                ({comp.screenshots.length} screenshots)
              </span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {comp.screenshots.map((url, idx) => (
                <a
                  key={idx}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg overflow-hidden border border-gray-200 hover:border-green-400 hover:shadow-md transition"
                >
                  <img
                    src={url}
                    alt={`${comp.title} screenshot ${idx + 1}`}
                    className="w-full h-auto object-cover"
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

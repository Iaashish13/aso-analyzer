'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadSavedSets, saveSet, deleteSet } from '@/lib/savedSets';
import { loadSavedApps, saveApp, deleteApp } from '@/lib/savedApps';

const PRESET_LOCALES = [
  { id: 'en-US', label: 'English (US)', country: 'us', language: 'en' },
  { id: 'en-GB', label: 'English (UK)', country: 'gb', language: 'en' },
  { id: 'pt-BR', label: 'Português (BR)', country: 'br', language: 'pt' },
  { id: 'id-ID', label: 'Bahasa (ID)', country: 'id', language: 'id' },
  { id: 'es-ES', label: 'Español (ES)', country: 'es', language: 'es' },
  { id: 'fr-FR', label: 'Français (FR)', country: 'fr', language: 'fr' },
  { id: 'de-DE', label: 'Deutsch (DE)', country: 'de', language: 'de' },
  { id: 'vi-VN', label: 'Tiếng Việt (VN)', country: 'vn', language: 'vi' },
  { id: 'ru-RU', label: 'Русский (RU)', country: 'ru', language: 'ru' },
  { id: 'ko-KR', label: '한국어 (KR)', country: 'kr', language: 'ko' },
  { id: 'ja-JP', label: '日本語 (JP)', country: 'jp', language: 'ja' },
];

const FORM_STATE_KEY = 'aso_form_state';

function parseLines(text) {
  return String(text || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

export default function HomePage() {
  const router = useRouter();
  const [googleAppId, setGoogleAppId] = useState('');
  const [appleAppId, setAppleAppId] = useState('');
  const [targetAppName, setTargetAppName] = useState('');
  const [targetDescription, setTargetDescription] = useState('');
  const [category, setCategory] = useState('');
  const [preLaunch, setPreLaunch] = useState(false);
  const [selectedLocales, setSelectedLocales] = useState(['en-US']);
  const [customCountry, setCustomCountry] = useState('');
  const [customLanguage, setCustomLanguage] = useState('');
  const [googleManual, setGoogleManual] = useState('');
  const [appleManual, setAppleManual] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [showCustomLocale, setShowCustomLocale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedSets, setSavedSets] = useState([]);
  const [savedApps, setSavedApps] = useState([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [showSaveAppDialog, setShowSaveAppDialog] = useState(false);
  const [newAppName, setNewAppName] = useState('');

  useEffect(() => {
    setSavedSets(loadSavedSets());
    setSavedApps(loadSavedApps());
    try {
      const raw = localStorage.getItem(FORM_STATE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.googleAppId) setGoogleAppId(saved.googleAppId);
      if (saved.appleAppId) setAppleAppId(saved.appleAppId);
      if (saved.targetAppName) setTargetAppName(saved.targetAppName);
      if (saved.targetDescription) setTargetDescription(saved.targetDescription);
      if (saved.category) setCategory(saved.category);
      if (typeof saved.preLaunch === 'boolean') setPreLaunch(saved.preLaunch);
      if (Array.isArray(saved.selectedLocales) && saved.selectedLocales.length > 0) {
        setSelectedLocales(saved.selectedLocales);
      }
    } catch {
      // ignore
    }
  }, []);

  function persistFormState(state) {
    try {
      localStorage.setItem(FORM_STATE_KEY, JSON.stringify(state));
    } catch {}
  }

  function toggleLocale(id) {
    setSelectedLocales((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function buildLocaleList() {
    const list = selectedLocales
      .map((id) => PRESET_LOCALES.find((l) => l.id === id))
      .filter(Boolean)
      .map(({ country, language }) => ({ country, language }));

    const country = customCountry.trim().toLowerCase();
    const language = customLanguage.trim().toLowerCase();
    if (country && language) list.push({ country, language });

    return list;
  }

  function handleLoadSet(setId) {
    if (!setId) return;
    const set = savedSets.find((s) => s.id === setId);
    if (!set) return;
    setGoogleManual((set.googleIds || []).join('\n'));
    setAppleManual((set.appleIds || []).join('\n'));
    setShowManual(true);
  }

  function handleSaveCurrentSet() {
    const name = newSetName.trim();
    if (!name) {
      setError('Enter a name for the set.');
      return;
    }
    try {
      saveSet({
        name,
        googleIds: parseLines(googleManual),
        appleIds: parseLines(appleManual),
      });
      setSavedSets(loadSavedSets());
      setShowSaveDialog(false);
      setNewSetName('');
      setError('');
      // success message via temporary toast? Skip — saved name visible in dropdown
    } catch (e) {
      setError(e.message || 'Failed to save set.');
    }
  }

  function handleDeleteSet(id) {
    deleteSet(id);
    setSavedSets(loadSavedSets());
  }

  function handleClearCompetitors() {
    setGoogleManual('');
    setAppleManual('');
  }

  function handleLoadApp(appId) {
    if (!appId) return;
    const app = savedApps.find((a) => a.id === appId);
    if (!app) return;
    setGoogleAppId(app.googleAppId || '');
    setAppleAppId(app.appleAppId || '');
    setTargetAppName(app.targetAppName || '');
    setTargetDescription(app.targetDescription || '');
    setCategory(app.category || '');
    setPreLaunch(!!app.preLaunch);
    if (Array.isArray(app.selectedLocales) && app.selectedLocales.length > 0) {
      setSelectedLocales(app.selectedLocales);
    }
  }

  function handleSaveCurrentApp() {
    const name = newAppName.trim();
    if (!name) {
      setError('Enter a name for the app profile.');
      return;
    }
    try {
      saveApp({
        name,
        googleAppId: googleAppId.trim(),
        appleAppId: appleAppId.trim(),
        targetAppName: targetAppName.trim(),
        targetDescription: targetDescription.trim(),
        category: category.trim(),
        preLaunch,
        selectedLocales,
      });
      setSavedApps(loadSavedApps());
      setShowSaveAppDialog(false);
      setNewAppName('');
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to save app profile.');
    }
  }

  function handleDeleteApp(id) {
    deleteApp(id);
    setSavedApps(loadSavedApps());
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmedGoogle = googleAppId.trim();
    const trimmedApple = appleAppId.trim();
    const googleManualIds = parseLines(googleManual);
    const appleManualIds = parseLines(appleManual);

    if (preLaunch) {
      if (googleManualIds.length === 0 && appleManualIds.length === 0) {
        setError('Pre-launch mode requires at least one competitor (Google or Apple).');
        return;
      }
      if (!targetAppName.trim()) {
        setError('Pre-launch mode requires a Target App Name / Brand.');
        return;
      }
    } else if (!trimmedGoogle && !trimmedApple) {
      setError('Enter at least one App ID (or enable pre-launch mode below).');
      return;
    }

    const locales = buildLocaleList();
    if (locales.length === 0) {
      setError('Select at least one locale.');
      return;
    }

    persistFormState({
      googleAppId: trimmedGoogle,
      appleAppId: trimmedApple,
      targetAppName: targetAppName.trim(),
      targetDescription: targetDescription.trim(),
      category: category.trim(),
      preLaunch,
      selectedLocales,
    });

    setLoading(true);

    try {
      const storesCount =
        (preLaunch ? 0 : (trimmedGoogle ? 1 : 0) + (trimmedApple ? 1 : 0)) +
        (googleManualIds.length > 0 ? 1 : 0) +
        (appleManualIds.length > 0 ? 1 : 0);
      const timeoutMs = Math.max(95_000, locales.length * Math.max(1, storesCount) * 30_000);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleAppId: preLaunch ? null : (trimmedGoogle || null),
          appleAppId: preLaunch ? null : (trimmedApple || null),
          targetAppName: targetAppName.trim(),
          targetDescription: targetDescription.trim(),
          category: category.trim(),
          preLaunch,
          locales,
          googleManual: showManual || preLaunch ? googleManual : '',
          appleManual: showManual || preLaunch ? appleManual : '',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        return;
      }

      localStorage.setItem('aso_result', JSON.stringify(data));
      router.push('/results');
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Request timed out. Reduce locales or competitors.');
      } else {
        setError(err.message || 'Network error.');
      }
    } finally {
      setLoading(false);
    }
  }

  const googlePlaceholder =
    'com.spotify.music\nhttps://play.google.com/store/apps/details?id=com.deezer.android';
  const applePlaceholder =
    '324684580\nhttps://apps.apple.com/us/app/deezer/id292738169';

  const localeCount = selectedLocales.length + (customCountry.trim() && customLanguage.trim() ? 1 : 0);

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">ASO Analyzer</h1>
      <p className="text-gray-500 mb-8">
        Analyze both stores side-by-side across locales. Generate optimized listings.
      </p>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex flex-col gap-6"
      >
        {/* Saved app profiles */}
        {savedApps.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Saved app profiles
            </label>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                onChange={(e) => {
                  handleLoadApp(e.target.value);
                  e.target.value = '';
                }}
                disabled={loading}
                defaultValue=""
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white max-w-full"
              >
                <option value="" disabled>Load a saved app…</option>
                {savedApps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.targetAppName ? ` — ${a.targetAppName}` : ''}
                  </option>
                ))}
              </select>
              {savedApps.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  onClick={() => handleDeleteApp(a.id)}
                  disabled={loading}
                  className="text-[11px] text-red-600 hover:text-red-800 underline"
                  title={`Delete "${a.name}"`}
                >
                  ✕ {a.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pre-launch toggle */}
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
          <input
            id="preLaunch"
            type="checkbox"
            checked={preLaunch}
            onChange={(e) => setPreLaunch(e.target.checked)}
            className="mt-0.5 accent-amber-600"
            disabled={loading}
          />
          <label htmlFor="preLaunch" className="text-sm text-amber-900 cursor-pointer">
            <span className="font-semibold">Pre-launch mode</span> — I don&apos;t have a live app yet.
            Generate listings from scratch using competitor data only.
            <span className="block text-xs text-amber-700 mt-0.5">
              Requires: brand name + at least one competitor. App IDs ignored.
            </span>
          </label>
        </div>

        {/* Google Play ID */}
        <div>
          <label
            htmlFor="googleAppId"
            className={`block text-sm font-medium mb-2 ${preLaunch ? 'text-gray-300' : 'text-gray-700'}`}
          >
            Google Play App ID
          </label>
          <input
            id="googleAppId"
            type="text"
            value={googleAppId}
            onChange={(e) => setGoogleAppId(e.target.value)}
            placeholder="e.g. com.whatsapp"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                       placeholder-gray-400 disabled:bg-gray-50 disabled:text-gray-400"
            disabled={loading || preLaunch}
          />
        </div>

        {/* App Store ID */}
        <div>
          <label
            htmlFor="appleAppId"
            className={`block text-sm font-medium mb-2 ${preLaunch ? 'text-gray-300' : 'text-gray-700'}`}
          >
            App Store ID (iOS)
          </label>
          <input
            id="appleAppId"
            type="text"
            value={appleAppId}
            onChange={(e) => setAppleAppId(e.target.value)}
            placeholder="e.g. 310633997"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                       placeholder-gray-400 disabled:bg-gray-50 disabled:text-gray-400"
            disabled={loading || preLaunch}
          />
        </div>

        {/* Brand + save app button */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <label htmlFor="targetAppName" className="text-sm font-medium text-gray-700">
              Target App Name / Brand
              {preLaunch && <span className="text-amber-700 ml-1">*</span>}
            </label>
            {(googleAppId.trim() || appleAppId.trim() || targetAppName.trim()) && (
              <button
                type="button"
                onClick={() => setShowSaveAppDialog((v) => !v)}
                className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                disabled={loading}
              >
                💾 Save app profile
              </button>
            )}
          </div>

          {showSaveAppDialog && (
            <div className="mb-3 p-3 rounded-lg bg-blue-50 border border-blue-200 flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                placeholder="Profile name (e.g. Who's Fake)"
                className="flex-1 min-w-[160px] border border-gray-300 rounded px-2 py-1 text-sm"
                disabled={loading}
              />
              <button
                type="button"
                onClick={handleSaveCurrentApp}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700"
                disabled={loading}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setShowSaveAppDialog(false); setNewAppName(''); }}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-white"
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          )}
          <input
            id="targetAppName"
            type="text"
            value={targetAppName}
            onChange={(e) => setTargetAppName(e.target.value)}
            placeholder="e.g. Who's Fake"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                       placeholder-gray-400"
            disabled={loading}
          />
          <p className="mt-1 text-xs text-gray-400">
            {preLaunch
              ? 'Required for pre-launch mode.'
              : 'Optional. Leave empty to auto-extract from your live store title.'}
          </p>
        </div>

        {/* Category (for pre-launch) */}
        {preLaunch && (
          <div>
            <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">
              Category (hint for Claude)
            </label>
            <input
              id="category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Party Game, Productivity, Photo Editor"
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                         placeholder-gray-400"
              disabled={loading}
            />
            <p className="mt-1 text-xs text-gray-400">
              Optional. Helps Claude pick relevant keywords when no live app exists.
            </p>

            <label htmlFor="targetDescription" className="block text-sm font-medium text-gray-700 mb-2 mt-4">
              What the app does (1–3 sentences)
            </label>
            <textarea
              id="targetDescription"
              value={targetDescription}
              onChange={(e) => setTargetDescription(e.target.value)}
              rows={3}
              placeholder="e.g. A party trivia game where 4–10 players answer questions about each other on a single phone. Friends pass the device around and compete for the funniest answers."
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                         placeholder-gray-400"
              disabled={loading}
            />
            <p className="mt-1 text-xs text-gray-400">
              Recommended. Used as the canonical concept across all locales. Without it, Claude infers from competitors only.
            </p>
          </div>
        )}

        {/* Locales */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Locales (select one or more)
          </label>
          <div className="flex flex-wrap gap-2">
            {PRESET_LOCALES.map(({ id, label }) => {
              const active = selectedLocales.includes(id);
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => toggleLocale(id)}
                  disabled={loading}
                  className={`text-sm px-3 py-1.5 rounded-full border transition-colors
                    ${active
                      ? 'bg-green-600 text-white border-green-700'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}
                    disabled:opacity-50`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowCustomLocale((v) => !v)}
            className="mt-3 text-xs text-green-700 hover:text-green-900 font-medium"
            disabled={loading}
          >
            {showCustomLocale ? '− Hide custom locale' : '+ Add custom locale'}
          </button>

          {showCustomLocale && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <input
                  type="text"
                  value={customCountry}
                  onChange={(e) => setCustomCountry(e.target.value)}
                  placeholder="country (e.g. br, jp, in)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  disabled={loading}
                />
                <p className="mt-1 text-[11px] text-gray-400">2-letter ISO country</p>
              </div>
              <div>
                <input
                  type="text"
                  value={customLanguage}
                  onChange={(e) => setCustomLanguage(e.target.value)}
                  placeholder="language (e.g. pt, ja, hi)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  disabled={loading}
                />
                <p className="mt-1 text-[11px] text-gray-400">2-letter ISO language</p>
              </div>
            </div>
          )}
        </div>

        {/* Saved sets dropdown */}
        {savedSets.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Saved competitor sets
            </label>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                onChange={(e) => {
                  handleLoadSet(e.target.value);
                  e.target.value = '';
                }}
                disabled={loading}
                defaultValue=""
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="" disabled>Load a saved set…</option>
                {savedSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.googleIds.length}G / {s.appleIds.length}A)
                  </option>
                ))}
              </select>
              {savedSets.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => handleDeleteSet(s.id)}
                  disabled={loading}
                  className="text-[11px] text-red-600 hover:text-red-800 underline"
                  title={`Delete "${s.name}"`}
                >
                  ✕ {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Manual competitor toggle */}
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="flex items-center gap-2 text-sm text-green-700 hover:text-green-900 font-medium"
              disabled={loading}
            >
              <span
                className={`inline-block transition-transform duration-200 ${showManual || preLaunch ? 'rotate-90' : ''}`}
              >
                ▶
              </span>
              {showManual || preLaunch ? 'Manual competitors' : 'Add specific competitors (optional)'}
            </button>
            {(showManual || preLaunch) && (googleManual || appleManual) && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowSaveDialog((v) => !v)}
                  className="text-xs px-2 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50"
                  disabled={loading}
                >
                  💾 Save as set
                </button>
                <button
                  type="button"
                  onClick={handleClearCompetitors}
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  disabled={loading}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {showSaveDialog && (
            <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200 flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder="Set name (e.g. Party Games)"
                className="flex-1 min-w-[160px] border border-gray-300 rounded px-2 py-1 text-sm"
                disabled={loading}
              />
              <button
                type="button"
                onClick={handleSaveCurrentSet}
                className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700"
                disabled={loading}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setShowSaveDialog(false); setNewSetName(''); }}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-white"
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          )}

          {(showManual || preLaunch) && (
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Google Play competitors
                </label>
                <textarea
                  rows={3}
                  value={googleManual}
                  onChange={(e) => setGoogleManual(e.target.value)}
                  placeholder={googlePlaceholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs
                             focus:outline-none focus:ring-2 focus:ring-green-500
                             placeholder-gray-400 font-mono resize-none"
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  App Store competitors
                </label>
                <textarea
                  rows={3}
                  value={appleManual}
                  onChange={(e) => setAppleManual(e.target.value)}
                  placeholder={applePlaceholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs
                             focus:outline-none focus:ring-2 focus:ring-green-500
                             placeholder-gray-400 font-mono resize-none"
                  disabled={loading}
                />
              </div>
              <p className="text-xs text-gray-400">
                One per line. URL or app ID. {preLaunch ? 'Required.' : 'Empty = auto-discover.'}
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-400
                     text-white font-medium py-2.5 rounded-lg transition-colors
                     flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Analyzing…
            </>
          ) : preLaunch ? (
            `Analyze (pre-launch × ${localeCount} locale${localeCount !== 1 ? 's' : ''})`
          ) : (
            (() => {
              const storeCount = (googleAppId.trim() ? 1 : 0) + (appleAppId.trim() ? 1 : 0);
              const total = storeCount * localeCount;
              return `Analyze (${storeCount} store${storeCount !== 1 ? 's' : ''} × ${localeCount} locale${localeCount !== 1 ? 's' : ''} = ${total} scrape${total !== 1 ? 's' : ''})`;
            })()
          )}
        </button>
      </form>

      <div className="mt-6 rounded-xl bg-blue-50 border border-blue-100 px-5 py-4 text-sm text-blue-800">
        <p className="font-medium mb-1">Tips</p>
        <ul className="list-disc list-inside space-y-1 text-blue-700 text-xs">
          <li>Pre-launch mode: no live app needed — works with competitors only</li>
          <li>Save competitor sets to reuse across runs (per niche/category)</li>
          <li>Multi-locale: Claude writes native copy per locale, not translated</li>
          <li>Cached 60min per store+locale — re-runs are instant</li>
        </ul>
      </div>

      <p className="mt-4 text-xs text-center text-gray-400">
        Scrapes live store data · Nothing stored on our servers
      </p>
    </div>
  );
}

// spotizam.js — spotizam-style ambient audio recognizer for Spicetify
//
// == PROVIDER SIGNUP LINKS ==
//   ACRCloud:   https://console.acrcloud.com/
//   AudD:       https://audd.io
//
// == INSTALL ==
//   1. Place this file in your Spotify spicetify Extensions/ folder
//   2. Run: spicetify config extensions spotizam.js
//   3. Run: spicetify apply
//   4. Open Spotify → click the gear icon next to the mic button to configure your API key
//   5. Default provider is ACRCloud
//
// == NOTES ==
//   - Config is stored in localStorage under key "spotizam_config"
//   - Press Escape or use the panel X button to close settings
//   - If credentials are missing for the selected provider, the panel opens automatically with a warning

(function () {
  "use strict";

  // ── Constants ──────────────────────────────────────────────────────────────

  // The whole extension reads and writes from one localStorage key so all
  // settings stay together in one predictable place.
  const STORAGE_KEY = "spotizam_config";
  const STORAGE_BACKUP_KEY = "spotizam_config_backup";
  const RESULTS_ROUTE = "/spotizam-app";
  const MIN_RECORDING_SECONDS = 15;
  const MAX_RECORDING_SECONDS = 30;
  const DEFAULT_RECORDING_SECONDS = 15;
  const MIN_HISTORY_ITEMS = 1;
  const MAX_HISTORY_ITEMS = 10;
  const DEFAULT_HISTORY_ITEMS = 5;
  const ICON_SIZE = 18;

  const PROVIDERS = [
    { id: "audd", label: "AudD", signupUrl: "https://audd.io" },
    { id: "acrcloud", label: "ACRCloud", signupUrl: "https://console.acrcloud.com/" },
  ];

  // ── Default config ─────────────────────────────────────────────────────────

  // This is the full settings shape Spotizam expects. Every time we load saved
  // settings, we merge them into this object so missing fields get safe defaults.
  const defaultConfig = function () {
    return {
      provider: "acrcloud",
      recordingSeconds: DEFAULT_RECORDING_SECONDS,
      afterMatch: { openSong: true, playSong: false },
      resultsPage: { openAfterRecognition: true },
      history: { enabled: false, maxItems: DEFAULT_HISTORY_ITEMS, includeAllMatches: false, searches: [] },
      latestResults: null,
      debug: { keepAudio: false, audioDirectory: "", keepJson: false, jsonDirectory: "" },
      acrcloud: { host: "", accessKey: "", accessSecret: "" },
      audd: { apiToken: "" },
    };
  };

  // ── Config helpers ─────────────────────────────────────────────────────────

  // Load saved settings from localStorage. If something is missing or malformed,
  // fall back to defaults instead of letting the extension crash.
  function loadConfig() {
    var loaded = tryLoadConfigFromStorage(STORAGE_KEY, "primary");
    if (loaded) return loaded;

    loaded = tryLoadConfigFromStorage(STORAGE_BACKUP_KEY, "backup");
    if (loaded) {
      debugWarn("Recovered Spotizam settings from backup storage");
      saveConfig(loaded);
      return loaded;
    }

    debugWarn("No saved Spotizam config found; using defaults");
    var fallback = defaultConfig();
    normalizeAfterMatch(fallback);
    normalizeResultsPageConfig(fallback);
    normalizeHistoryConfig(fallback);
    normalizeLatestResultsConfig(fallback);
    normalizeDebugConfig(fallback);
    return fallback;
  }

  function tryLoadConfigFromStorage(key, label) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;

      var parsed = JSON.parse(raw);
      var cfg = defaultConfig();
      if (isValidProvider(parsed.provider)) cfg.provider = parsed.provider;
      cfg.recordingSeconds = clampRecordingSeconds(parsed.recordingSeconds);
      if (parsed.afterMatch) Object.assign(cfg.afterMatch, parsed.afterMatch);
      if (parsed.resultsPage) Object.assign(cfg.resultsPage, parsed.resultsPage);
      if (parsed.history) Object.assign(cfg.history, parsed.history);
      if (Object.prototype.hasOwnProperty.call(parsed, "latestResults")) cfg.latestResults = parsed.latestResults;
      if (parsed.debug) Object.assign(cfg.debug, parsed.debug);
      if (parsed.acrcloud) Object.assign(cfg.acrcloud, parsed.acrcloud);
      if (parsed.audd) Object.assign(cfg.audd, parsed.audd);
      normalizeAfterMatch(cfg);
      normalizeResultsPageConfig(cfg);
      normalizeHistoryConfig(cfg);
      normalizeLatestResultsConfig(cfg);
      normalizeDebugConfig(cfg);
      debugLog("Loaded Spotizam config from " + label + " storage", {
        provider: cfg.provider,
        recordingSeconds: cfg.recordingSeconds,
        afterMatch: cfg.afterMatch,
        resultsPage: cfg.resultsPage,
        history: {
          enabled: cfg.history.enabled,
          maxItems: cfg.history.maxItems,
          includeAllMatches: cfg.history.includeAllMatches,
          storedSearches: cfg.history.searches.length,
        },
        debug: cfg.debug,
        acrcloudPresent: !!(trimmed(cfg.acrcloud.host) || trimmed(cfg.acrcloud.accessKey) || trimmed(cfg.acrcloud.accessSecret)),
        auddPresent: !!trimmed(cfg.audd.apiToken),
      });
      return cfg;
    } catch (err) {
      reportError("Could not parse Spotizam config from " + label + " storage", err);
      return null;
    }
  }

  function normalizeAfterMatch(cfg) {
    // At least one post-match action should always stay enabled.
    if (!cfg.afterMatch) cfg.afterMatch = defaultConfig().afterMatch;
    cfg.afterMatch.openSong = !!cfg.afterMatch.openSong;
    cfg.afterMatch.playSong = !!cfg.afterMatch.playSong;
    if (!cfg.afterMatch.openSong && !cfg.afterMatch.playSong) {
      cfg.afterMatch.openSong = true;
    }
  }

  function normalizeResultsPageConfig(cfg) {
    if (!cfg.resultsPage || typeof cfg.resultsPage !== "object") cfg.resultsPage = defaultConfig().resultsPage;
    cfg.resultsPage.openAfterRecognition = !!cfg.resultsPage.openAfterRecognition;
  }

  function normalizeHistoryConfig(cfg) {
    if (!cfg.history || typeof cfg.history !== "object") cfg.history = defaultConfig().history;

    cfg.history.enabled = !!cfg.history.enabled;
    cfg.history.includeAllMatches = !!cfg.history.includeAllMatches;
    cfg.history.maxItems = clampHistoryItems(cfg.history.maxItems);

    var searches = [];

    if (Array.isArray(cfg.history.searches)) {
      searches = cfg.history.searches.map(normalizeSearchBatch).filter(Boolean);
    } else if (Array.isArray(cfg.history.items)) {
      searches = cfg.history.items
        .map(function (item, index) {
          var normalized = normalizeStoredMatchItem(item);
          if (!normalized) return null;
          var timestamp = normalized.timestamp || new Date().toISOString();
          return {
            id: makeSearchBatchId(timestamp, index),
            timestamp: timestamp,
            provider: isValidProvider(cfg.provider) ? cfg.provider : defaultConfig().provider,
            service: normalized.service || "Unknown",
            query: normalized.searchQuery || makeSpotifySearchQuery(normalized.title, normalized.artist),
            items: [normalized],
          };
        })
        .filter(Boolean);
    }

    cfg.history.searches = searches.slice(0, cfg.history.maxItems);
    delete cfg.history.items;
  }

  function normalizeStoredMatchItem(item) {
    if (!item || typeof item !== "object") return null;
    var title = trimmed(item.title);
    var artist = trimmed(item.artist);
    var query = trimmed(item.searchQuery) || makeSpotifySearchQuery(title, artist);
    if (!title && !artist && !query) return null;

    return {
      title: title,
      artist: artist,
      spotifyUri: trimmed(item.spotifyUri) || null,
      spotifyAlbumId: trimmed(item.spotifyAlbumId) || null,
      searchQuery: query,
      service: trimmed(item.service) || "Unknown",
      timestamp: trimmed(item.timestamp) || new Date().toISOString(),
      confidence: item.confidence == null ? null : Number(item.confidence),
      isPrimary: !!item.isPrimary,
    };
  }

  function makeSearchBatchId(timestamp, suffix) {
    return "search-" + String(timestamp || Date.now()).replace(/[^0-9a-z]+/gi, "-") + "-" + String(suffix == null ? 0 : suffix);
  }

  function normalizeSearchBatch(batch, index) {
    if (!batch || typeof batch !== "object") return null;
    var items = Array.isArray(batch.items) ? batch.items.map(normalizeStoredMatchItem).filter(Boolean) : [];
    if (!items.length) return null;
    var timestamp = trimmed(batch.timestamp) || items[0].timestamp || new Date().toISOString();

    return {
      id: trimmed(batch.id) || makeSearchBatchId(timestamp, index),
      timestamp: timestamp,
      provider: isValidProvider(batch.provider) ? batch.provider : defaultConfig().provider,
      service: trimmed(batch.service) || items[0].service || "Unknown",
      query: trimmed(batch.query) || items[0].searchQuery || makeSpotifySearchQuery(items[0].title, items[0].artist),
      items: items,
    };
  }

  function normalizeLatestResultsConfig(cfg) {
    if (!cfg.latestResults || typeof cfg.latestResults !== "object") {
      cfg.latestResults = null;
      return;
    }

    cfg.latestResults = normalizeSearchBatch(cfg.latestResults, 0);
  }

  function normalizeDebugConfig(cfg) {
    if (!cfg.debug || typeof cfg.debug !== "object") cfg.debug = defaultConfig().debug;

    cfg.debug.keepAudio = !!cfg.debug.keepAudio;
    cfg.debug.keepJson = !!cfg.debug.keepJson;
    cfg.debug.audioDirectory = trimmed(cfg.debug.audioDirectory);
    cfg.debug.jsonDirectory = trimmed(cfg.debug.jsonDirectory);
  }

  function clampHistoryItems(value) {
    var parsed = parseInt(value, 10);
    if (!isFinite(parsed)) parsed = DEFAULT_HISTORY_ITEMS;
    if (parsed < MIN_HISTORY_ITEMS) return MIN_HISTORY_ITEMS;
    if (parsed > MAX_HISTORY_ITEMS) return MAX_HISTORY_ITEMS;
    return parsed;
  }

  function makeSpotifySearchQuery(title, artist) {
    return [trimmed(title), trimmed(artist)].filter(Boolean).join(" ").trim();
  }

  function saveConfig(cfg) {
    normalizeAfterMatch(cfg);
    normalizeResultsPageConfig(cfg);
    normalizeHistoryConfig(cfg);
    normalizeLatestResultsConfig(cfg);
    normalizeDebugConfig(cfg);
    var serialized = JSON.stringify(cfg);
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(STORAGE_BACKUP_KEY, serialized);
  }

  function getProviderLabel(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id === id) return PROVIDERS[i].label;
    }
    return id;
  }

  function isValidProvider(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id === id) return true;
    }
    return false;
  }

  function getSignupUrl(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id === id) return PROVIDERS[i].signupUrl;
    }
    return "";
  }

  function credentialsMissing(cfg) {
    var p = cfg.provider;
    if (p === "acrcloud") return !trimmed(cfg.acrcloud.host) || !trimmed(cfg.acrcloud.accessKey) || !trimmed(cfg.acrcloud.accessSecret);
    if (p === "audd") return !trimmed(cfg.audd.apiToken);
    return true;
  }

  function trimmed(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function clampRecordingSeconds(value) {
    var parsed = parseInt(value, 10);
    if (!isFinite(parsed)) parsed = DEFAULT_RECORDING_SECONDS;
    if (parsed < MIN_RECORDING_SECONDS) return MIN_RECORDING_SECONDS;
    if (parsed > MAX_RECORDING_SECONDS) return MAX_RECORDING_SECONDS;
    return parsed;
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById("spotizam-detect-styles")) return;
    var style = document.createElement("style");
    style.id = "spotizam-detect-styles";
    style.textContent =
      ".spotizam-detect-btn,.spotizam-detect-settings-btn{" +
        "background:none;border:none;color:var(--spice-text);cursor:pointer;" +
        "padding:6px 8px;border-radius:4px;display:flex;align-items:center;justify-content:center;" +
        "transition:background .15s ease;position:relative;flex-shrink:0;" +
      "}" +
      ".spotizam-detect-btn:hover,.spotizam-detect-settings-btn:hover{background:var(--spice-highlight)}" +
      ".spotizam-detect-btn svg,.spotizam-detect-settings-btn svg{width:" + ICON_SIZE + "px;height:" + ICON_SIZE + "px}" +
      ".spotizam-detect-btn--recording svg{color:#e22162;animation:spotizam-detect-pulse .8s ease infinite alternate}" +
      ".spotizam-detect-btn--recording{filter:drop-shadow(0 0 6px #e22162)}" +
      "@keyframes spotizam-detect-pulse{from{transform:scale(1)}to{transform:scale(1.15)}}" +
      ".spotizam-detect-btn--processing svg{animation:spotizam-detect-spin 1s linear infinite}" +
      "@keyframes spotizam-detect-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}" +
      ".spotizam-detect-btn--match svg{color:#1ed760}" +
      ".spotizam-detect-btn--error svg{color:#e22162}" +

      /* settings panel */
      ".spotizam-detect-panel{" +
        "position:fixed;z-index:9999;background:var(--spice-sidebar);color:var(--spice-text);" +
        "border-radius:8px;padding:16px;min-width:300px;max-width:360px;" +
        "box-shadow:0 8px 32px rgba(0,0,0,.45);font-size:14px;line-height:1.4;" +
        "display:none;flex-direction:column;gap:12px;" +
        "max-height:calc(100vh - 24px);overflow-y:auto;overflow-x:hidden;box-sizing:border-box;" +
      "}" +
      ".spotizam-detect-panel--open{display:flex}" +
      ".spotizam-detect-panel__header{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:8px}" +
      ".spotizam-detect-panel__title{" +
        "font-weight:700;font-size:15px;margin:0;color:var(--spice-text);" +
      "}" +
      ".spotizam-detect-panel__close{" +
        "position:absolute;top:0;right:0;width:32px;height:32px;border:none;border-radius:4px;" +
        "background:var(--spice-player);color:var(--spice-text);cursor:pointer;" +
        "display:flex;align-items:center;justify-content:center;padding:0;z-index:1001;" +
        "pointer-events:auto !important;touch-action:none !important;" +
      "}" +
      ".spotizam-detect-panel__close:hover{background:var(--spice-highlight)}" +
      ".spotizam-detect-panel__close svg{width:16px;height:16px}" +
      ".spotizam-detect-panel__label{" +
        "font-weight:600;margin-bottom:4px;display:block;font-size:13px;color:var(--spice-subtext);" +
      "}" +
      ".spotizam-detect-panel__select,.spotizam-detect-panel__input{" +
        "width:100%;padding:8px 10px;border-radius:4px;border:1px solid var(--spice-player);" +
        "background:var(--spice-player);color:var(--spice-text);font-size:13px;outline:none;" +
        "box-sizing:border-box;" +
      "}" +
      ".spotizam-detect-panel__secret-row{display:flex;align-items:center;gap:6px}" +
      ".spotizam-detect-panel__secret-row .spotizam-detect-panel__input{min-width:0;flex:1}" +
      ".spotizam-detect-panel__folder-row{display:flex;align-items:center;gap:6px}" +
      ".spotizam-detect-panel__folder-row .spotizam-detect-panel__input{min-width:0;flex:1}" +
      ".spotizam-detect-panel__folder{" +
        "height:34px;border:none;border-radius:4px;background:var(--spice-button);color:var(--spice-text);cursor:pointer;" +
        "font-weight:700;font-size:12px;padding:0 12px;white-space:nowrap;" +
      "}" +
      ".spotizam-detect-panel__folder:hover{background:var(--spice-button-active)}" +
      ".spotizam-detect-panel__checkrow{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--spice-text)}" +
      ".spotizam-detect-panel__checkrow input{width:16px;height:16px;accent-color:var(--spice-button)}" +
      ".spotizam-detect-panel__eye{" +
        "width:34px;height:34px;border:none;border-radius:4px;background:var(--spice-player);" +
        "color:var(--spice-text);cursor:pointer;display:flex;align-items:center;justify-content:center;" +
        "flex:0 0 auto;padding:0;" +
      "}" +
      ".spotizam-detect-panel__eye:hover{background:var(--spice-highlight)}" +
      ".spotizam-detect-panel__eye svg{width:17px;height:17px}" +
      ".spotizam-detect-panel__hint{font-size:12px;color:var(--spice-subtext);margin-top:-6px}" +
      ".spotizam-detect-panel__select:focus,.spotizam-detect-panel__input:focus{border-color:var(--spice-button-active)}" +
      ".spotizam-detect-panel__input::-webkit-input-placeholder{color:var(--spice-subtext)}" +
      ".spotizam-detect-panel__input::placeholder{color:var(--spice-subtext)}" +
      ".spotizam-detect-panel__field{margin-bottom:8px}" +
      ".spotizam-detect-panel__signup{" +
        "display:block;margin-top:-4px;margin-bottom:10px;font-size:12px;color:var(--spice-text);" +
        "text-decoration:none;" +
      "}" +
      ".spotizam-detect-panel__signup:hover{text-decoration:underline}" +
      ".spotizam-detect-panel__save{" +
        "width:100%;padding:10px;border:none;border-radius:20px;font-weight:700;font-size:14px;" +
        "cursor:pointer;background:var(--spice-button);color:var(--spice-text);margin-top:4px;" +
      "}" +
      ".spotizam-detect-panel__save:hover{background:var(--spice-button-active)}" +
      ".spotizam-detect-panel__warning{" +
        "background:var(--spice-main-elevated);border:1px solid var(--spice-notification-error);color:var(--spice-notification-error);" +
        "padding:8px 10px;border-radius:6px;font-size:13px;display:none;" +
      "}" +
      ".spotizam-detect-panel__warning--visible{display:block}" +
      ".spotizam-detect-panel__toast{" +
        "background:var(--spice-main-elevated);border:1px solid var(--spice-button);color:var(--spice-button);" +
        "padding:8px 10px;border-radius:6px;font-size:13px;display:none;" +
      "}" +
      ".spotizam-detect-panel__toast--visible{display:block}" +
      ".spotizam-detect-panel__section{border-top:1px solid var(--spice-player);padding-top:10px;margin-top:4px;display:flex;flex-direction:column;gap:8px}" +
      ".spotizam-detect-panel__section-title{font-weight:700;color:var(--spice-text);font-size:13px}" +
      ".spotizam-detect-panel__history{border-top:1px solid var(--spice-player);margin-top:4px;padding-top:8px;display:none}" +
      ".spotizam-detect-panel__history-title{font-weight:700;color:var(--spice-text);font-size:13px}" +
      ".spotizam-detect-panel__history-empty{font-size:12px;color:var(--spice-subtext)}" +
      ".spotizam-detect-panel__history-list{display:flex;flex-direction:column;gap:8px}" +
      ".spotizam-detect-panel__history-item{border:1px solid var(--spice-player);border-radius:6px;padding:8px;background:var(--spice-player)}" +
      ".spotizam-detect-panel__history-item-title{font-size:13px;color:var(--spice-text);font-weight:700}" +
      ".spotizam-detect-panel__history-item-meta{font-size:11px;color:var(--spice-subtext);margin-top:2px}" +
      ".spotizam-detect-panel__history-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}" +
      ".spotizam-detect-panel__history-link,.spotizam-detect-panel__history-copy,.spotizam-detect-panel__history-delete,.spotizam-detect-panel__history-toggle{border:1px solid var(--spice-button);border-radius:999px;padding:3px 8px;font-size:11px;text-decoration:none;background:transparent;color:var(--spice-text);cursor:pointer}" +
      ".spotizam-detect-panel__history-link:hover,.spotizam-detect-panel__history-copy:hover,.spotizam-detect-panel__history-delete:hover,.spotizam-detect-panel__history-toggle:hover{background:var(--spice-highlight)}" +
      ".spotizam-detect-panel__history-delete{border-color:rgba(255,107,107,.45);color:#ff7f7f}" +
      ".spotizam-detect-panel__history-group-summary{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
      ".spotizam-detect-panel__history-group-copy{font-size:11px;color:var(--spice-subtext);margin-top:2px}" +
      ".spotizam-detect-panel__history-group-items{display:flex;flex-direction:column;gap:8px;margin-top:8px}" +
      ".spotizam-detect-panel__history-item--nested{background:var(--spice-main-elevated)}";
    document.head.appendChild(style);
  }

  // ── SVG icon strings ───────────────────────────────────────────────────────

  var ICON_MIC =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>' +
    '<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';

  var ICON_GEAR =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';

  var ICON_CHECK =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';

  var ICON_X =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>';

  var ICON_SPINNER =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" opacity=".3"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" opacity=".5" transform="rotate(30 12 12)"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" opacity=".7" transform="rotate(60 12 12)"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" opacity=".85" transform="rotate(90 12 12)"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" transform="rotate(120 12 12)"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" opacity=".3" transform="rotate(150 12 12)"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" opacity=".5" transform="rotate(180 12 12)"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" opacity=".7" transform="rotate(210 12 12)"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" opacity=".85" transform="rotate(240 12 12)"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" transform="rotate(270 12 12)"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" opacity=".3" transform="rotate(300 12 12)"/>' +
    '<path d="M12 4V1A1 1 0 0 0 10 1v3a1 1 0 0 0 2 0z" opacity=".5" transform="rotate(330 12 12)"/></svg>';

  var ICON_EYE =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/>' +
    '<path d="M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';

  var ICON_EYE_OFF =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.8 3.5 4.2 2.1l17 17-1.4 1.4-3.1-3.1A10 10 0 0 1 12 19c-5 0-9-4.5-10-7a15 15 0 0 1 4-4.9L2.8 3.5z"/>' +
    '<path d="M12 5c5 0 9 4.5 10 7a14.5 14.5 0 0 1-2.6 3.7l-3-3A4 4 0 0 0 11.3 7.6L9 5.3A9.8 9.8 0 0 1 12 5z"/></svg>';

  // ── State ──────────────────────────────────────────────────────────────────

  // These variables keep track of the live UI and any in-progress recording so
  // the mic button can react correctly to repeated clicks.
  var config = loadConfig();
  var micBtn = null;
  var settingsBtn = null;
  var settingsPanel = null;
  var currentState = "idle"; // idle | recording | processing | match | error
  var delegatedHandlersAttached = false;
  var activeRecording = null;
  var debugDirectoryHandle = null;
  var debugJsonDirectoryHandle = null;
  var pendingAction = null; // 'recordAfterSave' when user tried to record but was missing creds

  // ── Toast helper (Spicetify) ───────────────────────────────────────────────

  function showToast(msg, isError) {
    msg = String(stringifyError(msg));
    if (typeof Spicetify !== "undefined" && Spicetify.showNotification) {
      try {
        Spicetify.showNotification(msg, !!isError);
      } catch (_) {
        console.warn("[spotizam] " + msg);
      }
    }
  }

  function stringifyError(value) {
    if (!value) return "Recognition failed";
    if (typeof value === "string") return value;
    if (value.message && typeof value.message === "string") return value.message;
    if (value.error && typeof value.error === "string") return value.error;
    if (value.error && value.error.message) return stringifyError(value.error);
    if (value.status && value.status.msg) return value.status.msg;
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function stageError(stage, err) {
    var msg = stringifyError(err);
    var wrapped = new Error(stage + ": " + msg);
    wrapped.originalError = err;
    return wrapped;
  }

  function debugLog() {
    try {
      console.log.apply(console, ["[spotizam]"].concat(Array.prototype.slice.call(arguments)));
    } catch (_) {}
  }

  function debugWarn() {
    try {
      console.warn.apply(console, ["[spotizam]"].concat(Array.prototype.slice.call(arguments)));
    } catch (_) {}
  }

  function reportError(stage, err) {
    var message = stage ? stage + ": " + stringifyError(err) : stringifyError(err);
    try {
      console.error("[spotizam] " + message, err || "");
    } catch (_) {}
    return message;
  }

  // ── Set button state ───────────────────────────────────────────────────────

  // The mic button changes icon/color depending on what Spotizam is doing.
  function setButtonState(state, tooltip) {
    if (!micBtn) return;
    currentState = state;
    micBtn.className = "spotizam-detect-btn";
    micBtn.removeAttribute("title");

    switch (state) {
      case "idle":
        micBtn.innerHTML = ICON_MIC;
        break;
      case "recording":
        micBtn.classList.add("spotizam-detect-btn--recording");
        micBtn.innerHTML = ICON_MIC;
        micBtn.setAttribute("title", tooltip || "Recording...");
        break;
      case "processing":
        micBtn.classList.add("spotizam-detect-btn--processing");
        micBtn.innerHTML = ICON_SPINNER;
        micBtn.setAttribute("title", tooltip || "Listening...");
        break;
      case "match":
        micBtn.classList.add("spotizam-detect-btn--match");
        micBtn.innerHTML = ICON_CHECK;
        break;
      case "error":
        micBtn.classList.add("spotizam-detect-btn--error");
        micBtn.innerHTML = ICON_X;
        break;
    }
  }

  // ── Audio capture ──────────────────────────────────────────────────────────

  // Record audio from the microphone. The user must record for at least
  // MIN_RECORDING_SECONDS, but they can stop early after that point if they set
  // a longer maximum duration in settings.
  function captureAudio(durationSeconds) {
    return new Promise(function (resolve, reject) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        reject(new Error("Microphone capture is not available in this Spotify runtime"));
        return;
      }

      var maxMs = clampRecordingSeconds(durationSeconds) * 1000;
      var minMs = MIN_RECORDING_SECONDS * 1000;
      var settled = false;

      debugLog("Requesting microphone permission");
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(function (stream) {
          debugLog("Microphone stream opened; recording for up to " + maxMs + "ms");
          var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
          var audioCtx = AudioContextCtor ? new AudioContextCtor() : null;

          var recorder;
          var chunks = [];
          var minTimer = null;
          var maxTimer = null;

          // Stop timers, release the stream, and forget the active recording
          // handle so later clicks do not try to stop an already-finished recorder.
          function cleanup() {
            if (minTimer) clearTimeout(minTimer);
            if (maxTimer) clearTimeout(maxTimer);
            activeRecording = null;
            stream.getTracks().forEach(function (t) { t.stop(); });
            if (audioCtx) audioCtx.close();
          }

          function stopRecorder() {
            if (!recorder || recorder.state === "inactive") return;
            try { recorder.stop(); } catch (_) {}
          }

          try {
            recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
          } catch (_) {
            try {
              recorder = new MediaRecorder(stream);
            } catch (e) {
              cleanup();
              reject(new Error("MediaRecorder not supported"));
              return;
            }
          }

          recorder.ondataavailable = function (e) {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };

          recorder.onstop = function () {
            settled = true;
            var blob = new Blob(chunks, { type: "audio/webm" });
            cleanup();
            debugLog("Recording complete", { bytes: blob.size, type: blob.type, chunks: chunks.length });
            if (!blob.size) {
              reject(new Error("Recording was empty"));
              return;
            }
            resolve(blob);
          };

          recorder.onerror = function (event) {
            settled = true;
            cleanup();
            reject(stageError("Recording failed", event && (event.error || event)));
          };

          // Expose a tiny controller so the mic button can stop the current
          // recording once the minimum duration has been reached.
          activeRecording = {
            canStop: false,
            stop: function () {
              if (!activeRecording || !activeRecording.canStop) {
                debugLog("Early stop ignored; minimum recording length is 15 seconds");
                showToast("Recording continues. Minimum length is 15 seconds.", false);
                return;
              }
              debugLog("Stopping recording early after minimum duration");
              stopRecorder();
            },
          };

          recorder.start();
          minTimer = setTimeout(function () {
            if (!activeRecording) return;
            activeRecording.canStop = true;
            setButtonState("recording", "Click to stop recording");
            showToast("15 seconds captured. Click the mic to stop early.", false);
          }, minMs);
          maxTimer = setTimeout(stopRecorder, maxMs);
        })
        .catch(function (err) {
          if (settled) return;
          activeRecording = null;
          reject(stageError("Microphone permission failed", err));
        });
    });
  }

  // ── HMAC helper (for ACRCloud) ─────────────────────────────────────────────

  // ACRCloud signs requests with HMAC before it accepts audio uploads.
  function hmacSha1(key, data) {
    return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"])
      .then(function (cryptoKey) {
        return crypto.subtle.sign("HMAC", cryptoKey, data);
      })
      .then(function (signature) {
        return btoa(String.fromCharCode.apply(null, new Uint8Array(signature)));
      });
  }

  // ── Provider: ACRCloud ─────────────────────────────────────────────────────

  // ACRCloud can return standard music matches and humming matches. We read
  // both shapes and prefer provider-supplied Spotify metadata whenever present.
  function queryACRCloud(blob, cfg) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () {
        var body = new Uint8Array(reader.result);
        var host = normalizeAcrHost(cfg.host);
        var method = "POST";
        var uri = "/v1/identify";
        var dataType = "audio";
        var version = "1";
        var timestamp = Math.floor(Date.now() / 1000).toString();

        if (!host) {
          reject(new Error("ACRCloud host is empty"));
          return;
        }

        var stringToSign = method + "\n" + uri + "\n" + cfg.accessKey + "\n" + dataType + "\n" + version + "\n" + timestamp;

        debugLog("Sending ACRCloud request", {
          host: host,
          bytes: body.byteLength,
          dataType: dataType,
          timestamp: timestamp,
          stringToSign: stringToSign,
        });

        hmacSha1(new TextEncoder().encode(cfg.accessSecret), new TextEncoder().encode(stringToSign))
          .then(function (signature) {
            var formData = new FormData();
            formData.append("sample", blob, "spotizam.webm");
            formData.append("sample_bytes", body.byteLength.toString());
            formData.append("access_key", cfg.accessKey);
            formData.append("data_type", dataType);
            formData.append("signature", signature);
            formData.append("signature_version", version);
            formData.append("timestamp", timestamp);

            return fetch("https://" + host + uri, {
              method: "POST",
              body: formData,
            });
          })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            debugLog("ACRCloud response payload", data);
            saveDebugJson(data);
            if (data.status && data.status.code === 0) {
              var tracks = getAcrTracks(data);
              if (!tracks || !tracks.length) {
                reject(new Error("No match found"));
                return;
              }

              var candidates = tracks
                .map(function (track) { return mapAcrTrackToMatch(track); })
                .filter(function (candidate) { return !!(candidate.title || candidate.artist); });

              if (!candidates.length) {
                reject(new Error("No match found"));
                return;
              }

              var primary = candidates[0];

              resolve({
                title: primary.title || "",
                artist: primary.artist || "",
                spotifyUri: primary.spotifyUri || null,
                spotifyAlbumId: primary.spotifyAlbumId || null,
                service: "ACRCloud",
                candidates: candidates,
              });
            } else {
              reject(new Error((data.status && data.status.msg) || "No match found"));
            }
          })
          .catch(reject);
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  function normalizeAcrHost(host) {
    host = trimmed(host);
    host = host.replace(/^https?:\/\//i, "");
    host = host.replace(/\/+$/, "");
    return host;
  }

  function getAcrTracks(data) {
    if (!data || !data.metadata) return [];
    var tracks = [];
    if (Array.isArray(data.metadata.music) && data.metadata.music.length > 0) {
      tracks = tracks.concat(data.metadata.music);
    }
    if (Array.isArray(data.metadata.humming) && data.metadata.humming.length > 0) {
      tracks = tracks.concat(data.metadata.humming);
    }
    return tracks;
  }

  function mapAcrTrackToMatch(track) {
    return {
      title: track && track.title ? track.title : "",
      artist: getTrackArtist(track),
      spotifyUri: getAcrSpotifyUri(track),
      spotifyAlbumId: getAcrSpotifyAlbumId(track),
      service: "ACRCloud",
    };
  }

  function getTrackArtist(track) {
    if (!track) return "";
    if (track.artists && track.artists.length > 0) {
      return track.artists.map(function (artist) {
        return artist && artist.name ? artist.name : "";
      }).filter(Boolean).join(", ");
    }
    return track.artist || "";
  }

  function getAcrSpotifyUri(track) {
    var spotifyTrack = track &&
      track.external_metadata &&
      track.external_metadata.spotify &&
      track.external_metadata.spotify.track;

    if (spotifyTrack && spotifyTrack.id) {
      return "spotify:track:" + spotifyTrack.id;
    }
    return null;
  }

  function getAcrSpotifyAlbumId(track) {
    var spotifyAlbum = track &&
      track.external_metadata &&
      track.external_metadata.spotify &&
      track.external_metadata.spotify.album;

    return spotifyAlbum && spotifyAlbum.id ? spotifyAlbum.id : null;
  }

  // ── Provider: AudD ─────────────────────────────────────────────────────────

  // AudD expects browser file uploads in a multipart/form-data request using
  // the "file" field.
  function queryAudD(blob, cfg) {
    return new Promise(function (resolve, reject) {
      var formData = new FormData();
      formData.append("api_token", cfg.apiToken);
      formData.append("file", blob, "spotizam.webm");
      formData.append("return", "spotify");

      debugLog("Sending AudD request", { bytes: blob.size, tokenPresent: !!trimmed(cfg.apiToken) });
      fetch("https://api.audd.io/", {
        method: "POST",
        body: formData,
      })
        .then(function (res) {
          debugLog("AudD response received", { ok: res.ok, status: res.status });
          return res.json().catch(function (err) {
            throw stageError("AudD response was not JSON", err);
          });
        })
        .then(function (data) {
          debugLog("AudD response payload", data);
          saveDebugJson(data);
          if (data.status === "success" && data.result) {
            var candidate = {
              title: data.result.title || "",
              artist: data.result.artist || "",
              spotifyUri: (data.result.spotify && data.result.spotify.uri) || null,
              spotifyAlbumId: data.result.spotify && data.result.spotify.album && data.result.spotify.album.id || null,
              service: "AudD",
            };
            resolve({
              title: candidate.title,
              artist: candidate.artist,
              spotifyUri: candidate.spotifyUri,
              spotifyAlbumId: candidate.spotifyAlbumId,
              service: "AudD",
              candidates: [candidate],
            });
          } else {
            reject(new Error(readAudDError(data)));
          }
        })
        .catch(function (err) {
          reject(stageError("AudD request failed", err));
        });
    });
  }

  function readAudDError(data) {
    if (!data) return "No match found";
    if (typeof data.error === "string") return data.error;
    if (data.error && data.error.error_message) return data.error.error_message;
    if (data.error && data.error.message) return data.error.message;
    if (data.error && data.error.code) return "AudD error " + data.error.code + ": " + stringifyError(data.error);
    if (data.status === "error") return stringifyError(data.error || data);
    return "No match found";
  }

  // ── Run selected provider ──────────────────────────────────────────────────

  // Only the active provider runs on each mic click.
  function runProvider(blob, cfg) {
    switch (cfg.provider) {
      case "acrcloud": return queryACRCloud(blob, cfg.acrcloud);
      case "audd": return queryAudD(blob, cfg.audd);
      default: return Promise.reject(new Error("Unknown provider: " + cfg.provider));
    }
  }

  function saveDebugAudio(blob, cfg) {
    if (!cfg.debug || !cfg.debug.keepAudio) return Promise.resolve();

    var timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    var provider = cfg.provider || "provider";
    var fileName = "spotizam-" + provider + "-" + timestamp + ".webm";

    debugLog("Keeping debug audio copy", {
      fileName: fileName,
      bytes: blob.size,
      requestedDirectory: cfg.debug.audioDirectory || "",
    });

    // If the user picked a folder for this Spotify session, write there.
    if (debugDirectoryHandle) {
      return debugDirectoryHandle.getFileHandle(fileName, { create: true })
        .then(function (handle) { return handle.createWritable(); })
        .then(function (writable) {
          return writable.write(blob).then(function () { return writable.close(); });
        })
        .then(function () {
          showToast("Saved debug audio: " + fileName, false);
        });
    }

    // Otherwise fall back to a normal browser download so the user still gets
    // a copy of the exact audio blob we sent to the provider.
    debugWarn("No debug audio folder handle selected; falling back to browser download");
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (link.parentElement) link.parentElement.removeChild(link);
    }, 1000);

    showToast("Downloading debug audio: " + fileName, false);
    return Promise.resolve();
  }

  function saveDebugJson(responseData) {
    normalizeDebugConfig(config);
    if (!config.debug.keepJson) return Promise.resolve();

    var timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    var provider = config.provider || "provider";
    var fileName = "spotizam-" + provider + "-response-" + timestamp + ".json";

    var jsonText;
    try {
      jsonText = JSON.stringify(responseData, null, 2);
    } catch (err) {
      reportError("Debug JSON serialization failed", err);
      return Promise.resolve();
    }

    var jsonBlob = new Blob([jsonText], { type: "application/json;charset=utf-8" });

    debugLog("Keeping debug JSON copy", {
      fileName: fileName,
      bytes: jsonBlob.size,
      requestedDirectory: config.debug.jsonDirectory || "",
    });

    if (debugJsonDirectoryHandle) {
      return debugJsonDirectoryHandle.getFileHandle(fileName, { create: true })
        .then(function (handle) { return handle.createWritable(); })
        .then(function (writable) {
          return writable.write(jsonBlob).then(function () { return writable.close(); });
        })
        .then(function () {
          showToast("Saved debug JSON: " + fileName, false);
        })
        .catch(function (err) {
          reportError("Debug JSON save failed", err);
        });
    }

    debugWarn("No debug JSON folder handle selected; falling back to browser download");
    var url = URL.createObjectURL(jsonBlob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (link.parentElement) link.parentElement.removeChild(link);
    }, 1000);

    showToast("Downloading debug JSON: " + fileName, false);
    return Promise.resolve();
  }

  // ── After match flow ───────────────────────────────────────────────────────

  // Once a provider returns a match, this shared path decides whether to open
  // the song, start playback, or do both based on saved settings.
  function handleMatch(result) {
    setButtonState("match");
    var msg = "Found via " + result.service + ": " + result.title + " \u2014 " + result.artist;
    showToast(msg, false);
    storeLatestResultsFromResult(result);
    recordHistoryFromResult(result);
    applyAfterMatchBehavior(result)
      .catch(function (err) {
        reportError("After-match behavior failed", err);
      });

    setTimeout(function () { setButtonState("idle"); }, 2000);
  }

  function buildStoredMatchItems(result, includeAllCandidates) {
    var source = (includeAllCandidates && Array.isArray(result.candidates) && result.candidates.length)
      ? result.candidates
      : [result];
    var seen = {};

    return source.map(function (candidate, index) {
      var title = trimmed(candidate && candidate.title);
      var artist = trimmed(candidate && candidate.artist);
      var spotifyUri = trimmed(candidate && candidate.spotifyUri) || null;
      var spotifyAlbumId = trimmed(candidate && candidate.spotifyAlbumId) || null;
      var searchQuery = makeSpotifySearchQuery(title, artist);
      var service = trimmed(candidate && candidate.service) || trimmed(result && result.service) || "Unknown";

      if (!title && !artist && !searchQuery) return null;

      var dedupeKey = [title.toLowerCase(), artist.toLowerCase(), spotifyUri || "", searchQuery.toLowerCase()].join("|");
      if (seen[dedupeKey]) return null;
      seen[dedupeKey] = true;

      return {
        title: title,
        artist: artist,
        spotifyUri: spotifyUri,
        spotifyAlbumId: spotifyAlbumId,
        searchQuery: searchQuery,
        service: service,
        timestamp: new Date().toISOString(),
        confidence: candidate && candidate.confidence != null ? Number(candidate.confidence) : null,
        isPrimary: index === 0,
      };
    }).filter(Boolean);
  }

  function storeLatestResultsFromResult(result) {
    var items = buildStoredMatchItems(result, true);
    if (!items.length) return;

    config.latestResults = {
      id: makeSearchBatchId(new Date().toISOString(), 0),
      timestamp: new Date().toISOString(),
      provider: config.provider,
      service: trimmed(result && result.service) || items[0].service || getProviderLabel(config.provider),
      query: makeSpotifySearchQuery(result && result.title, result && result.artist) || items[0].searchQuery,
      items: items,
    };
    saveConfig(config);
  }

  function recordHistoryFromResult(result) {
    normalizeHistoryConfig(config);
    if (!config.history.enabled) return;
    var newItems = buildStoredMatchItems(result, config.history.includeAllMatches);

    if (!newItems.length) return;

    var timestamp = new Date().toISOString();
    var batch = {
      id: makeSearchBatchId(timestamp, 0),
      timestamp: timestamp,
      provider: config.provider,
      service: trimmed(result && result.service) || newItems[0].service || getProviderLabel(config.provider),
      query: makeSpotifySearchQuery(result && result.title, result && result.artist) || newItems[0].searchQuery,
      items: newItems,
    };

    config.history.searches = [batch].concat(config.history.searches || []).slice(0, config.history.maxItems);
    saveConfig(config);
    refreshHistoryUi();
  }

  function applyAfterMatchBehavior(result) {
    var behavior = config.afterMatch || defaultConfig().afterMatch;
    var shouldOpenResultsPage = !!(config.resultsPage && config.resultsPage.openAfterRecognition);
    var shouldOpen = !!behavior.openSong;
    var shouldPlay = !!behavior.playSong;
    var playbackPromise;

    if (!shouldOpen && !shouldPlay && !shouldOpenResultsPage) shouldOpen = true;

    debugLog("Applying after-match behavior", {
      service: result.service,
      openSong: shouldOpen,
      playSong: shouldPlay,
      openResultsPage: shouldOpenResultsPage,
      spotifyUri: result.spotifyUri || null,
      spotifyAlbumId: result.spotifyAlbumId || null,
    });

    // Playback and navigation both work better when we have a Spotify URI, so
    // resolve it first if the provider did not give us one directly.
    playbackPromise = shouldPlay ? ensureSpotifyUri(result).then(function (spotifyUri) {
      if (!spotifyUri) return;
      try {
        if (typeof Spicetify !== "undefined" && Spicetify.Player && Spicetify.Player.playUri) {
          debugLog("Playing matched Spotify URI", spotifyUri);
          Spicetify.Player.playUri(spotifyUri);
        }
      } catch (err) {
        reportError("Could not play matched song", err);
      }
    }) : Promise.resolve();

    if (shouldOpenResultsPage) {
      if (shouldOpen) {
        debugLog("Results page auto-open is enabled; skipping immediate song-page navigation");
      }
      return playbackPromise.then(function () {
        openResultsPage();
      });
    }

    if (shouldOpen) {
      return ensureSpotifyUri(result).then(function () {
        return openMatchedSong(result, shouldPlay);
      }).then(function () {
        return playbackPromise;
      });
    }

    return playbackPromise;
  }

  function openMatchedSong(result, allowTrackFallback) {
    if (result.spotifyUri && /^spotify:track:/.test(result.spotifyUri)) {
      return ensureSpotifyAlbumId(result).then(function (albumId) {
        var trackId = result.spotifyUri.split(":")[2];
        // Prefer the album page with the track highlighted. This acts more like
        // a "details" page and is less likely to trigger playback by surprise.
        if (albumId && trackId && typeof Spicetify !== "undefined" && Spicetify.Platform && Spicetify.Platform.History) {
          debugLog("Opening matched album page with highlighted track", { albumId: albumId, trackId: trackId });
          Spicetify.Platform.History.push("/album/" + albumId + "?highlight=" + encodeURIComponent(result.spotifyUri));
          return;
        }

        if (allowTrackFallback && trackId && typeof Spicetify !== "undefined" && Spicetify.Platform && Spicetify.Platform.History) {
          debugLog("Opening matched track page", trackId);
          Spicetify.Platform.History.push("/track/" + trackId);
          return;
        }

        debugLog("Album context unavailable; falling back to search page", {
          trackId: trackId,
          allowTrackFallback: allowTrackFallback,
        });
        openMatchedSearch(result);
      });
    }

    openMatchedSearch(result);
    return Promise.resolve();
  }

  function openMatchedSearch(result) {
    var query = makeSpotifySearchQuery(result.title, result.artist);
    openSpotifySearchQuery(query);
  }

  function openSpotifySearchQuery(query) {
    query = trimmed(query);
    if (!query) return;
    if (typeof Spicetify !== "undefined" && Spicetify.Platform && Spicetify.Platform.History) {
      debugLog("Opening search query", query);
      Spicetify.Platform.History.push("/search/" + encodeURIComponent(query));
    }
  }

  function openSpotifyUriInApp(spotifyUri) {
    var uri = trimmed(spotifyUri);
    if (!uri) return false;
    if (typeof Spicetify === "undefined" || !Spicetify.Platform || !Spicetify.Platform.History) return false;

    var parts = uri.split(":");
    if (parts.length !== 3) return false;

    var type = parts[1];
    var id = parts[2];
    if (!type || !id) return false;

    Spicetify.Platform.History.push("/" + type + "/" + id);
    return true;
  }

  function ensureSpotifyUri(result) {
    if (result.spotifyUri) {
      debugLog("Using provider-supplied Spotify URI", result.spotifyUri);
      return Promise.resolve(result.spotifyUri);
    }
    debugLog("No provider-supplied Spotify URI; falling back to Spotify search", {
      title: result.title,
      artist: result.artist,
      service: result.service,
    });
    // If the provider did not supply a Spotify URI, use Spotify search as a
    // fallback resolver so post-match actions still work across all providers.
    return resolveSpotifyMatchFromSearch(result.title, result.artist).then(function (match) {
      if (match && match.uri) {
        result.spotifyUri = match.uri;
        result.spotifyAlbumId = result.spotifyAlbumId || match.albumId || null;
      }
      return result.spotifyUri || null;
    });
  }

  function ensureSpotifyAlbumId(result) {
    if (result.spotifyAlbumId) return Promise.resolve(result.spotifyAlbumId);
    if (typeof Spicetify === "undefined" || !Spicetify.CosmosAsync) return Promise.resolve(null);

    // Try search first because it often includes album information without an
    // extra API call. If that fails, ask Spotify for track details directly.
    return resolveSpotifyMatchFromSearch(result.title, result.artist).then(function (match) {
      if (match && match.albumId) {
        result.spotifyAlbumId = match.albumId;
        if (!result.spotifyUri && match.uri) result.spotifyUri = match.uri;
        debugLog("Resolved Spotify album ID from search", result.spotifyAlbumId);
        return result.spotifyAlbumId;
      }

      if (!result.spotifyUri || !/^spotify:track:/.test(result.spotifyUri)) return null;

      var trackId = result.spotifyUri.split(":")[2];
      if (!trackId) return null;

      return Spicetify.CosmosAsync.get("https://api.spotify.com/v1/tracks/" + trackId)
        .then(function (data) {
          debugLog("Spotify track payload", data);
          var albumId = data && data.album && data.album.id ? data.album.id : null;
          result.spotifyAlbumId = albumId;
          return albumId;
        })
        .catch(function (err) {
          reportError("Spotify track lookup failed", err);
          return null;
        });
    });
  }

  function resolveSpotifyMatchFromSearch(title, artist) {
    var query = [title, artist].filter(Boolean).join(" ").trim();
    if (!query) return Promise.resolve(null);
    if (typeof Spicetify === "undefined" || !Spicetify.CosmosAsync) return Promise.resolve(null);

    debugLog("Resolving Spotify URI from search", { title: title, artist: artist, query: query });

    return Spicetify.CosmosAsync.get(
      "https://api.spotify.com/v1/search?type=track&limit=5&q=" + encodeURIComponent(query)
    )
      .then(function (data) {
        debugLog("Spotify search payload", data);
        var items = data && data.tracks && data.tracks.items ? data.tracks.items : [];
        var bestMatch = pickBestSpotifyTrack(items, title, artist);
        if (!bestMatch || !bestMatch.uri) return null;
        return {
          uri: bestMatch.uri,
          albumId: bestMatch.album && bestMatch.album.id ? bestMatch.album.id : null,
        };
      })
      .catch(function (err) {
        reportError("Spotify search lookup failed", err);
        return null;
      });
  }

  // Spotify search can return several close matches. This lightweight scorer
  // prefers exact title and artist matches before weaker partial matches.
  function pickBestSpotifyTrack(items, title, artist) {
    if (!items || !items.length) return null;

    var wantedTitle = normalizeSearchText(title);
    var wantedArtist = normalizeSearchText(artist);
    var bestItem = items[0];
    var bestScore = -1;

    items.forEach(function (item) {
      var itemTitle = normalizeSearchText(item && item.name);
      var itemArtist = normalizeSearchText(item && item.artists && item.artists.map(function (a) {
        return a && a.name ? a.name : "";
      }).join(" "));
      var score = 0;

      if (itemTitle === wantedTitle) score += 3;
      else if (itemTitle.indexOf(wantedTitle) !== -1 || wantedTitle.indexOf(itemTitle) !== -1) score += 1;

      if (wantedArtist && itemArtist.indexOf(wantedArtist) !== -1) score += 3;
      else if (wantedArtist && hasArtistTokenOverlap(itemArtist, wantedArtist)) score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    });

    debugLog("Best Spotify search match", bestItem);
    return bestItem;
  }

  function normalizeSearchText(value) {
    return trimmed(value).toLowerCase().replace(/[^\w\s]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function hasArtistTokenOverlap(left, right) {
    var leftTokens = left.split(" ").filter(Boolean);
    var rightTokens = right.split(" ").filter(Boolean);
    return rightTokens.some(function (token) {
      return leftTokens.indexOf(token) !== -1;
    });
  }

  function handleError(err) {
    setButtonState("error");
    var msg = reportError("Recognition failed", err && err.originalError ? err.originalError : err);
    showToast(msg, true);
    setTimeout(function () { setButtonState("idle"); }, 2000);
  }

  // ── Mic button click handler ───────────────────────────────────────────────

  // Clicking the mic either starts a new recording or stops the current one
  // after the minimum record time has passed.
  function onMicClick(e) {
    debugLog("Mic click handler fired");

    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (currentState === "recording") {
      debugLog("Mic clicked during recording; attempting early stop");
      if (activeRecording) activeRecording.stop();
      return;
    }
    if (currentState === "processing") {
      debugLog("Mic click ignored because recognition is processing");
      return;
    }

    config = loadConfig();
    debugLog("Mic clicked", { provider: config.provider });

    if (credentialsMissing(config)) {
      debugWarn("Missing credentials for provider", config.provider);
      // Ask user to fill credentials and retry recording after save
      pendingAction = 'recordAfterSave';
      openSettingsPanel(true);
      return;
    }

    setButtonState("recording", "Recording for at least 15 seconds...");

    captureAudio(config.recordingSeconds)
      .then(function (blob) {
        var providerLabel = getProviderLabel(config.provider);
        setButtonState("processing", "Listening via " + providerLabel + "...");
        return saveDebugAudio(blob, config)
          .catch(function (err) {
            reportError("Debug audio save failed", err);
          })
          .then(function () {
            return runProvider(blob, config);
          });
      })
      .then(handleMatch)
      .catch(handleError);
  }

  // ── Settings panel ─────────────────────────────────────────────────────────

  // The settings panel is plain DOM on purpose so the extension stays easy to
  // drop into Spicetify without React, bundlers, or external UI libraries.
  function buildSettingsPanel() {
    var panel = document.createElement("div");
    panel.className = "spotizam-detect-panel";
    panel.id = "spotizam-detect-panel";

    // Header
    var header = document.createElement("div");
    header.className = "spotizam-detect-panel__header";

    var title = document.createElement("div");
    title.className = "spotizam-detect-panel__title";
    title.textContent = "Spotizam Settings";

    var closeBtn = document.createElement("button");
    closeBtn.className = "spotizam-detect-panel__close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close settings");
    closeBtn.innerHTML = ICON_X;
    closeBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeSettingsPanel();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Warning box
    var warning = document.createElement("div");
    warning.className = "spotizam-detect-panel__warning";
    warning.id = "spotizam-detect-warning";
    panel.appendChild(warning);

    // Toast / success box
    var toast = document.createElement("div");
    toast.className = "spotizam-detect-panel__toast";
    toast.id = "spotizam-detect-toast";
    panel.appendChild(toast);

    // Provider dropdown
    var labelProvider = document.createElement("label");
    labelProvider.className = "spotizam-detect-panel__label";
    labelProvider.textContent = "Recognition Provider";

    var select = document.createElement("select");
    select.className = "spotizam-detect-panel__select";
    select.id = "spotizam-detect-provider-select";

    PROVIDERS.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      select.appendChild(opt);
    });

    panel.appendChild(labelProvider);
    panel.appendChild(select);

    var recordingLabel = document.createElement("label");
    recordingLabel.className = "spotizam-detect-panel__label";
    recordingLabel.textContent = "Recording Length";

    var recordingInput = document.createElement("input");
    recordingInput.className = "spotizam-detect-panel__input";
    recordingInput.id = "spotizam-detect-recording-seconds";
    recordingInput.type = "number";
    recordingInput.min = String(MIN_RECORDING_SECONDS);
    recordingInput.max = String(MAX_RECORDING_SECONDS);
    recordingInput.step = "1";

    var recordingHint = document.createElement("div");
    recordingHint.className = "spotizam-detect-panel__hint";
    recordingHint.textContent = "15-30 seconds. After 15 seconds, click the mic again to stop early.";

    panel.appendChild(recordingLabel);
    panel.appendChild(recordingInput);
    panel.appendChild(recordingHint);

    var afterMatchLabel = document.createElement("label");
    afterMatchLabel.className = "spotizam-detect-panel__label";
    afterMatchLabel.textContent = "After Match";

    var openSongInput = document.createElement("input");
    openSongInput.id = "spotizam-detect-open-song";
    openSongInput.type = "checkbox";

    var playSongInput = document.createElement("input");
    playSongInput.id = "spotizam-detect-play-song";
    playSongInput.type = "checkbox";

    var openSongRow = createCheckboxRow(openSongInput, "Open song page");
    var playSongRow = createCheckboxRow(playSongInput, "Start playing immediately");

    var openResultsPageInput = document.createElement("input");
    openResultsPageInput.id = "spotizam-detect-open-results-page";
    openResultsPageInput.type = "checkbox";
    var openResultsPageRow = createCheckboxRow(openResultsPageInput, "Open results page after recognition");
    var openResultsPageHint = document.createElement("div");
    openResultsPageHint.className = "spotizam-detect-panel__hint";
    openResultsPageHint.textContent = "When this is on, Spotizam opens its custom app results page instead of jumping straight to the matched song page.";

    function syncAfterMatchUi() {
      if (openResultsPageInput.checked) {
        openSongInput.checked = false;
        playSongInput.checked = false;
        openSongInput.disabled = true;
        playSongInput.disabled = true;
        return;
      }

      openSongInput.disabled = false;
      playSongInput.disabled = false;
      if (!openSongInput.checked && !playSongInput.checked) {
        openSongInput.checked = true;
      }
    }

    openResultsPageInput.addEventListener("change", syncAfterMatchUi);
    openSongInput.addEventListener("change", function () {
      if (!openResultsPageInput.checked && !openSongInput.checked && !playSongInput.checked) {
        openSongInput.checked = true;
      }
    });
    playSongInput.addEventListener("change", function () {
      if (!openResultsPageInput.checked && !openSongInput.checked && !playSongInput.checked) {
        openSongInput.checked = true;
      }
    });

    panel.appendChild(afterMatchLabel);
    panel.appendChild(openSongRow);
    panel.appendChild(playSongRow);
    panel.appendChild(openResultsPageRow);
    panel.appendChild(openResultsPageHint);
    syncAfterMatchUi();

    var keepAudioInput = document.createElement("input");
    keepAudioInput.id = "spotizam-detect-keep-audio";
    keepAudioInput.type = "checkbox";

    var keepAudioRow = createCheckboxRow(keepAudioInput, "Keep copy of recorded audio");

    var audioDirectoryLabel = document.createElement("label");
    audioDirectoryLabel.className = "spotizam-detect-panel__label";
    audioDirectoryLabel.textContent = "Saved Audio Directory";

    var audioDirectoryInput = document.createElement("input");
    audioDirectoryInput.className = "spotizam-detect-panel__input";
    audioDirectoryInput.id = "spotizam-detect-audio-directory";
    audioDirectoryInput.type = "text";
    audioDirectoryInput.readOnly = true;
    audioDirectoryInput.placeholder = "No folder selected";

    var audioDirectoryButton = document.createElement("button");
    audioDirectoryButton.className = "spotizam-detect-panel__folder";
    audioDirectoryButton.type = "button";
    audioDirectoryButton.textContent = "Choose";

    var audioDirectoryRow = document.createElement("div");
    audioDirectoryRow.className = "spotizam-detect-panel__folder-row";
    audioDirectoryRow.appendChild(audioDirectoryInput);
    audioDirectoryRow.appendChild(audioDirectoryButton);

    var audioDirectoryHint = document.createElement("div");
    audioDirectoryHint.className = "spotizam-detect-panel__hint";
    audioDirectoryHint.textContent = "Choose a folder for this Spotify session. If unavailable, saved audio falls back to Downloads.";

    audioDirectoryButton.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      chooseDebugAudioDirectory(audioDirectoryInput);
    });

    panel.appendChild(keepAudioRow);
    panel.appendChild(audioDirectoryLabel);
    panel.appendChild(audioDirectoryRow);
    panel.appendChild(audioDirectoryHint);

    var historyEnabledInput = document.createElement("input");
    historyEnabledInput.id = "spotizam-detect-history-enabled";
    historyEnabledInput.type = "checkbox";
    var historyEnabledRow = createCheckboxRow(historyEnabledInput, "Enable recognition history");

    var historyLimitLabel = document.createElement("label");
    historyLimitLabel.className = "spotizam-detect-panel__label";
    historyLimitLabel.textContent = "History size";

    var historyLimitInput = document.createElement("input");
    historyLimitInput.className = "spotizam-detect-panel__input";
    historyLimitInput.id = "spotizam-detect-history-max-items";
    historyLimitInput.type = "number";
    historyLimitInput.min = String(MIN_HISTORY_ITEMS);
    historyLimitInput.max = String(MAX_HISTORY_ITEMS);
    historyLimitInput.step = "1";

    var historyLimitHint = document.createElement("div");
    historyLimitHint.className = "spotizam-detect-panel__hint";
    historyLimitHint.textContent = "Keep between 1 and 10 recent search batches.";

    var historyIncludeAllInput = document.createElement("input");
    historyIncludeAllInput.id = "spotizam-detect-history-include-all";
    historyIncludeAllInput.type = "checkbox";
    var historyIncludeAllRow = createCheckboxRow(historyIncludeAllInput, "Include all provider matches when available");

    var historySection = document.createElement("div");
    historySection.className = "spotizam-detect-panel__history";

    var historyTitle = document.createElement("div");
    historyTitle.className = "spotizam-detect-panel__history-title";
    historyTitle.textContent = "History";

    var historyOpenPageButton = document.createElement("button");
    historyOpenPageButton.type = "button";
    historyOpenPageButton.className = "spotizam-detect-panel__folder";
    historyOpenPageButton.textContent = "Open Results Page";
    historyOpenPageButton.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeSettingsPanel();
      openResultsPage();
    });

    var historyHeaderRow = document.createElement("div");
    historyHeaderRow.style.display = "flex";
    historyHeaderRow.style.alignItems = "center";
    historyHeaderRow.style.justifyContent = "space-between";
    historyHeaderRow.style.gap = "8px";
    historyHeaderRow.appendChild(historyTitle);
    historyHeaderRow.appendChild(historyOpenPageButton);

    var historyEmpty = document.createElement("div");
    historyEmpty.className = "spotizam-detect-panel__history-empty";
    historyEmpty.textContent = "No history yet.";

    var historyList = document.createElement("div");
    historyList.className = "spotizam-detect-panel__history-list";

    historySection.appendChild(historyHeaderRow);
    historySection.appendChild(historyEmpty);
    historySection.appendChild(historyList);

    var debugJsonLabel = document.createElement("label");
    debugJsonLabel.className = "spotizam-detect-panel__label";
    debugJsonLabel.textContent = "Debug JSON";

    var debugJsonInput = document.createElement("input");
    debugJsonInput.id = "spotizam-detect-keep-json";
    debugJsonInput.type = "checkbox";
    var debugJsonRow = createCheckboxRow(debugJsonInput, "Keep copy of returned JSON");

    var debugJsonDirectoryLabel = document.createElement("label");
    debugJsonDirectoryLabel.className = "spotizam-detect-panel__label";
    debugJsonDirectoryLabel.textContent = "Saved JSON Directory";

    var debugJsonDirectoryInput = document.createElement("input");
    debugJsonDirectoryInput.className = "spotizam-detect-panel__input";
    debugJsonDirectoryInput.id = "spotizam-detect-json-directory";
    debugJsonDirectoryInput.type = "text";
    debugJsonDirectoryInput.readOnly = true;
    debugJsonDirectoryInput.placeholder = "No folder selected";

    var debugJsonDirectoryButton = document.createElement("button");
    debugJsonDirectoryButton.className = "spotizam-detect-panel__folder";
    debugJsonDirectoryButton.type = "button";
    debugJsonDirectoryButton.textContent = "Choose";

    var debugJsonDirectoryRow = document.createElement("div");
    debugJsonDirectoryRow.className = "spotizam-detect-panel__folder-row";
    debugJsonDirectoryRow.appendChild(debugJsonDirectoryInput);
    debugJsonDirectoryRow.appendChild(debugJsonDirectoryButton);

    var debugJsonHint = document.createElement("div");
    debugJsonHint.className = "spotizam-detect-panel__hint";
    debugJsonHint.textContent = "Choose a folder for this Spotify session. If unavailable, saved JSON falls back to Downloads.";

    function updateDebugJsonUi() {
      debugJsonDirectoryInput.disabled = false;
      debugJsonDirectoryButton.disabled = false;
    }

    debugJsonInput.addEventListener("change", function () {
      updateDebugJsonUi();
    });

    debugJsonDirectoryButton.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      chooseDebugJsonDirectory(debugJsonDirectoryInput);
    });

    updateDebugJsonUi();

    var latestSection = document.createElement("div");
    latestSection.className = "spotizam-detect-panel__section";
    var latestSectionTitle = document.createElement("div");
    latestSectionTitle.className = "spotizam-detect-panel__section-title";
    latestSectionTitle.textContent = "Latest Result";
    var latestEmpty = document.createElement("div");
    latestEmpty.className = "spotizam-detect-panel__history-empty";
    latestEmpty.textContent = "No latest result yet.";
    var latestList = document.createElement("div");
    latestList.className = "spotizam-detect-panel__history-list";
    latestSection.appendChild(latestSectionTitle);
    latestSection.appendChild(latestEmpty);
    latestSection.appendChild(latestList);

    var historySettingsSection = document.createElement("div");
    historySettingsSection.className = "spotizam-detect-panel__section";
    var historySettingsTitle = document.createElement("div");
    historySettingsTitle.className = "spotizam-detect-panel__section-title";
    historySettingsTitle.textContent = "History";
    historySettingsSection.appendChild(historySettingsTitle);
    historySettingsSection.appendChild(historyEnabledRow);
    historySettingsSection.appendChild(historyLimitLabel);
    historySettingsSection.appendChild(historyLimitInput);
    historySettingsSection.appendChild(historyLimitHint);
    historySettingsSection.appendChild(historyIncludeAllRow);
    historySettingsSection.appendChild(historySection);

    var debugSection = document.createElement("div");
    debugSection.className = "spotizam-detect-panel__section";
    var debugSectionTitle = document.createElement("div");
    debugSectionTitle.className = "spotizam-detect-panel__section-title";
    debugSectionTitle.textContent = "Debug JSON";
    debugSection.appendChild(debugSectionTitle);
    debugSection.appendChild(debugJsonRow);
    debugSection.appendChild(debugJsonDirectoryLabel);
    debugSection.appendChild(debugJsonDirectoryRow);
    debugSection.appendChild(debugJsonHint);

    panel.appendChild(latestSection);
    panel.appendChild(historySettingsSection);
    panel.appendChild(debugSection);

    historyEnabledInput.addEventListener("change", function () {
      refreshHistoryUi();
    });

    // Dynamic credentials container
    var fieldsContainer = document.createElement("div");
    fieldsContainer.id = "spotizam-detect-fields";
    panel.appendChild(fieldsContainer);

    // Build only one panel, then swap provider-specific field groups in and out.
    var fieldSets = {};

    // ACRCloud fields
    var acrFields = document.createElement("div");
    acrFields.id = "spotizam-detect-fields-acrcloud";
    acrFields.style.display = "none";

    var hostLabel = el("label", "spotizam-detect-panel__label", "Host");
    var hostInput = el("input", "spotizam-detect-panel__input", "");
    hostInput.type = "text";
    hostInput.id = "spotizam-detect-acr-host";
    hostInput.placeholder = "identify-eu-west-1.acrcloud.com";

    var keyLabel = el("label", "spotizam-detect-panel__label", "Access Key");
    var keySecret = createSecretInput("spotizam-detect-acr-key", "Your ACRCloud access key");
    var keyInput = keySecret.input;

    var secretLabel = el("label", "spotizam-detect-panel__label", "Access Secret");
    var secretSecret = createSecretInput("spotizam-detect-acr-secret", "Your ACRCloud access secret");
    var secretInput = secretSecret.input;

    var acrSignup = el("a", "spotizam-detect-panel__signup", "Get ACRCloud API key \u2192");
    acrSignup.href = "#";
    acrSignup.target = "_blank";
    acrSignup.rel = "noopener noreferrer";
    acrSignup.onclick = function (e) { e.preventDefault(); window.open(getSignupUrl("acrcloud"), "_blank"); };

    acrFields.appendChild(hostLabel);
    acrFields.appendChild(hostInput);
    acrFields.appendChild(keyLabel);
    acrFields.appendChild(keySecret.row);
    acrFields.appendChild(secretLabel);
    acrFields.appendChild(secretSecret.row);
    acrFields.appendChild(acrSignup);
    fieldSets.acrcloud = acrFields;

    // AudD fields
    var auddFields = document.createElement("div");
    auddFields.id = "spotizam-detect-fields-audd";
    auddFields.style.display = "none";

    var auddTokenLabel = el("label", "spotizam-detect-panel__label", "API Token");
    var auddTokenSecret = createSecretInput("spotizam-detect-audd-token", "Your AudD API token");
    var auddTokenInput = auddTokenSecret.input;

    var auddSignup = el("a", "spotizam-detect-panel__signup", "Get AudD API key \u2192");
    auddSignup.href = "#";
    auddSignup.target = "_blank";
    auddSignup.rel = "noopener noreferrer";
    auddSignup.onclick = function (e) { e.preventDefault(); window.open(getSignupUrl("audd"), "_blank"); };

    auddFields.appendChild(auddTokenLabel);
    auddFields.appendChild(auddTokenSecret.row);
    auddFields.appendChild(auddSignup);
    fieldSets.audd = auddFields;

    fieldsContainer.appendChild(acrFields);
    fieldsContainer.appendChild(auddFields);

    // Save button
    var saveBtn = document.createElement("button");
    saveBtn.className = "spotizam-detect-panel__save";
    saveBtn.textContent = "Save";
    saveBtn.onclick = function () {
      config.provider = select.value;
      config.recordingSeconds = clampRecordingSeconds(recordingInput.value);
      config.afterMatch.openSong = !!openSongInput.checked;
      config.afterMatch.playSong = !!playSongInput.checked;
      config.resultsPage.openAfterRecognition = !!openResultsPageInput.checked;
      config.history.enabled = !!historyEnabledInput.checked;
      config.history.maxItems = clampHistoryItems(historyLimitInput.value);
      config.history.includeAllMatches = !!historyIncludeAllInput.checked;
      config.debug.keepJson = !!debugJsonInput.checked;
      config.debug.jsonDirectory = debugJsonDirectoryInput.value.trim();
      config.history.searches = (config.history.searches || []).slice(0, config.history.maxItems);
      config.debug.keepAudio = !!keepAudioInput.checked;
      config.debug.audioDirectory = audioDirectoryInput.value.trim();

      config.acrcloud.host = hostInput.value.trim();
      config.acrcloud.accessKey = keyInput.value.trim();
      config.acrcloud.accessSecret = secretInput.value.trim();

      config.audd.apiToken = auddTokenInput.value.trim();

      // If required credentials are missing, ask for confirmation before saving
      if (credentialsMissing(config)) {
        try {
          var providerLabel = getProviderLabel(config.provider);
          var ok = confirm(providerLabel + " credentials appear to be missing. Saving now may cause recognition to fail. Are you sure you want to save? ");
          if (!ok) {
            settingsPanel._built.warning.textContent = "Please add your " + providerLabel + " API key to get started";
            settingsPanel._built.warning.className = "spotizam-detect-panel__warning spotizam-detect-panel__warning--visible";
            return;
          }
        } catch (e) {}
      }

      saveConfig(config);
      debugLog("Settings saved", {
        provider: config.provider,
        recordingSeconds: config.recordingSeconds,
        afterMatch: config.afterMatch,
        resultsPage: config.resultsPage,
        history: {
          enabled: config.history.enabled,
          maxItems: config.history.maxItems,
          includeAllMatches: config.history.includeAllMatches,
          storedSearches: (config.history.searches || []).length,
        },
        keepAudio: config.debug.keepAudio,
        audioDirectory: config.debug.audioDirectory,
        acrcloud: {
          hostPresent: !!trimmed(config.acrcloud.host),
          accessKeyPresent: !!trimmed(config.acrcloud.accessKey),
          accessSecretPresent: !!trimmed(config.acrcloud.accessSecret),
        },
        audd: { apiTokenPresent: !!trimmed(config.audd.apiToken) },
      });
      showToast("Settings saved", false);

      toast.textContent = "Settings saved!";
      toast.className = "spotizam-detect-panel__toast spotizam-detect-panel__toast--visible";
      setTimeout(function () {
        toast.className = "spotizam-detect-panel__toast";
      }, 2500);

      // If the user wanted to record, and credentials are now present, retry.
      if (pendingAction === 'recordAfterSave') {
        pendingAction = null;
        if (credentialsMissing(config)) {
          showToast('Credentials still missing; cannot start recording', true);
        } else {
          closeSettingsPanel();
          // Give UI a moment to close before triggering recording
          setTimeout(function () { onMicClick(); }, 250);
        }
      }
    };

    panel.appendChild(saveBtn);

    // Provider change handler
    select.onchange = function () {
      showFieldSet(select.value, fieldSets);
    };

    return {
      panel: panel,
      fieldSets: fieldSets,
      select: select,
      recordingInput: recordingInput,
      openSongInput: openSongInput,
      playSongInput: playSongInput,
      openResultsPageInput: openResultsPageInput,
      historyEnabledInput: historyEnabledInput,
      historyLimitInput: historyLimitInput,
      historyIncludeAllInput: historyIncludeAllInput,
      latestSection: latestSection,
      latestEmpty: latestEmpty,
      latestList: latestList,
      historySection: historySection,
      historyOpenPageButton: historyOpenPageButton,
      historyEmpty: historyEmpty,
      historyList: historyList,
      debugJsonInput: debugJsonInput,
      debugJsonDirectoryInput: debugJsonDirectoryInput,
      debugJsonDirectoryButton: debugJsonDirectoryButton,
      keepAudioInput: keepAudioInput,
      audioDirectoryInput: audioDirectoryInput,
      warning: warning,
      toast: toast,
      syncAfterMatchUi: syncAfterMatchUi,
      inputs: {
        acr: { host: hostInput, key: keyInput, secret: secretInput },
        audd: auddTokenInput,
      },
    };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function createSecretInput(id, placeholder) {
    // API keys stay hidden by default, and the eye button only toggles
    // visibility for the current edit session.
    var row = document.createElement("div");
    row.className = "spotizam-detect-panel__secret-row";

    var input = document.createElement("input");
    input.className = "spotizam-detect-panel__input";
    input.type = "password";
    input.id = id;
    input.placeholder = placeholder;
    input.autocomplete = "off";

    var button = document.createElement("button");
    button.className = "spotizam-detect-panel__eye";
    button.type = "button";
    button.title = "Show key";
    button.innerHTML = ICON_EYE;
    button.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (input.type === "password") {
        input.type = "text";
        button.title = "Hide key";
        button.innerHTML = ICON_EYE_OFF;
      } else {
        input.type = "password";
        button.title = "Show key";
        button.innerHTML = ICON_EYE;
      }
      input.focus();
    });

    row.appendChild(input);
    row.appendChild(button);
    return { row: row, input: input, button: button };
  }

  function createCheckboxRow(input, text) {
    var row = document.createElement("label");
    row.className = "spotizam-detect-panel__checkrow";

    var label = document.createElement("span");
    label.textContent = text;

    row.appendChild(input);
    row.appendChild(label);
    return row;
  }

  function chooseDebugAudioDirectory(displayInput) {
    if (!window.showDirectoryPicker) {
      showToast("Folder picker is not available in this Spotify runtime. Debug audio will download instead.", true);
      debugWarn("showDirectoryPicker is not available");
      return;
    }

    // Folder handles are permission-based browser objects, so we keep them in
    // memory for the current Spotify session rather than trying to serialize them.
    window.showDirectoryPicker({ mode: "readwrite" })
      .then(function (handle) {
        debugDirectoryHandle = handle;
        if (displayInput) displayInput.value = handle.name || "Selected folder";
        config.debug.audioDirectory = handle.name || "Selected folder";
        saveConfig(config);
        debugLog("Debug audio folder selected", config.debug.audioDirectory);
        showToast("Debug audio folder selected: " + config.debug.audioDirectory, false);
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          debugLog("Debug audio folder selection canceled");
          return;
        }
        reportError("Debug audio folder selection failed", err);
        showToast("Could not select debug audio folder", true);
      });
  }

  function chooseDebugJsonDirectory(displayInput) {
    if (!window.showDirectoryPicker) {
      showToast("Folder picker is not available in this Spotify runtime. Debug JSON will download instead.", true);
      debugWarn("showDirectoryPicker is not available");
      return;
    }

    window.showDirectoryPicker({ mode: "readwrite" })
      .then(function (handle) {
        debugJsonDirectoryHandle = handle;
        if (displayInput) displayInput.value = handle.name || "Selected folder";
        config.debug.jsonDirectory = handle.name || "Selected folder";
        saveConfig(config);
        debugLog("Debug JSON folder selected", config.debug.jsonDirectory);
        showToast("Debug JSON folder selected: " + config.debug.jsonDirectory, false);
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          debugLog("Debug JSON folder selection canceled");
          return;
        }
        reportError("Debug JSON folder selection failed", err);
        showToast("Could not select debug JSON folder", true);
      });
  }

  function showFieldSet(providerId, fieldSets) {
    Object.keys(fieldSets).forEach(function (key) {
      fieldSets[key].style.display = key === providerId ? "block" : "none";
    });
  }

  function refreshHistoryUi() {
    if (!settingsPanel || !settingsPanel._built) return;
    renderLatestResultsSection(settingsPanel._built, config);
    renderHistorySection(settingsPanel._built, config);
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) return "";
    try {
      return new Date(timestamp).toLocaleString();
    } catch (_) {
      return timestamp;
    }
  }

  function renderActionButtons(container, item) {
    var query = item.searchQuery || makeSpotifySearchQuery(item.title, item.artist);

    if (item.spotifyUri) {
      var songLink = document.createElement("a");
      songLink.href = "#";
      songLink.className = "spotizam-detect-panel__history-link";
      songLink.textContent = "Open Song";
      songLink.addEventListener("click", function (e) {
        e.preventDefault();
        openSpotifyUriInApp(item.spotifyUri);
      });
      container.appendChild(songLink);
      if (/^spotify:track:/.test(item.spotifyUri)) {
        var playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "spotizam-detect-panel__history-link";
        playBtn.textContent = "Play";
        playBtn.addEventListener("click", function () {
          try {
            if (typeof Spicetify !== "undefined" && Spicetify.Player && Spicetify.Player.playUri) {
              Spicetify.Player.playUri(item.spotifyUri);
            }
          } catch (err) {
            reportError("Could not play history item", err);
          }
        });
        container.appendChild(playBtn);
      }
    }

    if (query) {
      var searchLink = document.createElement("a");
      searchLink.href = "#";
      searchLink.className = "spotizam-detect-panel__history-link";
      searchLink.textContent = "Search on Spotify";
      searchLink.addEventListener("click", function (e) {
        e.preventDefault();
        openSpotifySearchQuery(query);
      });
      container.appendChild(searchLink);

      var copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "spotizam-detect-panel__history-copy";
      copyBtn.textContent = "Copy Query";
      copyBtn.addEventListener("click", function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(query)
            .then(function () { showToast("Search query copied", false); })
            .catch(function () { showToast("Could not copy query", true); });
          return;
        }
        showToast("Clipboard is unavailable in this runtime", true);
      });
      container.appendChild(copyBtn);
    }
  }

  function buildMatchRow(item, nested) {
    var row = document.createElement("div");
    row.className = "spotizam-detect-panel__history-item" + (nested ? " spotizam-detect-panel__history-item--nested" : "");

    var title = document.createElement("div");
    title.className = "spotizam-detect-panel__history-item-title";
    title.textContent = (item.title || "Unknown title") + (item.artist ? " - " + item.artist : "");

    var meta = document.createElement("div");
    meta.className = "spotizam-detect-panel__history-item-meta";
    meta.textContent = [
      item.service || "Unknown",
      item.confidence != null && !isNaN(Number(item.confidence)) ? ("confidence " + item.confidence) : "",
    ].filter(Boolean).join(" | ");

    var actions = document.createElement("div");
    actions.className = "spotizam-detect-panel__history-actions";
    renderActionButtons(actions, item);

    row.appendChild(title);
    row.appendChild(meta);
    row.appendChild(actions);
    return row;
  }

  function buildBatchRow(batch, options) {
    var opts = options || {};
    var row = document.createElement("div");
    row.className = "spotizam-detect-panel__history-item";

    var items = Array.isArray(batch.items) ? batch.items : [];
    var first = items[0] || {};
    var isGrouped = items.length > 1;

    var summary = document.createElement("div");
    summary.className = "spotizam-detect-panel__history-group-summary";

    var left = document.createElement("div");
    var title = document.createElement("div");
    title.className = "spotizam-detect-panel__history-item-title";
    title.textContent = (first.title || "Unknown title") + (first.artist ? " - " + first.artist : "");
    var meta = document.createElement("div");
    meta.className = "spotizam-detect-panel__history-group-copy";
    meta.textContent = formatTimestamp(batch.timestamp) + " | " + (batch.service || "Unknown") + " | " + items.length + (items.length === 1 ? " result" : " results");
    left.appendChild(title);
    left.appendChild(meta);

    var right = document.createElement("div");
    right.className = "spotizam-detect-panel__history-actions";

    if (isGrouped) {
      var toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "spotizam-detect-panel__history-toggle";
      toggleBtn.textContent = opts.expanded ? "Hide Results" : "Show All Results";
      right.appendChild(toggleBtn);
    }

    if (opts.showDelete) {
      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "spotizam-detect-panel__history-delete";
      deleteBtn.textContent = "Delete Search";
      deleteBtn.addEventListener("click", function () {
        deleteHistoryBatch(opts.historyIndex);
      });
      right.appendChild(deleteBtn);
    }

    summary.appendChild(left);
    summary.appendChild(right);
    row.appendChild(summary);

    if (!isGrouped) {
      var actions = document.createElement("div");
      actions.className = "spotizam-detect-panel__history-actions";
      renderActionButtons(actions, first);
      row.appendChild(actions);
      return row;
    }

    row.appendChild(buildMatchRow(first, true));

    var itemsWrap = document.createElement("div");
    itemsWrap.className = "spotizam-detect-panel__history-group-items";
    itemsWrap.style.display = opts.expanded ? "flex" : "none";
    items.slice(1).forEach(function (item) {
      itemsWrap.appendChild(buildMatchRow(item, true));
    });
    row.appendChild(itemsWrap);

    if (right.firstChild) {
      right.firstChild.addEventListener("click", function () {
        itemsWrap.style.display = itemsWrap.style.display === "none" ? "flex" : "none";
        right.firstChild.textContent = itemsWrap.style.display === "none" ? "Show All Results" : "Hide Results";
      });
    }

    return row;
  }

  function renderLatestResultsSection(built, cfg) {
    if (!built || !built.latestList || !built.latestEmpty) return;
    normalizeLatestResultsConfig(cfg);
    built.latestList.innerHTML = "";

    if (!cfg.latestResults || !Array.isArray(cfg.latestResults.items) || !cfg.latestResults.items.length) {
      built.latestEmpty.style.display = "block";
      return;
    }

    built.latestEmpty.style.display = "none";
    built.latestList.appendChild(buildBatchRow(cfg.latestResults, { expanded: false, showDelete: false }));
  }

  function renderHistorySection(built, cfg) {
    if (!built || !built.historySection || !built.historyList || !built.historyEmpty) return;

    normalizeHistoryConfig(cfg);
    var enabled = built.historyEnabledInput ? !!built.historyEnabledInput.checked : !!cfg.history.enabled;

    built.historySection.style.display = enabled ? "block" : "none";
    built.historyLimitInput.disabled = !enabled;
    built.historyIncludeAllInput.disabled = !enabled;
    built.historyOpenPageButton.disabled = !enabled;

    built.historyList.innerHTML = "";

    if (!enabled) return;

    var searches = Array.isArray(cfg.history.searches) ? cfg.history.searches : [];
    if (!searches.length) {
      built.historyEmpty.style.display = "block";
      return;
    }

    built.historyEmpty.style.display = "none";

    searches.forEach(function (batch, index) {
      built.historyList.appendChild(buildBatchRow(batch, { historyIndex: index, showDelete: true, expanded: false }));
    });
  }

  function deleteHistoryBatch(index) {
    normalizeHistoryConfig(config);
    if (!Array.isArray(config.history.searches)) return;
    if (index < 0 || index >= config.history.searches.length) return;
    config.history.searches.splice(index, 1);
    saveConfig(config);
    refreshHistoryUi();
    showToast("Removed search batch from Spotizam history", false);
  }

  function clearHistoryItems() {
    normalizeHistoryConfig(config);
    config.history.searches = [];
    saveConfig(config);
    refreshHistoryUi();
    showToast("Spotizam history cleared", false);
  }

  function openResultsPage() {
    if (typeof Spicetify !== "undefined" && Spicetify.Platform && Spicetify.Platform.History) {
      Spicetify.Platform.History.push(RESULTS_ROUTE);
    } else {
      window.history.pushState({}, "", RESULTS_ROUTE);
    }
  }

  function populateFields(cfg) {
    var built = settingsPanel._built;
    if (!built) return;

    built.select.value = cfg.provider;
    built.recordingInput.value = String(clampRecordingSeconds(cfg.recordingSeconds));
    built.openSongInput.checked = !!(cfg.afterMatch && cfg.afterMatch.openSong);
    built.playSongInput.checked = !!(cfg.afterMatch && cfg.afterMatch.playSong);
    built.openResultsPageInput.checked = !!(cfg.resultsPage && cfg.resultsPage.openAfterRecognition);
    if (built.syncAfterMatchUi) built.syncAfterMatchUi();
    built.historyEnabledInput.checked = !!(cfg.history && cfg.history.enabled);
    built.historyLimitInput.value = String(clampHistoryItems(cfg.history && cfg.history.maxItems));
    built.historyIncludeAllInput.checked = !!(cfg.history && cfg.history.includeAllMatches);
    built.debugJsonInput.checked = !!(cfg.debug && cfg.debug.keepJson);
    built.debugJsonDirectoryInput.value = (cfg.debug && cfg.debug.jsonDirectory) || "";
    built.keepAudioInput.checked = !!(cfg.debug && cfg.debug.keepAudio);
    built.audioDirectoryInput.value = (cfg.debug && cfg.debug.audioDirectory) || "";
    built.debugJsonDirectoryInput.disabled = false;
    built.debugJsonDirectoryButton.disabled = false;
    built.inputs.acr.host.value = cfg.acrcloud.host || "";
    built.inputs.acr.key.value = cfg.acrcloud.accessKey || "";
    built.inputs.acr.secret.value = cfg.acrcloud.accessSecret || "";
    built.inputs.audd.value = cfg.audd.apiToken || "";

    showFieldSet(cfg.provider, built.fieldSets);
    renderLatestResultsSection(built, cfg);
    renderHistorySection(built, cfg);
  }

  function openSettingsPanel(showWarning) {
    ensureSettingsPanel();
    if (!settingsPanel) return;
    if (!isBuiltPanel(settingsPanel._built)) {
      rebuildSettingsPanel();
    }
    if (!isBuiltPanel(settingsPanel._built)) return;

    settingsPanel._built.warning.className = "spotizam-detect-panel__warning";
    settingsPanel._built.toast.className = "spotizam-detect-panel__toast";

    if (showWarning) {
      var label = getProviderLabel(config.provider);
      settingsPanel._built.warning.textContent = "Add your " + label + " API key to get started";
      settingsPanel._built.warning.className = "spotizam-detect-panel__warning spotizam-detect-panel__warning--visible";
    }

    populateFields(config);
    // Focus the first missing credential input for the selected provider
    try {
      var built = settingsPanel._built;
      if (built) {
        if (config.provider === 'acrcloud') {
          if (!trimmed(config.acrcloud.host)) built.inputs.acr.host.focus();
          else if (!trimmed(config.acrcloud.accessKey)) built.inputs.acr.key.focus();
          else if (!trimmed(config.acrcloud.accessSecret)) built.inputs.acr.secret.focus();
        } else if (config.provider === 'audd') {
          if (!trimmed(config.audd.apiToken)) built.inputs.audd.focus();
        }
      }
    } catch (e) {}
    settingsPanel.className = "spotizam-detect-panel spotizam-detect-panel--open";
    positionPanel();
  }

  function closeSettingsPanel() {
    if (!settingsPanel) return;
    settingsPanel.className = "spotizam-detect-panel";
  }

  function positionPanel() {
    if (!settingsPanel) return;

    var margin = 12;
    var panelWidth = Math.min(360, Math.max(300, window.innerWidth - margin * 2));
    var panelHeight;
    var left = (window.innerWidth - panelWidth) / 2;
    var bottom = margin;

    settingsPanel.style.width = panelWidth + "px";
    settingsPanel.style.maxWidth = "calc(100vw - " + (margin * 2) + "px)";
    settingsPanel.style.left = "0";
    settingsPanel.style.right = "auto";
    settingsPanel.style.bottom = "auto";
    settingsPanel.style.top = "0";
    settingsPanel.style.visibility = "hidden";

    panelHeight = settingsPanel.offsetHeight;

    // Ensure panel doesn't go off-screen at the bottom
    if (bottom + panelHeight > window.innerHeight - margin) {
      bottom = Math.max(margin, window.innerHeight - panelHeight - margin);
    }

    settingsPanel.style.left = left + "px";
    settingsPanel.style.top = "auto";
    settingsPanel.style.bottom = bottom + "px";
    settingsPanel.style.visibility = "visible";
  }

  // ── Close panel on Escape ───────────────────────────────────────────────────

  function onDocKeydown(e) {
    if (e.key === "Escape") closeSettingsPanel();
  }

  function repositionOpenPanel() {
    if (settingsPanel && settingsPanel.classList.contains("spotizam-detect-panel--open")) {
      positionPanel();
    }
  }

  function handleDelegatedButtonEvent(e) {
    var target = e.target;
    var clickedMic = closestById(target, "spotizam-detect-btn");
    var clickedSettings = closestById(target, "spotizam-detect-settings-btn");

    if (!clickedMic && !clickedSettings) return;
    debugLog("Delegated click captured", clickedMic ? "mic" : "settings");

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    micBtn = document.getElementById("spotizam-detect-btn") || micBtn;
    settingsBtn = document.getElementById("spotizam-detect-settings-btn") || settingsBtn;

    if (clickedMic) {
      onMicClick();
      return;
    }

    toggleSettingsPanel();
  }

  function closestById(node, id) {
    while (node && node !== document) {
      if (node.id === id) return node;
      node = node.parentNode;
    }
    return null;
  }

  function toggleSettingsPanel() {
    ensureSettingsPanel();
    if (settingsPanel && settingsPanel.classList.contains("spotizam-detect-panel--open")) {
      debugLog("Closing settings panel");
      closeSettingsPanel();
    } else {
      debugLog("Opening settings panel");
      openSettingsPanel(false);
    }
  }

  function ensureSettingsPanel() {
    if (settingsPanel && document.body.contains(settingsPanel) && isBuiltPanel(settingsPanel._built)) return;

    var existingPanel = document.getElementById("spotizam-detect-panel");
    if (existingPanel && isBuiltPanel(existingPanel._built)) {
      settingsPanel = existingPanel;
      return;
    }

    rebuildSettingsPanel();
  }

  function isBuiltPanel(built) {
    return !!(
      built &&
      built.panel &&
      built.fieldSets &&
      built.select &&
      built.recordingInput &&
      built.openSongInput &&
      built.playSongInput &&
      built.openResultsPageInput &&
      built.debugJsonInput &&
      built.debugJsonDirectoryInput &&
      built.debugJsonDirectoryButton &&
      built.keepAudioInput &&
      built.audioDirectoryInput &&
      built.warning &&
      built.toast &&
      built.inputs &&
      built.inputs.acr &&
      built.inputs.audd
    );
  }

  function rebuildSettingsPanel() {
    debugLog("Building settings panel");
    var oldPanel = document.getElementById("spotizam-detect-panel");
    if (oldPanel && oldPanel.parentElement) oldPanel.parentElement.removeChild(oldPanel);

    var result = buildSettingsPanel();
    settingsPanel = result.panel;
    settingsPanel._built = result;
    document.body.appendChild(settingsPanel);
  }

  function attachDelegatedHandlers() {
    if (delegatedHandlersAttached) return;
    delegatedHandlersAttached = true;
    debugLog("Attaching delegated handlers");
    document.addEventListener("click", handleDelegatedButtonEvent, true);
    document.addEventListener("keydown", onDocKeydown);
    window.addEventListener("resize", repositionOpenPanel);
    window.addEventListener("scroll", repositionOpenPanel, true);
  }

  // ── Find Spotify top bar and inject buttons ────────────────────────────────

  // Spotify's UI changes over time, so we try a handful of common sidebar and
  // top-bar selectors and attach the buttons to the first stable host we can
  // find. The sidebar is preferred so the buttons do not move with the active
  // page.
  function findLibraryHost() {
    var selectors = [
      ".Root__nav-bar",
      "[data-testid='nav-bar']",
      ".main-navBar-navBar",
      ".main-yourLibraryX-navBar",
      ".main-yourLibraryX-libraryContainer",
      ".main-yourLibraryX-header",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function findLibraryHeadingAnchor() {
    var host = findLibraryHost();
    var selectors = [
      "[data-testid='library-tab']",
      "button[aria-label='Your Library']",
      "button[aria-label*='Your Library']",
      "[aria-label='Your Library']",
      "[data-testid='nav-bar'] [role='button']",
    ];

    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && /Your Library/i.test((el.getAttribute("aria-label") || el.textContent || "").trim())) {
        return el;
      }
    }

    if (!host) return null;

    var all = host.querySelectorAll("button, a, div, span, [role='button']");
    for (var j = 0; j < all.length; j++) {
      var candidate = all[j];
      var text = (candidate.textContent || "").replace(/\s+/g, " ").trim();
      if (text === "Your Library" || /^Your Library\b/i.test(text) || /Your Library/i.test(candidate.getAttribute("aria-label") || "")) {
        return candidate;
      }
    }

    return null;
  }

  function findTopBar() {
    var selectors = [
      ".main-topBar-container",
      ".x-categoryHeader-TopBar",
      "[data-testid='top-bar']",
      ".Root__top-bar",
      ".main-topBar",
      "header",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function injectButtons() {
    var host = findLibraryHost() || findTopBar();
    if (!host) {
      debugWarn("Library host not found yet");
      return false;
    }

    removeExistingUi();
    debugLog("Injecting Spotizam buttons", host);

    var container = document.createElement("div");
    container.id = "spotizam-detect-container";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.gap = "4px";
    container.style.margin = "0";

    // Mic button
    micBtn = document.createElement("button");
    micBtn.id = "spotizam-detect-btn";
    micBtn.className = "spotizam-detect-btn";
    micBtn.type = "button";
    micBtn.innerHTML = ICON_MIC;
    micBtn.setAttribute("title", "Start Recording");
    micBtn.addEventListener("click", onMicClick);

    // Settings button
    settingsBtn = document.createElement("button");
    settingsBtn.id = "spotizam-detect-settings-btn";
    settingsBtn.className = "spotizam-detect-settings-btn";
    settingsBtn.type = "button";
    settingsBtn.innerHTML = ICON_GEAR;
    settingsBtn.setAttribute("title", "Spotizam Settings");
    settingsBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleSettingsPanel();
    });

    container.appendChild(micBtn);
    container.appendChild(settingsBtn);

    var libraryAnchor = findLibraryHeadingAnchor();

    // Prefer placing the buttons directly under the Your Library heading so
    // they stay with that section instead of floating at the top of the nav.
    if (libraryAnchor) {
      var headerContainer = libraryAnchor.closest('.main-yourLibraryX-header') || libraryAnchor.parentElement || host;
      var headerContent = headerContainer.querySelector('.main-yourLibraryX-headerContent');
      container.style.flexDirection = "row";
      container.style.justifyContent = "flex-start";
      container.style.gap = "4px";
      container.style.margin = "0";
      container.style.alignSelf = "flex-start";
      try {
        if (headerContent && headerContent.parentElement === headerContainer) {
          // Preferred placement: direct child of the library header, before header content.
          headerContainer.insertBefore(container, headerContent);
        } else if (headerContainer.firstChild) {
          headerContainer.insertBefore(container, headerContainer.firstChild);
        } else {
          headerContainer.appendChild(container);
        }
      } catch (e) {
        // Fallback to previous behavior if insertion fails.
        headerContainer.insertBefore(container, headerContainer.firstChild || null);
      }
    } else if (host.classList && (host.classList.contains("Root__nav-bar") || host.getAttribute("data-testid") === "nav-bar")) {
      container.style.flexDirection = "row";
      container.style.justifyContent = "flex-start";
      container.style.gap = "4px";
      container.style.margin = "8px 0 8px 8px";
      host.insertBefore(container, host.firstChild);
    } else {
      var rightSection = host.querySelector(".main-topBar-right") ||
                         host.querySelector("[class*='right']") ||
                         host;

      rightSection.insertBefore(container, rightSection.firstChild);
    }

    ensureSettingsPanel();

    attachDelegatedHandlers();

    debugLog("Spotizam buttons injected");
    return true;
  }

  function removeExistingUi() {
    var selectors = [
      "#spotizam-detect-container",
      "#spotizam-detect-btn",
      "#spotizam-detect-settings-btn",
      "#spotizam-detect-panel",
    ];

    for (var i = 0; i < selectors.length; i++) {
      var nodes = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (node && node.parentElement) {
          node.parentElement.removeChild(node);
        }
      }
    }
  }

  function isButtonsInsideLibraryHeader() {
    var container = document.getElementById("spotizam-detect-container");
    if (!container) return false;

    var header = container.closest(".main-yourLibraryX-header");
    if (!header) return false;

    var headerContent = header.querySelector(".main-yourLibraryX-headerContent");
    return !!headerContent && container.parentElement === header && container.nextElementSibling === headerContent;
  }

  function hasLibraryHeaderTarget() {
    var header = document.querySelector(".main-yourLibraryX-header");
    if (!header) return false;
    return !!header.querySelector(".main-yourLibraryX-headerContent");
  }

  // ── Init with retry ────────────────────────────────────────────────────────

  var initAttempts = 0;
  var maxInitAttempts = 60; // ~30 seconds at 500ms intervals
  var uiObserver = null;

  function startUiObserver() {
    if (uiObserver) return;
    debugLog("Starting UI observer for button persistence");

    uiObserver = new MutationObserver(function (mutations) {
      // Check if our buttons are still in the DOM; if not, reinject them
      var host = findLibraryHost() || findTopBar();
      var container = document.getElementById("spotizam-detect-container");

      var mustBeInHeader = hasLibraryHeaderTarget();
      if (host && (!container || (mustBeInHeader && !isButtonsInsideLibraryHeader()))) {
        debugLog("Buttons were removed; re-injecting");
        injectButtons();
      }
    });

    // Watch the body for structural changes
    uiObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });
  }

  // Spotify does not always build the top bar immediately, so we retry until
  // the header exists and the buttons can be inserted. MutationObserver then
  // re-injects them if Spotify's UI updates remove them.
  function init() {
    if (injectButtons()) {
      setButtonState("idle");
      debugLog("Init complete");
      startUiObserver(); // Start watching for UI changes
      return;
    }

    if (initAttempts < maxInitAttempts) {
      initAttempts++;
      setTimeout(init, 500);
    } else {
      debugWarn(
        "Failed to find top bar after " + maxInitAttempts + " attempts; giving up"
      );
    }
  }

  // ── Start ──────────────────────────────────────────────────────────────────

  debugLog("Extension script loaded");
  injectStyles();
  debugLog("Styles injected");

  if (document.readyState === "complete") {
    debugLog("Document already complete; initializing now");
    init();
  } else {
    debugLog("Document not complete; waiting for load events", document.readyState);
    window.addEventListener("load", function () {
      init();
    });
    // Also try on DOMContentLoaded for faster injection
    document.addEventListener("DOMContentLoaded", function () {
      init();
    });
  }

  // Handle Spicetify reloads
  if (typeof Spicetify !== "undefined" && Spicetify.Platform) {
    Spicetify.Platform.History && Spicetify.Platform.History.listen && Spicetify.Platform.History.listen(function () {
      debugLog("History change detected");
      if (!micBtn) init();
      else startUiObserver(); // Ensure observer is running even if buttons survived
    });
  }

})();

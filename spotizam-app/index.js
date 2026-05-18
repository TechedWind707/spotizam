var spotizamApp = (() => {
  const STORAGE_KEY = "spotizam_config";
  const React = Spicetify.React;

  function makeQuery(title, artist) {
    return [title || "", artist || ""].filter(Boolean).join(" ").trim();
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) return "";
    try {
      return new Date(timestamp).toLocaleString();
    } catch (_) {
      return String(timestamp);
    }
  }

  function normalizeMatchItem(item) {
    if (!item || typeof item !== "object") return null;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const artist = typeof item.artist === "string" ? item.artist.trim() : "";
    const searchQuery = typeof item.searchQuery === "string" && item.searchQuery.trim()
      ? item.searchQuery.trim()
      : makeQuery(title, artist);
    if (!title && !artist && !searchQuery) return null;

    return {
      title,
      artist,
      spotifyUri: typeof item.spotifyUri === "string" && item.spotifyUri.trim() ? item.spotifyUri.trim() : null,
      spotifyAlbumId: typeof item.spotifyAlbumId === "string" && item.spotifyAlbumId.trim() ? item.spotifyAlbumId.trim() : null,
      searchQuery,
      service: typeof item.service === "string" && item.service.trim() ? item.service.trim() : "Unknown",
      timestamp: typeof item.timestamp === "string" && item.timestamp.trim() ? item.timestamp.trim() : new Date().toISOString(),
      confidence: item.confidence == null ? null : Number(item.confidence),
      isPrimary: !!item.isPrimary,
    };
  }

  function makeSearchBatchId(timestamp, suffix) {
    return "search-" + String(timestamp || Date.now()).replace(/[^0-9a-z]+/gi, "-") + "-" + String(suffix == null ? 0 : suffix);
  }

  function normalizeBatch(batch, index) {
    if (!batch || typeof batch !== "object") return null;
    const items = Array.isArray(batch.items) ? batch.items.map(normalizeMatchItem).filter(Boolean) : [];
    if (!items.length) return null;
    const timestamp = typeof batch.timestamp === "string" && batch.timestamp.trim() ? batch.timestamp.trim() : items[0].timestamp;

    return {
      id: typeof batch.id === "string" && batch.id.trim() ? batch.id.trim() : makeSearchBatchId(timestamp, index),
      timestamp,
      provider: typeof batch.provider === "string" ? batch.provider : "acrcloud",
      service: typeof batch.service === "string" && batch.service.trim() ? batch.service.trim() : items[0].service,
      query: typeof batch.query === "string" && batch.query.trim() ? batch.query.trim() : (items[0].searchQuery || makeQuery(items[0].title, items[0].artist)),
      items,
    };
  }

  function normalizeConfig(cfg) {
    if (!cfg || typeof cfg !== "object") return null;

    let searches = [];
    if (cfg.history && Array.isArray(cfg.history.searches)) {
      searches = cfg.history.searches.map(normalizeBatch).filter(Boolean);
    } else if (cfg.history && Array.isArray(cfg.history.items)) {
      searches = cfg.history.items.map(function (item, index) {
        const normalized = normalizeMatchItem(item);
        if (!normalized) return null;
        return {
          id: makeSearchBatchId(normalized.timestamp, index),
          timestamp: normalized.timestamp,
          provider: cfg.provider || "acrcloud",
          service: normalized.service,
          query: normalized.searchQuery,
          items: [normalized],
        };
      }).filter(Boolean);
    }

    return {
      ...cfg,
      latestResults: normalizeBatch(cfg.latestResults, 0),
      history: {
        enabled: !!(cfg.history && cfg.history.enabled),
        maxItems: cfg.history && cfg.history.maxItems ? cfg.history.maxItems : 5,
        includeAllMatches: !!(cfg.history && cfg.history.includeAllMatches),
        searches,
      },
    };
  }

  function readConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return normalizeConfig(JSON.parse(raw));
    } catch (err) {
      console.error("[spotizam-app] Could not read config", err);
      return null;
    }
  }

  function writeConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function openSpotifyUri(uri) {
    if (!uri || !window.Spicetify || !Spicetify.Platform || !Spicetify.Platform.History) return;
    const parts = uri.split(":");
    if (parts.length !== 3) return;
    Spicetify.Platform.History.push("/" + parts[1] + "/" + parts[2]);
  }

  function openSearch(query) {
    if (!query || !window.Spicetify || !Spicetify.Platform || !Spicetify.Platform.History) return;
    Spicetify.Platform.History.push("/search/" + encodeURIComponent(query));
  }

  function playUri(uri) {
    try {
      if (uri && window.Spicetify && Spicetify.Player && Spicetify.Player.playUri) {
        Spicetify.Player.playUri(uri);
      }
    } catch (err) {
      console.error("[spotizam-app] Could not play uri", err);
    }
  }

  function EmptyState(props) {
    return React.createElement("div", { className: "spotizam-app__empty" }, props.text);
  }

  function ResultCard(props) {
    const item = props.item || {};
    const query = item.searchQuery || makeQuery(item.title, item.artist);
    const title = (item.title || "Unknown title") + (item.artist ? " - " + item.artist : "");
    const meta = [
      item.service || "Unknown",
      item.confidence != null && !Number.isNaN(Number(item.confidence)) ? "confidence " + item.confidence : "",
    ].filter(Boolean).join(" | ");

    return React.createElement(
      "div",
      { className: "spotizam-app__card" + (props.primary ? " spotizam-app__card--primary" : "") },
      React.createElement("div", { className: "spotizam-app__card-title" }, title),
      React.createElement("div", { className: "spotizam-app__card-meta" }, meta),
      React.createElement(
        "div",
        { className: "spotizam-app__card-actions" },
        React.createElement(
          "button",
          {
            className: "spotizam-app__button spotizam-app__button--secondary",
            onClick: function () {
              if (item.spotifyUri) openSpotifyUri(item.spotifyUri);
              else openSearch(query);
            },
          },
          item.spotifyUri ? "Open on Spotify" : "Search on Spotify"
        ),
        item.spotifyUri && /^spotify:track:/.test(item.spotifyUri)
          ? React.createElement(
              "button",
              {
                className: "spotizam-app__button spotizam-app__button--secondary",
                onClick: function () {
                  playUri(item.spotifyUri);
                },
              },
              "Play"
            )
          : null,
        item.spotifyUri && query
          ? React.createElement(
              "button",
              {
                className: "spotizam-app__button spotizam-app__button--secondary",
                onClick: function () {
                  openSearch(query);
                },
              },
              "Search"
            )
          : null
      )
    );
  }

  function BatchCard(props) {
    const batch = props.batch || { items: [] };
    const items = Array.isArray(batch.items) ? batch.items : [];
    const first = items[0] || {};
    const [expanded, setExpanded] = React.useState(!!props.defaultExpanded);
    const isGrouped = items.length > 1;

    return React.createElement(
      "div",
      { className: "spotizam-app__card" },
      React.createElement(
        "div",
        { className: "spotizam-app__group-head" },
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "spotizam-app__card-title" }, (first.title || "Unknown title") + (first.artist ? " - " + first.artist : "")),
          React.createElement(
            "div",
            { className: "spotizam-app__card-meta" },
            [formatTimestamp(batch.timestamp), batch.service || "Unknown", items.length + (items.length === 1 ? " result" : " results")].join(" | ")
          )
        ),
        React.createElement(
          "div",
          { className: "spotizam-app__actions" },
          isGrouped
            ? React.createElement(
                "button",
                {
                  className: "spotizam-app__button spotizam-app__button--secondary",
                  onClick: function () { setExpanded(function (value) { return !value; }); },
                },
                expanded ? "Hide Results" : "Show All Results"
              )
            : null,
          props.onDelete
            ? React.createElement(
                "button",
                {
                  className: "spotizam-app__button spotizam-app__button--danger",
                  onClick: props.onDelete,
                },
                "Delete Search"
              )
            : null
        )
      ),
      !isGrouped
        ? React.createElement(ResultCard, { item: first, primary: true })
        : React.createElement(
            "div",
            { className: "spotizam-app__list" },
            React.createElement(ResultCard, { item: first, primary: true }),
            expanded
              ? items.slice(1).map(function (item, index) {
                  return React.createElement(ResultCard, {
                    key: batch.id + "-item-" + index,
                    item: item,
                    primary: false,
                  });
                })
              : null
          )
    );
  }

  function App() {
    const [config, setConfig] = React.useState(readConfig());

    React.useEffect(function () {
      function onFocus() {
        setConfig(readConfig());
      }

      window.addEventListener("focus", onFocus);
      return function () {
        window.removeEventListener("focus", onFocus);
      };
    }, []);

    function refresh() {
      setConfig(readConfig());
    }

    function clearHistory() {
      const next = readConfig();
      if (!next || !next.history) return;
      next.history.searches = [];
      writeConfig(next);
      refresh();
      if (window.Spicetify && Spicetify.showNotification) {
        Spicetify.showNotification("Spotizam history cleared");
      }
    }

    function deleteHistoryBatch(index) {
      const next = readConfig();
      if (!next || !next.history || !Array.isArray(next.history.searches)) return;
      if (index < 0 || index >= next.history.searches.length) return;
      next.history.searches.splice(index, 1);
      writeConfig(next);
      refresh();
      if (window.Spicetify && Spicetify.showNotification) {
        Spicetify.showNotification("Removed search batch from Spotizam history");
      }
    }

    const latestResults = config && config.latestResults;
    const historySearches = config && config.history && Array.isArray(config.history.searches) ? config.history.searches : [];

    return React.createElement(
      "div",
      { className: "spotizam-app" },
      React.createElement(
        "div",
        { className: "spotizam-app__hero" },
        React.createElement(
          "div",
          null,
          React.createElement("h1", { className: "spotizam-app__title" }, "Spotizam"),
          React.createElement(
            "p",
            { className: "spotizam-app__copy" },
            "Use this page to review the latest grouped recognition results and your saved search history."
          )
        ),
        React.createElement(
          "div",
          { className: "spotizam-app__actions" },
          React.createElement(
            "button",
            {
              className: "spotizam-app__button spotizam-app__button--secondary",
              onClick: refresh,
            },
            "Refresh"
          ),
          React.createElement(
            "button",
            {
              className: "spotizam-app__button spotizam-app__button--danger",
              onClick: function () {
                if (window.confirm("Clear all Spotizam history search batches?")) clearHistory();
              },
            },
            "Clear History"
          )
        )
      ),
      React.createElement(
        "section",
        { className: "spotizam-app__section" },
        React.createElement("h2", { className: "spotizam-app__section-title" }, "Latest Result"),
        React.createElement(
          "p",
          { className: "spotizam-app__section-copy" },
          "The best match is shown first. Expand it if the provider returned more than one candidate."
        ),
        React.createElement(
          "div",
          { className: "spotizam-app__list" },
          latestResults
            ? React.createElement(BatchCard, { batch: latestResults, defaultExpanded: false })
            : React.createElement(EmptyState, { text: "No latest recognition result yet. Use the Spotizam mic button first." })
        )
      ),
      React.createElement(
        "section",
        { className: "spotizam-app__section" },
        React.createElement("h2", { className: "spotizam-app__section-title" }, "Saved History"),
        React.createElement(
          "p",
          { className: "spotizam-app__section-copy" },
          "Each card below represents one recognition search, which may contain one or many returned songs."
        ),
        React.createElement(
          "div",
          { className: "spotizam-app__list" },
          historySearches.length
            ? historySearches.map(function (batch, index) {
                return React.createElement(BatchCard, {
                  key: batch.id || ("search-" + index),
                  batch: batch,
                  defaultExpanded: false,
                  onDelete: function () {
                    deleteHistoryBatch(index);
                  },
                });
              })
            : React.createElement(EmptyState, { text: "History is empty right now. Turn on history in the Spotizam extension settings if you want this list to grow." })
        )
      )
    );
  }

  return {
    default: function renderSpotizamApp() {
      return React.createElement(App, null);
    },
  };
})();

let render = () => spotizamApp.default();

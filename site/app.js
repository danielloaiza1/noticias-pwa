(function () {
  "use strict";

  var STALE_MS = 15 * 60 * 1000;
  var HERO_MAX = 8;
  var FEED_MAX = 40;

  var ICONS = {
    todo: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/></svg>',
    barranquilla: '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    colombia: '<svg viewBox="0 0 24 24"><path d="M6 21V4M6 5h12l-2.5 4L18 13H6"/></svg>',
    "paises-bajos": '<svg viewBox="0 0 24 24"><path d="M12 12L5 5M12 12l7-7M12 12l-7 7M12 12l7 7"/><circle cx="12" cy="12" r="1.6"/></svg>',
    mundo: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3.2 3 13.8 0 17M12 3.5c-3 3.2-3 13.8 0 17"/></svg>'
  };

  var state = { data: null, tab: "todo", loadedAt: 0, lastVisit: 0 };

  var $main = document.getElementById("main");
  var $tabs = document.getElementById("tabs");
  var $greeting = document.getElementById("greeting");
  var $date = document.getElementById("date");
  var $updated = document.getElementById("updated");
  var $refresh = document.getElementById("refresh");
  var $sources = document.getElementById("sources-list");

  // --- almacenamiento ligero (puede fallar en modo privado) ---
  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { return null; }
  }
  state.lastVisit = Number(store("lastVisit")) || 0;
  state.tab = store("tab") || "todo";

  function markVisit() { store("lastVisit", String(Date.now())); }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") markVisit();
    else if (Date.now() - state.loadedAt > STALE_MS) load();
  });
  window.addEventListener("pagehide", markVisit);

  // --- utilidades ---
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function rel(iso) {
    if (!iso) return "";
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "ahora";
    if (mins < 60) return "hace " + mins + " min";
    var h = Math.round(mins / 60);
    if (h < 24) return "hace " + h + " h";
    var d = Math.round(h / 24);
    if (d < 7) return "hace " + d + (d === 1 ? " día" : " días");
    return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short" });
  }

  function safeUrl(u) { return /^https?:\/\//i.test(u) ? u : "#"; }

  function sectionName(id) {
    var s = state.data.sections.filter(function (x) { return x.id === id; })[0];
    return s ? s.name : "";
  }

  function itemsOf(sectionId) {
    return state.data.items.filter(function (i) { return i.section === sectionId; });
  }

  function byDateDesc(a, b) {
    return (b.published || "").localeCompare(a.published || "");
  }

  function link(item, cls) {
    var a = el("a", cls);
    a.href = safeUrl(item.link);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  function kicker(item) {
    var k = el("div", "kicker");
    var isNew = state.lastVisit && item.published && new Date(item.published).getTime() > state.lastVisit;
    if (isNew) k.appendChild(el("span", "new-dot", "● "));
    var parts = [rel(item.published), item.source];
    if (item.lang && item.lang !== "es") parts.push(item.lang);
    k.appendChild(document.createTextNode(parts.filter(Boolean).join(" · ")));
    return k;
  }

  // Fondo: degradado por sección y, encima, la foto si carga.
  function background(card, item) {
    card.classList.add("g-" + item.section);
    if (item.image) {
      var img = el("img", "bg-img");
      img.loading = "lazy";
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = item.image;
      img.onerror = function () { img.remove(); };
      card.appendChild(img);
    }
    card.appendChild(el("div", "shade"));
  }

  // --- tarjetas ---
  function heroCard(item) {
    var a = link(item, "hero-card");
    background(a, item);
    a.appendChild(el("span", "badge-pill", sectionName(item.section)));
    var c = el("div", "content");
    c.appendChild(kicker(item));
    c.appendChild(el("h2", "", item.title));
    if (item.summary) c.appendChild(el("p", "", item.summary));
    a.appendChild(c);
    return a;
  }

  function feedItem(item) {
    var li = el("li");
    if (item.image) {
      var a = link(item, "big-card");
      background(a, item);
      a.appendChild(el("span", "badge-pill", sectionName(item.section)));
      var c = el("div", "content");
      c.appendChild(kicker(item));
      c.appendChild(el("h3", "", item.title));
      a.appendChild(c);
      li.appendChild(a);
    } else {
      var t = link(item, "text-card");
      t.appendChild(kicker(item));
      t.appendChild(el("h3", "", item.title));
      if (item.summary) t.appendChild(el("p", "", item.summary));
      t.appendChild(el("span", "sec", sectionName(item.section)));
      li.appendChild(t);
    }
    return li;
  }

  function feed(items) {
    var ul = el("ul", "feed");
    items.forEach(function (it) { ul.appendChild(feedItem(it)); });
    return ul;
  }

  // --- destacadas: una por sección en rotación, con foto cuando la hay ---
  function pickHero() {
    var lists = state.data.sections.map(function (s) {
      var recent = itemsOf(s.id).slice().sort(byDateDesc).slice(0, 8);
      return recent.sort(function (a, b) {
        return (b.image ? 1 : 0) - (a.image ? 1 : 0) || byDateDesc(a, b);
      });
    });
    var picks = [];
    for (var round = 0; round < 3 && picks.length < HERO_MAX; round++) {
      for (var i = 0; i < lists.length && picks.length < HERO_MAX; i++) {
        if (lists[i][round]) picks.push(lists[i][round]);
      }
    }
    return picks;
  }

  function carousel(items) {
    var wrap = el("div");
    var scroller = el("div", "hero");
    items.forEach(function (it) { scroller.appendChild(heroCard(it)); });
    wrap.appendChild(scroller);

    var dots = el("div", "dots");
    items.forEach(function (_, i) { dots.appendChild(el("span", "dot" + (i === 0 ? " on" : ""))); });
    wrap.appendChild(dots);

    var ticking = false;
    scroller.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var first = scroller.firstElementChild;
        if (!first) return;
        var step = first.getBoundingClientRect().width + 12;
        var idx = Math.max(0, Math.min(items.length - 1, Math.round(scroller.scrollLeft / step)));
        Array.prototype.forEach.call(dots.children, function (d, i) {
          d.classList.toggle("on", i === idx);
        });
      });
    }, { passive: true });
    return wrap;
  }

  // --- vistas ---
  function renderMain() {
    $main.textContent = "";
    var data = state.data;
    if (!data.items.length) {
      $main.appendChild(el("p", "state", "No hay noticias por ahora."));
      return;
    }
    if (state.tab === "todo") {
      var hero = pickHero();
      if (hero.length) $main.appendChild(carousel(hero));
      var used = {};
      hero.forEach(function (h) { used[h.id] = true; });
      var latest = data.items.filter(function (i) { return !used[i.id]; }).sort(byDateDesc).slice(0, FEED_MAX);
      if (latest.length) {
        $main.appendChild(el("h2", "list-title", "Últimas noticias"));
        $main.appendChild(feed(latest));
      }
    } else {
      var items = itemsOf(state.tab).sort(byDateDesc);
      $main.appendChild(el("h2", "section-title", sectionName(state.tab)));
      $main.appendChild(el("p", "section-sub", items.length + (items.length === 1 ? " noticia" : " noticias")));
      if (!items.length) $main.appendChild(el("p", "state", "Sin noticias en esta sección."));
      else $main.appendChild(feed(items));
    }
  }

  function renderTabs() {
    $tabs.textContent = "";
    var all = [{ id: "todo", name: "Todo" }].concat(state.data.sections);
    all.forEach(function (s) {
      var b = el("button", "dock-btn");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(s.id === state.tab));
      b.innerHTML = ICONS[s.id] || ICONS.todo; // iconos propios y fijos, no vienen de los feeds
      b.appendChild(el("span", "", s.name));
      b.addEventListener("click", function () { setTab(s.id); });
      $tabs.appendChild(b);
    });
  }

  function renderSources() {
    $sources.textContent = "";
    state.data.sources.forEach(function (s) {
      $sources.appendChild(el("li", s.ok ? "" : "bad", s.name + (s.ok ? " · " + s.count : " · no disponible")));
    });
  }

  function renderHeader() {
    var h = new Date().getHours();
    $greeting.textContent = h < 6 ? "Buenas noches" : h < 13 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
    $date.textContent = new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
    if (state.data) $updated.textContent = rel(state.data.generatedAt);
  }

  function setTab(id) {
    state.tab = id;
    store("tab", id);
    renderTabs();
    renderMain();
    window.scrollTo(0, 0);
  }

  function render() {
    renderHeader();
    renderTabs();
    renderMain();
    renderSources();
  }

  // --- carga ---
  function load() {
    $refresh.classList.add("spin");
    return fetch("news.json?ts=" + Date.now(), { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.data = data;
        state.loadedAt = Date.now();
        if (state.tab !== "todo" && !data.sections.some(function (s) { return s.id === state.tab; })) state.tab = "todo";
        render();
      })
      .catch(function () {
        if (!state.data) {
          $main.textContent = "";
          $main.appendChild(el("p", "state", "No se pudieron cargar las noticias. Revisa tu conexión e inténtalo de nuevo."));
        }
      })
      .then(function () { $refresh.classList.remove("spin"); });
  }

  $refresh.addEventListener("click", load);
  setInterval(function () { if (state.data) renderHeader(); }, 60000);
  renderHeader();
  load();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();

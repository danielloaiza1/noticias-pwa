(function () {
  "use strict";

  var STALE_MS = 15 * 60 * 1000;
  var PREVIEW = 6; // noticias por sección en la vista "Todo"

  var state = { data: null, tab: "todo", loadedAt: 0, lastVisit: 0 };

  var $tabs = document.getElementById("tabs");
  var $main = document.getElementById("main");
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

  function safeUrl(u) {
    return /^https?:\/\//i.test(u) ? u : "#";
  }

  // --- render ---
  function card(item) {
    var a = el("a", "card");
    a.href = safeUrl(item.link);
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    var body = el("div", "body");
    body.appendChild(el("h3", "", item.title));
    if (item.summary) body.appendChild(el("p", "", item.summary));

    var meta = el("div", "meta");
    var isNew = state.lastVisit && item.published && new Date(item.published).getTime() > state.lastVisit;
    if (isNew) meta.appendChild(el("span", "new", ""));
    meta.appendChild(el("span", "src", item.source));
    var when = rel(item.published);
    if (when) meta.appendChild(el("span", "", when));
    if (item.lang && item.lang !== "es") meta.appendChild(el("span", "badge", item.lang));
    body.appendChild(meta);
    a.appendChild(body);

    if (item.image) {
      var img = el("img", "thumb");
      img.loading = "lazy";
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = item.image;
      img.onerror = function () { img.remove(); };
      a.appendChild(img);
    }

    var li = el("li");
    li.appendChild(a);
    return li;
  }

  function list(items) {
    var ul = el("ul", "cards");
    items.forEach(function (it) { ul.appendChild(card(it)); });
    return ul;
  }

  function itemsOf(sectionId) {
    return state.data.items.filter(function (i) { return i.section === sectionId; });
  }

  function renderTabs() {
    $tabs.textContent = "";
    var all = [{ id: "todo", name: "Todo" }].concat(state.data.sections);
    all.forEach(function (s) {
      var b = el("button", "tab", s.name);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(s.id === state.tab));
      b.addEventListener("click", function () { setTab(s.id); });
      $tabs.appendChild(b);
    });
  }

  function renderMain() {
    $main.textContent = "";
    var data = state.data;
    if (!data.items.length) {
      $main.appendChild(el("p", "state", "No hay noticias por ahora."));
      return;
    }
    if (state.tab === "todo") {
      data.sections.forEach(function (s) {
        var items = itemsOf(s.id);
        if (!items.length) return;
        var head = el("div", "group-head");
        head.appendChild(el("h2", "", s.name));
        if (items.length > PREVIEW) {
          var more = el("button", "link-btn", "Ver todas (" + items.length + ")");
          more.type = "button";
          more.addEventListener("click", function () { setTab(s.id); });
          head.appendChild(more);
        }
        $main.appendChild(head);
        $main.appendChild(list(items.slice(0, PREVIEW)));
      });
    } else {
      var items = itemsOf(state.tab);
      if (!items.length) $main.appendChild(el("p", "state", "Sin noticias en esta sección."));
      else $main.appendChild(list(items));
    }
  }

  function renderSources() {
    $sources.textContent = "";
    state.data.sources.forEach(function (s) {
      var li = el("li", s.ok ? "" : "bad", s.name + (s.ok ? " · " + s.count : " · no disponible"));
      $sources.appendChild(li);
    });
  }

  function renderStamp() {
    var t = new Date(state.data.generatedAt);
    $updated.textContent = "Act. " + rel(t.toISOString());
  }

  function render() {
    renderTabs();
    renderMain();
    renderSources();
    renderStamp();
  }

  function setTab(id) {
    state.tab = id;
    store("tab", id);
    renderTabs();
    renderMain();
    window.scrollTo(0, 0);
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
  setInterval(function () { if (state.data) renderStamp(); }, 60000);
  load();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();

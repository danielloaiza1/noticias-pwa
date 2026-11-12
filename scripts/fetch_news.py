#!/usr/bin/env python3
"""Descarga los feeds de sources.json y escribe site/news.json.

Solo usa la biblioteca estándar. Si una fuente falla, las demás siguen;
el resultado indica qué fuentes funcionaron. Sale con código 1 si no se
obtuvo ni una sola noticia (así el despliegue conserva la versión anterior).

Uso: python3 scripts/fetch_news.py [sources.json] [salida.json]
"""
import hashlib
import html
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (compatible; NoticiasPWA/1.0; lector personal de noticias)"
MAX_PER_SECTION = 40
MAX_AGE = timedelta(days=7)
SUMMARY_LEN = 180

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
}


def strip_html(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def parse_date(value):
    if not value:
        return None
    value = value.strip()
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def text_of(el, path):
    found = el.find(path, NS)
    return (found.text or "").strip() if found is not None and found.text else ""


def https(url):
    return "https://" + url[7:] if url.startswith("http://") else url


def find_image(item, raw_html):
    for el in item.findall("media:content", NS) + item.findall("media:thumbnail", NS):
        url = el.get("url")
        kind = (el.get("type") or el.get("medium") or "image").lower()
        if url and "image" in kind:
            return https(url)
    for el in item.findall("enclosure"):
        if (el.get("type") or "").startswith("image") and el.get("url"):
            return https(el.get("url"))
    m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', raw_html or "")
    if m and m.group(1).startswith(("http://", "https://")):
        return https(m.group(1))
    return ""


def parse_feed(data):
    """Devuelve una lista de dicts con title, link, date, summary, image, source."""
    root = ET.fromstring(data)
    out = []
    if root.tag.endswith("feed"):  # Atom
        for e in root.findall("atom:entry", NS):
            link = ""
            for l in e.findall("atom:link", NS):
                if l.get("rel", "alternate") == "alternate" and l.get("href"):
                    link = l.get("href")
                    break
            raw = text_of(e, "atom:summary") or text_of(e, "atom:content")
            out.append({
                "title": strip_html(text_of(e, "atom:title")),
                "link": link,
                "date": parse_date(text_of(e, "atom:published") or text_of(e, "atom:updated")),
                "summary": strip_html(raw),
                "image": find_image(e, raw),
                "source": "",
            })
        return out
    for e in root.iter("item"):  # RSS 2.0
        raw = text_of(e, "content:encoded") or text_of(e, "description")
        out.append({
            "title": strip_html(text_of(e, "title")),
            "link": text_of(e, "link"),
            "date": parse_date(text_of(e, "pubDate") or text_of(e, "dc:date")),
            "summary": strip_html(text_of(e, "description")),
            "image": find_image(e, raw),
            "source": text_of(e, "source"),
        })
    return out


OG_TAG = re.compile(r'<meta[^>]+?(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image)["\'][^>]*?>', re.I)
CONTENT_ATTR = re.compile(r'content=["\']([^"\']+)["\']', re.I)
MAX_ENRICH = 60


def og_image(url):
    """Lee el comienzo de la página del artículo y devuelve su og:image (o '')."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=6) as resp:
            if "html" not in (resp.headers.get("Content-Type") or "text/html"):
                return ""
            final_url = resp.geturl()
            page = resp.read(250_000).decode("utf-8", "ignore")
    except Exception:  # noqa: BLE001
        return ""
    head = page.split("</head>", 1)[0]
    for tag in OG_TAG.findall(head):
        m = CONTENT_ATTR.search(tag)
        if m:
            img = urljoin(final_url, html.unescape(m.group(1)).strip())
            if img.startswith(("http://", "https://", "file://")):
                return https(img)
    return ""


def enrich_images(items):
    """Completa la imagen de las noticias que no la traen en el feed.

    Se omiten Google Noticias (los enlaces son redirecciones) y las fuentes con
    noSummary (NOS: solo titular y enlace según sus condiciones de uso).
    """
    todo = [
        i for i in items
        if not i["image"] and not i.get("_noenrich") and "news.google.com" not in i["link"]
    ]
    todo.sort(key=lambda i: i["published"] or "", reverse=True)
    todo = todo[:MAX_ENRICH]
    with ThreadPoolExecutor(max_workers=8) as pool:
        for item, img in zip(todo, pool.map(lambda i: og_image(i["link"]), todo)):
            item["image"] = img
    return sum(1 for i in todo if i["image"])


def download(url, tries=2):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001 - se informa y se sigue
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise last


def load_source(src):
    status = {"name": src["name"], "section": src["section"], "ok": False, "count": 0, "error": ""}
    try:
        entries = parse_feed(download(src["url"]))
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"[:200]
        return status, []
    items = []
    for e in entries:
        if not e["title"] or not e["link"]:
            continue
        outlet = e["source"] or src["name"]
        title = e["title"]
        # Google Noticias añade " - Medio" al final del titular.
        if e["source"] and title.endswith(" - " + e["source"]):
            title = title[: -len(e["source"]) - 3].rstrip()
        summary = "" if src.get("noSummary") else e["summary"]
        # En Google Noticias el resumen repite el titular: se descarta.
        if summary.startswith(title[:40]):
            summary = ""
        if len(summary) > SUMMARY_LEN:
            summary = summary[: SUMMARY_LEN - 1].rsplit(" ", 1)[0] + "…"
        items.append({
            "id": hashlib.sha1(e["link"].encode()).hexdigest()[:12],
            "title": title,
            "link": e["link"],
            "source": outlet,
            "section": src["section"],
            "lang": src.get("lang", "es"),
            "published": e["date"].isoformat() if e["date"] else None,
            "summary": summary,
            "image": e["image"],
            "_noenrich": bool(src.get("noSummary")),
        })
    status["ok"] = True
    status["count"] = len(items)
    return status, items


def norm(title):
    return re.sub(r"[^a-z0-9áéíóúñü]+", "", title.lower())[:80]


def main():
    cfg_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "sources.json"
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "site" / "news.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(load_source, cfg["sources"]))

    now = datetime.now(timezone.utc)
    statuses, by_section = [], {s["id"]: [] for s in cfg["sections"]}
    for status, items in results:
        statuses.append(status)
        by_section.setdefault(status["section"], []).extend(items)

    final = []
    for section_id, items in by_section.items():
        seen_t, seen_l, kept = set(), set(), []
        items.sort(key=lambda i: i["published"] or "", reverse=True)
        for it in items:
            if it["published"] and now - datetime.fromisoformat(it["published"]) > MAX_AGE:
                continue
            key = norm(it["title"])
            if key in seen_t or it["link"] in seen_l:
                continue
            seen_t.add(key)
            seen_l.add(it["link"])
            kept.append(it)
        final.extend(kept[:MAX_PER_SECTION])

    found = enrich_images(final)
    print(f"Imágenes obtenidas de los artículos: {found}")
    for it in final:
        it.pop("_noenrich", None)

    payload = {
        "generatedAt": now.isoformat(),
        "sections": cfg["sections"],
        "sources": statuses,
        "items": final,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for s in statuses:
        mark = "OK " if s["ok"] else "ERR"
        print(f"[{mark}] {s['section']:<13} {s['name']:<32} {s['count']:>3} {s['error']}")
    print(f"Total: {len(final)} noticias -> {out_path}")
    return 0 if final else 1


if __name__ == "__main__":
    sys.exit(main())

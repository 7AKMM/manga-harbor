const MANGABAKA_API = "https://api.mangabaka.org";
const MANGADAR_BASE = "https://mangadar.com";
const CONTENT_SOURCES = [
  { name: "MangaDar", base: MANGADAR_BASE, searchPath: title => `/?${query({ s: title })}` }
];
const PAGE_SIZE = 48;

function query(params) {
  const q = new URLSearchParams();
  for (const key in params) {
    const value = params[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") q.append(key, item);
      }
    } else if (value !== undefined && value !== null && value !== "") {
      q.append(key, value);
    }
  }
  return q.toString();
}

function absolute(url, base) {
  if (!url) return undefined;
  const clean = String(url).trim().replace(/&amp;/g, "&");
  if (/^https?:\/\//i.test(clean)) return clean;
  if (clean.startsWith("//")) return "https:" + clean;
  try {
    return new URL(clean, base || MANGALIK_BASE).href;
  } catch (_) {
    return undefined;
  }
}

async function httpText(url, timeoutMs) {
  const res = await harbor.http(url, {
    method: "GET",
    responseType: "text",
    timeoutMs: timeoutMs || 20000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Harbor/1.0"
    }
  });
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : "?"} for ${url}`);
  return res.body || "";
}

async function api(path, params) {
  const qs = query(params || {});
  const body = await httpText(`${MANGABAKA_API}${path}${qs ? "?" + qs : ""}`, 20000);
  try {
    return JSON.parse(body);
  } catch (_) {
    throw new Error(`Bad JSON from ${path}`);
  }
}

function titleList(item) {
  const titles = Array.isArray(item && item.titles) ? item.titles : [];
  const ordered = [];
  function add(t) {
    if (t && !ordered.includes(t)) ordered.push(t);
  }
  for (const lang of ["en", "ar", "ja-Latn", "ko-Latn", "zh-Latn"]) {
    const hit = titles.find(t => t.language === lang && t.title && t.is_primary);
    if (hit) add(hit.title);
  }
  for (const t of titles) add(t.title);
  add(item && item.title);
  return ordered;
}

function primaryTitle(item) {
  return titleList(item)[0] || String(item && item.id || "Unknown");
}

function coverUrl(item) {
  const cover = item && item.cover;
  if (!cover) return undefined;
  return absolute(cover.x350 || cover.x250 || cover.raw);
}

function summary(item) {
  if (!item || !item.id) return null;
  const authors = []
    .concat(item.authors || [])
    .concat(item.artists || [])
    .filter(Boolean);
  const published = item.published || {};
  const start = published.start_date || "";
  const year = Number(start.slice(0, 4));
  return {
    id: String(item.id),
    title: primaryTitle(item),
    altTitle: titleList(item).slice(1, 4).join(" / ") || undefined,
    cover: coverUrl(item),
    year: year || undefined,
    status: item.status || undefined,
    description: item.description || undefined,
    contentRating: item.content_rating || undefined,
    lastChapter: item.total_chapters ? String(item.total_chapters) : undefined,
    author: authors.length ? Array.from(new Set(authors)).join(", ") : undefined
  };
}

function slugify(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function chapterId(series, chapter) {
  const titles = titleList(series).slice(0, 8).map(encodeURIComponent).join(",");
  return `mbml|${series.id}|${chapter}|${titles}`;
}

function parseChapterId(id) {
  const parts = String(id || "").split("|");
  return {
    seriesId: parts[1],
    chapter: parts[2],
    titles: (parts[3] || "").split(",").map(decodeURIComponent).filter(Boolean)
  };
}

function normalizeText(s) {
  return slugify(s).replace(/-/g, "");
}

async function findSourceSeries(titles) {
  for (const source of CONTENT_SOURCES) {
    for (const title of titles) {
      const direct = `${source.base}/manga/${slugify(title)}/`;
      try {
        await httpText(direct, 12000);
        return { source, url: direct };
      } catch (_) {}
    }

    for (const title of titles.slice(0, 4)) {
      try {
        const html = await httpText(`${source.base}${source.searchPath(title)}`, 15000);
        const doc = await harbor.parseHtml(html);
        const links = doc.querySelectorAll('a[href*="/manga/"]');
        const wanted = normalizeText(title);
        let fallback = null;
        for (const a of links) {
          const href = absolute(a.attr("href"), source.base);
          if (!href || !/\/manga\/[^/]+\/?$/i.test(href)) continue;
          const text = a.text();
          if (!fallback) fallback = href;
          if (normalizeText(text) === wanted || normalizeText(text).includes(wanted) || wanted.includes(normalizeText(text))) {
            return { source, url: href };
          }
        }
        if (fallback) return { source, url: fallback };
      } catch (_) {}
    }
  }
  return null;
}

function extractImagesFromRaw(html, pageUrl) {
  const urls = [];
  const seen = new Set();
  const pagesScript = html.match(/<script[^>]+id=["']mv-pages-[^"']+["'][^>]*>([\s\S]*?)<\/script>/i);
  if (pagesScript) {
    try {
      const parsed = JSON.parse(pagesScript[1].trim());
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const url = absolute(item, pageUrl);
          if (url && /^https?:\/\//i.test(url) && !seen.has(url)) {
            seen.add(url);
            urls.push(url);
          }
        }
        if (urls.length) return urls;
      }
    } catch (_) {}
  }

  const reading = html.match(/<div[^>]+class=["'][^"']*reading-content[^"']*["'][\s\S]*?(?:<\/div>\s*<\/div>\s*<\/div>|<\/article>|<footer)/i);
  const block = reading ? reading[0] : html;
  const imgRe = /<img\b[^>]*>/gi;
  let m;
  while ((m = imgRe.exec(block))) {
    const tag = m[0];
    const attrs = ["data-src", "data-lazy-src", "data-original", "src"];
    for (const attr of attrs) {
      const r = new RegExp(attr + "\\s*=\\s*([\"'])(.*?)\\1", "i").exec(tag);
      const url = absolute(r && r[2], pageUrl);
      if (url && /^https?:\/\//i.test(url) && /\/chapter-[^/]+\//i.test(url) && !/new\.gif|logo|favicon|avatar|banner|cover-|item\.cover/i.test(url) && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
        break;
      }
    }
  }
  return urls;
}

async function extractImagesWithDom(html, pageUrl) {
  const doc = await harbor.parseHtml(html);
  const images = [];
  const seen = new Set();
  for (const img of doc.querySelectorAll(".reading-content img, img.wp-manga-chapter-img, .chapter-content img")) {
    const url = absolute(
      img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"),
      pageUrl
    );
    if (url && !seen.has(url)) {
      seen.add(url);
      images.push(url);
    }
  }
  return images;
}

const plugin = {
  id: "mangabaka-mangalik-ar",
  name: "MangaBaka + MangaDar",

  async popular(offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const data = await api("/v2/series/search", {
      page,
      limit: PAGE_SIZE,
      sort_by: "popularity_desc",
      content_rating: ["safe", "suggestive"]
    });
    return Array.isArray(data && data.data) ? data.data.map(summary).filter(Boolean) : [];
  },

  async search(searchQuery, offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const data = await api("/v2/series/search", {
      q: (searchQuery || "").trim(),
      page,
      limit: PAGE_SIZE,
      content_rating: ["safe", "suggestive", "erotica"]
    });
    return Array.isArray(data && data.data) ? data.data.map(summary).filter(Boolean) : [];
  },

  async detail(id) {
    const data = await api(`/v2/series/${encodeURIComponent(id)}`);
    return data && data.data ? summary(data.data) : null;
  },

  async chapters(id) {
    const data = await api(`/v2/series/${encodeURIComponent(id)}`);
    const series = data && data.data;
    if (!series) return [];
    const total = Math.min(5000, Math.floor(Number(series.total_chapters || 0)));
    if (!total) return [];
    const out = [];
    for (let n = total; n >= 1; n--) {
      out.push({
        id: chapterId(series, String(n)),
        chapter: String(n),
        title: `Chapter ${n}`,
        volume: null,
        pages: 0,
        language: "ar"
      });
    }
    return out;
  },

  async pageUrls(chId) {
    const info = parseChapterId(chId);
    if (!info.chapter || !info.titles.length) return [];
    const found = await findSourceSeries(info.titles);
    if (!found || !found.url) return [];
    const pageUrl = new URL(`${String(info.chapter).replace(/^chapter-/i, "")}/`, found.url).href;
    const html = await httpText(pageUrl, 30000);
    const rawImages = extractImagesFromRaw(html, pageUrl);
    if (rawImages.length) return rawImages;
    return extractImagesWithDom(html, pageUrl);
  }
};

harbor.register(plugin);

// Harbor MangaBaka Source Plugin
// Target: https://api.mangabaka.org

const BASE = "https://api.mangabaka.org";

// Covers and page images MUST be absolute http(s) or Harbor drops them.
function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function extractTitle(series) {
  if (series.titles && Array.isArray(series.titles) && series.titles.length > 0) {
    const primary = series.titles.find((t) => t.is_primary);
    if (primary && primary.title) return primary.title.trim();
    const en = series.titles.find((t) => t.language === "en");
    if (en && en.title) return en.title.trim();
    return series.titles[0].title.trim();
  }
  if (typeof series.title === "string" && series.title.trim()) {
    return series.title.trim();
  }
  return String(series.id);
}

function toSummary(series) {
  let coverUrl;
  if (series.cover) {
    if (series.cover.raw && series.cover.raw.url) coverUrl = series.cover.raw.url;
    else if (series.cover.x350 && series.cover.x350.x1) coverUrl = series.cover.x350.x1;
    else if (series.cover.x250 && series.cover.x250.x1) coverUrl = series.cover.x250.x1;
    else if (series.cover.x150 && series.cover.x150.x1) coverUrl = series.cover.x150.x1;
  }
  
  let authorName = undefined;
  if (Array.isArray(series.authors) && series.authors.length > 0) {
    authorName = series.authors.join(", ");
  }

  return {
    id: String(series.id),
    title: extractTitle(series),
    cover: abs(coverUrl),
    status: series.status || undefined,
    description: series.description || undefined,
    contentRating: series.content_rating || undefined,
    author: authorName
  };
}

const plugin = {
  // id must match the manifest id in repo.json.
  id: "mangabaka",
  name: "MangaBaka",

  // offset is an item offset (0, 48, 96, ...). tagId is set when the user filters.
  async popular(offset, tagId) {
    const page = Math.floor(offset / 48) + 1;
    let url = BASE + "/v1/series?sort=popularity&limit=48&page=" + page;
    if (tagId) url += "&tags=" + encodeURIComponent(tagId);
    
    // responseType json returns the parsed value directly
    const res = await harbor.http(url, { responseType: "json" });
    if (res && Array.isArray(res.data)) {
      return res.data.map(toSummary).filter((s) => s.id && s.title);
    }
    return [];
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 48) + 1;
    let url = BASE + "/v1/series?q=" + encodeURIComponent(query) + "&limit=48&page=" + page;
    if (tagId) url += "&tags=" + encodeURIComponent(tagId);
    
    const res = await harbor.http(url, { responseType: "json" });
    if (res && Array.isArray(res.data)) {
      return res.data.map(toSummary).filter((s) => s.id && s.title);
    }
    return [];
  },

  async detail(id) {
    const res = await harbor.http(BASE + "/v1/series/" + id, { responseType: "json" });
    if (res && res.data) {
      return toSummary(res.data);
    }
    return null;
  },

  async chapters(id) {
    const res = await harbor.http(BASE + "/v1/series/" + id + "/chapters", { responseType: "json" });
    if (res && Array.isArray(res.data)) {
      return res.data
        .map((ch) => ({
          id: String(ch.id),
          chapter: ch.chapter_number ? String(ch.chapter_number) : null,
          title: ch.title || undefined,
          volume: ch.volume_number ? String(ch.volume_number) : null,
          pages: ch.pages || 0,
          language: ch.language || "en",
          publishAt: ch.published_at || undefined
        }))
        .filter((c) => c.id);
    }
    return [];
  },

  async pageUrls(chapterId) {
    const res = await harbor.http(BASE + "/v1/chapters/" + chapterId + "/pages", { responseType: "json" });
    if (res && Array.isArray(res.data)) {
      return res.data.map((p) => abs(p.url)).filter(Boolean);
    }
    return [];
  },

  // Optional. Defining tags() shows a genre filter and passes tagId back in.
  async tags() {
    const res = await harbor.http(BASE + "/v1/tags", { responseType: "json" });
    if (res && Array.isArray(res.data)) {
      return res.data
        .filter((t) => t.is_genre)
        .map((t) => ({ id: String(t.id), name: t.name, group: "Genre" }));
    }
    return [];
  }
};

harbor.register(plugin);
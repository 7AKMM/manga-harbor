const API_BASE = "https://api.mangadex.org";
const UPLOADS_BASE = "https://uploads.mangadex.org";

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return UPLOADS_BASE + url;
  return UPLOADS_BASE + "/" + url;
}

function buildQuery(params) {
  const q = new URLSearchParams();
  for (const key in params) {
    const val = params[key];
    if (Array.isArray(val)) {
      for (const v of val) q.append(key, v);
    } else if (val !== undefined && val !== null) {
      q.append(key, val);
    }
  }
  return q.toString();
}

async function fetchApi(path, params = {}) {
  const q = buildQuery(params);
  const url = `${API_BASE}${path}${q ? "?" + q : ""}`;
  const res = await harbor.http(url, {
    method: "GET",
    headers: {
      "User-Agent": "HarborPlugin/1.0"
    },
    responseType: "text",
    timeoutMs: 15000
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  try {
    return JSON.parse(res.body);
  } catch (e) {
    throw new Error(`JSON parse error for ${url}`);
  }
}

function getCover(manga) {
  const rel = manga.relationships?.find(r => r.type === "cover_art");
  if (!rel || !rel.attributes || !rel.attributes.fileName) return undefined;
  return `${UPLOADS_BASE}/covers/${manga.id}/${rel.attributes.fileName}`;
}

function getTitle(manga) {
  const t = manga.attributes?.title || {};
  return t.en || Object.values(t)[0] || manga.id;
}

function mapSummary(manga) {
  if (!manga || !manga.id) return null;
  const coverUrl = getCover(manga);
  return {
    id: manga.id,
    title: getTitle(manga).trim(),
    cover: abs(coverUrl ? `${coverUrl}.512.jpg` : undefined)
  };
}

const plugin = {
  id: "mangadex-en",
  name: "MangaDex (EN)",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 48) + 1;
    const params = {
      limit: 48,
      offset: offset,
      "includes[]": "cover_art",
      "order[followedCount]": "desc",
      "contentRating[]": ["safe", "suggestive"],
      "hasAvailableChapters": "true",
      "availableTranslatedLanguage[]": "en"
    };
    if (tagId) {
      params["includedTags[]"] = tagId;
    }
    const data = await fetchApi("/manga", params);
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map(mapSummary).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 48) + 1;
    const params = {
      limit: 48,
      offset: offset,
      title: (query || "").trim(),
      "includes[]": "cover_art",
      "contentRating[]": ["safe", "suggestive", "erotica", "pornographic"],
      "availableTranslatedLanguage[]": "en"
    };
    if (tagId) {
      params["includedTags[]"] = tagId;
    }
    const data = await fetchApi("/manga", params);
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map(mapSummary).filter(Boolean);
  },

  async detail(id) {
    const data = await fetchApi(`/manga/${id}`, {
      "includes[]": ["cover_art", "author", "artist"]
    });
    const manga = data?.data;
    if (!manga) return null;

    const attrs = manga.attributes || {};
    const desc = attrs.description?.en || Object.values(attrs.description || {})[0] || "";
    
    const authors = manga.relationships
      ?.filter(r => r.type === "author" || r.type === "artist")
      ?.map(r => r.attributes?.name)
      ?.filter(Boolean) || [];

    return {
      id: manga.id,
      title: getTitle(manga).trim(),
      altTitle: attrs.altTitles?.map(t => Object.values(t)[0])?.[0],
      cover: abs(getCover(manga)),
      description: desc.trim(),
      status: attrs.status,
      author: [...new Set(authors)].join(", "),
      contentRating: attrs.contentRating,
      year: attrs.year || undefined
    };
  },

  async chapters(id) {
    let allChapters = [];
    let currentOffset = 0;
    let total = 1;

    while (currentOffset < total && currentOffset < 2000) {
      const data = await fetchApi(`/manga/${id}/feed`, {
        limit: 500,
        offset: currentOffset,
        "translatedLanguage[]": "en",
        "order[volume]": "desc",
        "order[chapter]": "desc",
        "includes[]": "scanlation_group"
      });

      if (!data || !Array.isArray(data.data) || data.data.length === 0) break;
      
      total = data.total || 0;
      allChapters = allChapters.concat(data.data);
      currentOffset += 500;
    }

    return allChapters.map(ch => {
      const attrs = ch.attributes || {};
      const groups = ch.relationships
        ?.filter(r => r.type === "scanlation_group")
        ?.map(r => r.attributes?.name)
        ?.filter(Boolean) || [];

      return {
        id: ch.id,
        chapter: attrs.chapter || null,
        title: attrs.title || undefined,
        volume: attrs.volume || null,
        pages: attrs.pages || 0,
        language: attrs.translatedLanguage || "en",
        group: groups.join(", ") || undefined,
        publishAt: attrs.publishAt || attrs.readableAt || undefined
      };
    }).filter(c => c.id);
  },

  async pageUrls(chapterId) {
    const data = await fetchApi(`/at-home/server/${chapterId}`);
    if (!data || !data.baseUrl || !data.chapter || !Array.isArray(data.chapter.data)) {
      return [];
    }
    const { baseUrl, chapter } = data;
    const hash = chapter.hash;
    return chapter.data
      .map(fileName => abs(`${baseUrl}/data/${hash}/${fileName}`))
      .filter(Boolean);
  },

  async tags() {
    const data = await fetchApi("/manga/tag");
    if (!data || !Array.isArray(data.data)) return [];
    
    return data.data.map(tag => {
      return {
        id: tag.id,
        name: tag.attributes?.name?.en || "Unknown",
        group: tag.attributes?.group || "Genre"
      };
    }).filter(t => t.id && t.name !== "Unknown");
  }
};

harbor.register(plugin);
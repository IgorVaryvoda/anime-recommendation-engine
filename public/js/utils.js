export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function validateXML(xmlText) {
  if (xmlText.includes('<!DOCTYPE') || xmlText.includes('<!ENTITY')) {
    throw new Error('Invalid XML: DOCTYPE/ENTITY declarations not allowed');
  }

  if (xmlText.match(/SYSTEM|PUBLIC/i)) {
    throw new Error('Suspicious XML content detected');
  }
}

export function parseXMLAnime(xmlDoc) {
  const animeElements = xmlDoc.getElementsByTagName('anime');
  const ratedAnime = [];
  const allIds = new Set();

  for (let anime of animeElements) {
    const id = anime.querySelector('series_animedb_id')?.textContent;
    const titleElement = anime.querySelector('series_title');
    let title = titleElement?.textContent || null;
    const score = anime.querySelector('my_score')?.textContent;
    const status = anime.querySelector('my_status')?.textContent;

    if (id) {
      allIds.add(id);
    }

    if (score && parseInt(score) > 0 && id) {
      ratedAnime.push({
        id,
        title: title || 'Loading...',
        score: parseInt(score),
        status,
        needsTitle: !title
      });
    }
  }

  return { ratedAnime, allIds };
}

export function calculateStats(ratedAnime, allIds, topAnime) {
  const avgScore = ratedAnime.length > 0
    ? (ratedAnime.reduce((sum, a) => sum + a.score, 0) / ratedAnime.length).toFixed(1)
    : 0;

  return {
    total: allIds.size,
    rated: ratedAnime.length,
    avgScore,
    topRated: topAnime.length
  };
}

export function getVisiblePages(currentPage, totalPages, maxVisible = 5) {
  const pages = [];
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return pages;
}

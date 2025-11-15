import { CONFIG, SORT_OPTIONS } from './constants.js';
import { uploadList, loadList, generateRecommendations, fetchAnimeDetails } from './api.js';
import { sleep, validateXML, parseXMLAnime, calculateStats, getVisiblePages } from './utils.js';

const { createApp } = Vue;

export function initApp() {
  return createApp({
    data() {
      return {
        fileName: '',
        animeList: [],
        allAnimeIds: new Set(),
        topAnime: [],
        recommendations: [],
        stats: null,
        loading: false,
        error: '',
        isDragging: false,
        listId: null,
        shareUrl: '',
        viewOnly: false,
        progress: {
          current: 0,
          total: 0,
          currentAnime: ''
        },
        searchQuery: '',
        filterType: '',
        sortBy: SORT_OPTIONS.COUNT,
        currentPage: 1,
        itemsPerPage: CONFIG.ITEMS_PER_PAGE,
        maxTopAnime: null, // null = analyze all top-rated anime
        history: []
      };
    },

    computed: {
      filteredRecommendations() {
        let filtered = [...this.recommendations];

        if (this.searchQuery) {
          const query = this.searchQuery.toLowerCase();
          filtered = filtered.filter(rec =>
            rec.title.toLowerCase().includes(query)
          );
        }

        if (this.filterType) {
          filtered = filtered.filter(rec => rec.type === this.filterType);
        }

        if (this.sortBy === SORT_OPTIONS.COUNT) {
          filtered.sort((a, b) => b.count - a.count);
        } else if (this.sortBy === SORT_OPTIONS.SCORE) {
          filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
        } else if (this.sortBy === SORT_OPTIONS.TITLE) {
          filtered.sort((a, b) => a.title.localeCompare(b.title));
        }

        return filtered;
      },

      totalPages() {
        return Math.ceil(this.filteredRecommendations.length / this.itemsPerPage);
      },

      paginatedRecommendations() {
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        return this.filteredRecommendations.slice(start, end);
      },

      visiblePages() {
        return getVisiblePages(this.currentPage, this.totalPages, CONFIG.MAX_VISIBLE_PAGES);
      }
    },

    watch: {
      searchQuery() {
        this.currentPage = 1;
      },
      filterType() {
        this.currentPage = 1;
      },
      sortBy() {
        this.currentPage = 1;
      }
    },

    async mounted() {
      // Load history from localStorage
      this.loadHistory();

      const pathParts = window.location.pathname.split('/').filter(p => p);
      if (pathParts.length > 0) {
        const id = pathParts[0];
        this.viewOnly = true;
        await this.loadListFromAPI(id);
      }
    },

    methods: {
      handleDrop(event) {
        this.isDragging = false;
        const file = event.dataTransfer.files[0];
        if (!file) return;

        if (!file.name.endsWith('.xml') && !file.name.endsWith('.gz')) {
          this.error = 'Please upload a .xml or .gz file';
          return;
        }

        this.processFile(file);
      },

      async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.processFile(file);
      },

      async processFile(file) {
        this.fileName = file.name;
        this.error = '';

        try {
          let xmlText;

          if (file.name.endsWith('.gz')) {
            const arrayBuffer = await file.arrayBuffer();
            const decompressed = window.pako.ungzip(new Uint8Array(arrayBuffer), { to: 'string' });
            xmlText = decompressed;
          } else {
            xmlText = await file.text();
          }

          this.parseXML(xmlText);
        } catch (err) {
          this.error = 'Error reading file: ' + err.message;
        }
      },

      async parseXML(xmlText) {
        try {
          validateXML(xmlText);

          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

          const parseError = xmlDoc.querySelector('parsererror');
          if (parseError) {
            this.error = 'Failed to parse XML file';
            return;
          }

          const { ratedAnime, allIds } = parseXMLAnime(xmlDoc);
          ratedAnime.sort((a, b) => b.score - a.score);

          this.animeList = ratedAnime;
          this.allAnimeIds = allIds;
          this.topAnime = ratedAnime.filter(a => a.score >= CONFIG.MIN_SCORE_THRESHOLD);

          this.stats = calculateStats(ratedAnime, allIds, this.topAnime);

          await this.fetchMissingTitles();
          await this.saveListToAPI();
        } catch (err) {
          this.error = err.message;
        }
      },

      async fetchMissingTitles() {
        const needTitles = this.animeList.filter(a => a.needsTitle);

        if (needTitles.length === 0) {
          return;
        }

        this.progress.currentAnime = `Fetching ${needTitles.length} anime titles...`;
        this.progress.current = 0;
        this.progress.total = needTitles.length;
        this.loading = true;

        for (let i = 0; i < needTitles.length; i++) {
          const anime = needTitles[i];
          this.progress.current = i + 1;
          this.progress.currentAnime = `Fetching titles... ${i + 1}/${needTitles.length}`;

          try {
            const details = await fetchAnimeDetails(anime.id);

            if (details.title) {
              const index = this.animeList.findIndex(a => a.id === anime.id);
              if (index !== -1) {
                this.animeList[index].title = details.title;
                this.animeList[index].needsTitle = false;
              }
            }
            await sleep(CONFIG.JIKAN.RATE_LIMIT_DELAY);
          } catch (err) {
            console.error(`Error fetching title for ${anime.id}:`, err);
          }
        }

        this.topAnime = this.animeList.filter(a => a.score >= CONFIG.MIN_SCORE_THRESHOLD);
        this.loading = false;
        this.progress.current = 0;
        this.progress.total = 0;
      },

      async saveListToAPI() {
        try {
          const data = await uploadList(this.animeList, this.allAnimeIds, this.stats);
          this.listId = data.id;
          this.shareUrl = data.url;
          window.history.pushState({}, '', `/${data.id}`);

          // Save to history
          this.saveToHistory(data.id, this.stats);
        } catch (err) {
          console.error('Error saving to API:', err);
        }
      },

      async loadListFromAPI(id) {
        try {
          this.loading = true;
          const data = await loadList(id);

          this.animeList = data.animeList;
          this.allAnimeIds = new Set(data.allAnimeIds);
          this.topAnime = data.animeList.filter(a => a.score >= CONFIG.MIN_SCORE_THRESHOLD);
          this.stats = data.stats;
          this.listId = id;
          this.shareUrl = window.location.href;

          if (data.recommendations) {
            this.recommendations = data.recommendations;
          }

          this.fileName = 'Loaded from shared link';
          this.loading = false;
        } catch (err) {
          this.error = 'Error loading list: ' + err.message;
          this.loading = false;
        }
      },

      async getRecommendations() {
        this.loading = true;
        this.error = '';
        this.recommendations = [];

        if (!this.listId) {
          this.error = 'List ID not found. Please upload your anime list first.';
          this.loading = false;
          return;
        }

        const analyzeCount = this.topAnime.length;
        this.progress.total = analyzeCount;
        this.progress.current = 0;

        try {
          await this.fetchTopAnimeCovers();

          // Start simulated progress updates
          const estimatedSeconds = analyzeCount * 1.5;
          const updateInterval = setInterval(() => {
            if (this.progress.current < analyzeCount) {
              this.progress.current = Math.min(
                this.progress.current + 1,
                analyzeCount
              );
              const remaining = Math.max(0, analyzeCount - this.progress.current);
              const eta = Math.ceil(remaining * 1.5);
              this.progress.currentAnime = `Analyzing anime ${this.progress.current}/${analyzeCount}... (est. ${eta}s remaining)`;
            }
          }, 1500);

          this.progress.currentAnime = `Analyzing all ${analyzeCount} top-rated anime (est. ${Math.ceil(estimatedSeconds)}s)...`;

          const response = await fetch(`/api/generate-recommendations/${this.listId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });

          clearInterval(updateInterval);

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to generate recommendations');
          }

          const data = await response.json();
          this.recommendations = data.recommendations || [];
          this.progress.current = analyzeCount;
          this.progress.currentAnime = `Found ${this.recommendations.length} recommendations from ${data.analyzedAnime} anime!`;

          await sleep(500);
        } catch (err) {
          console.error('Error generating recommendations:', err);
          this.error = err.message || 'Failed to generate recommendations. Please try again.';
        } finally {
          this.loading = false;
          this.progress.current = 0;
          this.progress.total = 0;
        }
      },

      async fetchTopAnimeCovers() {
        const topSlice = this.topAnime.slice(0, CONFIG.TOP_ANIME_DISPLAY_LIMIT);
        for (let anime of topSlice) {
          try {
            const details = await fetchAnimeDetails(anime.id);
            anime.image = details.images?.jpg?.image_url || details.images?.jpg?.large_image_url;
            await sleep(CONFIG.JIKAN.RATE_LIMIT_DELAY);
          } catch (err) {
            console.error(`Error fetching cover for ${anime.title}:`, err);
          }
        }
      },

      copyShareUrl() {
        navigator.clipboard.writeText(this.shareUrl);
        alert('Share URL copied to clipboard!');
      },

      loadHistory() {
        try {
          const stored = localStorage.getItem('anime-rec-history');
          if (stored) {
            this.history = JSON.parse(stored).slice(0, 5); // Keep last 5
          }
        } catch (err) {
          console.error('Error loading history:', err);
          this.history = [];
        }
      },

      saveToHistory(id, stats) {
        try {
          const historyItem = {
            id,
            timestamp: Date.now(),
            stats
          };

          // Remove duplicate if exists
          this.history = this.history.filter(item => item.id !== id);

          // Add to beginning
          this.history.unshift(historyItem);

          // Keep only last 5
          this.history = this.history.slice(0, 5);

          // Save to localStorage
          localStorage.setItem('anime-rec-history', JSON.stringify(this.history));
        } catch (err) {
          console.error('Error saving history:', err);
        }
      },

      formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

        return date.toLocaleDateString();
      }
    }
  });
}

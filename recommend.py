#!/usr/bin/env python3
import xml.etree.ElementTree as ET
import urllib.request
import json
import time
from collections import Counter

def parse_animelist(xml_file):
    """Parse MyAnimeList XML export"""
    tree = ET.parse(xml_file)
    root = tree.getroot()

    rated_anime = []
    all_anime_ids = set()

    for anime in root.findall('anime'):
        anime_id = anime.find('series_animedb_id').text
        title = anime.find('series_title').text
        score = anime.find('my_score').text
        status = anime.find('my_status').text

        # Collect ALL anime IDs (for filtering recommendations)
        all_anime_ids.add(anime_id)

        # Only keep rated anime for getting recommendations
        if score and int(score) > 0:
            rated_anime.append({
                'id': anime_id,
                'title': title,
                'score': int(score),
                'status': status
            })

    return sorted(rated_anime, key=lambda x: x['score'], reverse=True), all_anime_ids

def get_recommendations_from_jikan(anime_id):
    """Get recommendations for an anime from Jikan API with retry logic"""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            url = f"https://api.jikan.moe/v4/anime/{anime_id}/recommendations"
            with urllib.request.urlopen(url, timeout=10) as response:
                data = json.loads(response.read().decode())
                time.sleep(1.0)  # Respect rate limit: 1 request per second
                return [rec['entry'] for rec in data.get('data', [])]
        except urllib.error.HTTPError as e:
            if e.code == 429:  # Too Many Requests
                wait_time = (attempt + 1) * 2  # Exponential backoff: 2s, 4s, 6s
                print(f"  Rate limited, waiting {wait_time}s...")
                time.sleep(wait_time)
            else:
                print(f"  HTTP Error {e.code}")
                return []
        except Exception as e:
            print(f"  Error: {e}")
            return []

    print(f"  Failed after {max_retries} retries")
    return []

def main():
    print("🎌 Analyzing your anime list...\n")

    # Parse the list
    anime_list, all_anime_ids = parse_animelist('animelist.xml')

    # Show stats
    print(f"Total anime in your list: {len(all_anime_ids)}")
    print(f"Total anime with ratings: {len(anime_list)}")
    avg_score = sum(a['score'] for a in anime_list) / len(anime_list) if anime_list else 0
    print(f"Average score: {avg_score:.1f}\n")

    # Get top rated anime
    top_anime = [a for a in anime_list if a['score'] >= 8]
    print(f"Your top-rated anime ({len(top_anime)} with score ≥ 8):")
    for anime in top_anime[:10]:
        print(f"  • {anime['title']} - Score: {anime['score']}")
    print()

    # Collect recommendations from top-rated anime
    num_to_check = min(25, len(top_anime))
    print(f"🔍 Fetching recommendations based on your top {num_to_check} favorites...\n")

    recommendations = Counter()

    for idx, anime in enumerate(top_anime[:num_to_check], 1):
        print(f"[{idx}/{num_to_check}] {anime['title']}")
        recs = get_recommendations_from_jikan(anime['id'])

        for rec in recs[:8]:  # Get more recommendations per anime
            rec_id = str(rec['mal_id'])
            if rec_id not in all_anime_ids:  # Filter against ALL anime in list
                recommendations[rec['title']] += 1

    # Show top recommendations
    print("\n✨ Top Recommendations for You:\n")
    for i, (title, count) in enumerate(recommendations.most_common(20), 1):
        print(f"{i:2}. {title} (recommended {count} times)")

    print("\n💡 These are based on what people who liked your top-rated anime also enjoyed!")

if __name__ == "__main__":
    main()

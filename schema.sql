-- Schema for anime recommendations database

CREATE TABLE IF NOT EXISTS user_lists (
    id TEXT PRIMARY KEY,
    anime_list TEXT NOT NULL,  -- JSON array of anime with ratings
    all_anime_ids TEXT NOT NULL,  -- JSON array of all anime IDs
    stats TEXT NOT NULL,  -- JSON object with user stats
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id TEXT NOT NULL,
    recommendations TEXT NOT NULL,  -- JSON array of recommendations with images
    top_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (list_id) REFERENCES user_lists(id)
);

CREATE INDEX IF NOT EXISTS idx_list_id ON recommendations(list_id);
CREATE INDEX IF NOT EXISTS idx_created_at ON user_lists(created_at);

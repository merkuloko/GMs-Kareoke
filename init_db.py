import json
import os
import sqlite3


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("KARAOKE_DB_PATH", os.path.join(BASE_DIR, "karaoke.db"))


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            youtube_id TEXT NOT NULL,
            rhythm_map TEXT NOT NULL
        )
        """
    )

    cursor.execute("DELETE FROM songs")

    lifetime_map = json.dumps(
        [
            {"start": 15.0, "end": 45.0, "label": "Verse 1"},
            {"start": 60.0, "end": 90.0, "label": "Chorus 1"},
            {"start": 105.0, "end": 135.0, "label": "Verse 2"},
            {"start": 150.0, "end": 180.0, "label": "Chorus 2"},
            {"start": 195.0, "end": 225.0, "label": "Bridge"},
            {"start": 240.0, "end": 280.0, "label": "Outro"},
        ]
    )

    songs_data = [
        ("LIFETIME - Reimagined", "BEN&BEN", "BhSZGUXeY6Q", lifetime_map),
    ]

    cursor.executemany(
        """
        INSERT INTO songs (title, artist, youtube_id, rhythm_map)
        VALUES (?, ?, ?, ?)
        """,
        songs_data,
    )

    conn.commit()
    conn.close()
    print(f"Database initialized successfully at {DB_PATH}")


if __name__ == "__main__":
    init_db()

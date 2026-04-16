import sqlite3
import json

def init_db():
    # 1. Connect to the database (this creates the file if it doesn't exist)
    conn = sqlite3.connect('karaoke.db')
    cursor = conn.cursor()

    # 2. Create the songs table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            youtube_id TEXT NOT NULL,
            rhythm_map TEXT NOT NULL
        )
    ''')

    # 3. Clear any existing data (useful if you run this script multiple times)
    cursor.execute('DELETE FROM songs')

    # 4. Create some seed data
    # --> MAKE SURE THIS IS ABOVE THE songs_data LIST <--
    lifetime_map = json.dumps([
        {"start": 15.0, "end": 45.0, "label": "Verse 1"},
        {"start": 60.0, "end": 90.0, "label": "Chorus 1"},
        {"start": 105.0, "end": 135.0, "label": "Verse 2"},
        {"start": 150.0, "end": 180.0, "label": "Chorus 2"},
        {"start": 195.0, "end": 225.0, "label": "Bridge"},
        {"start": 240.0, "end": 280.0, "label": "Outro"}
    ])

    # Now Python knows what 'lifetime_map' is when it reads this part!
    songs_data = [
        ('LIFETIME - Reimagined', 'BEN&BEN', 'BhSZGUXeY6Q', lifetime_map)
    ]

    # 5. Insert the data
    cursor.executemany('''
            INSERT INTO songs (title, artist, youtube_id, rhythm_map)
            VALUES (?, ?, ?, ?)
        ''', songs_data)

    conn.commit()
    conn.close()
    print("Database initialized successfully!")

if __name__ == '__main__':
    init_db()
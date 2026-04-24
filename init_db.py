"""
Database Initialization Script (SQLite)

This module is responsible for setting up and seeding the local SQLite
database used by the Karaoke system. It creates the required schema and
inserts initial song data with predefined rhythm mappings.

Core Responsibilities:
- Define and create the `songs` table if it does not exist
- Reset existing song data for a clean initialization state
- Insert seed data including YouTube references and rhythm timing maps
- Configure database path via environment variable or default location

Key Features:
- Environment-based database path configuration (KARAOKE_DB_PATH)
- JSON-based rhythm mapping for song structure representation
- Idempotent table creation using CREATE TABLE IF NOT EXISTS
- Bulk insertion using executemany for efficiency

Notes:
- This script is intended for development and initial setup only
- Running this will DELETE all existing records in the `songs` table
- Ensure this is not executed in production without safeguards

Author: GM Mercullo
Project: GM's Karaoke System
"""
import json
import os
import sqlite3


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("KARAOKE_DB_PATH", os.path.join(BASE_DIR, "karaoke.db"))


def init_db():
    """
    Initializes the SQLite database and seeds it with default song data.

    Workflow:
    1. Establish connection to the SQLite database
    2. Create `songs` table if it does not exist
    3. Clear existing records to ensure a fresh dataset
    4. Define rhythm map (timed song sections in JSON format)
    5. Insert predefined song entries into the database
    6. Commit changes and close connection

    Returns:
        None

    Side Effects:
    - Modifies the database file at DB_PATH
    - Deletes all existing song records before inserting new ones
    - Outputs a confirmation message to the console
    """
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

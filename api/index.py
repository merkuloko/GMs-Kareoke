import os
import sqlite3
import json
import requests
from flask import Flask, render_template, jsonify, request

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

app = Flask(
    __name__,
    template_folder=os.path.join(base_dir, "templates"),
    static_folder=os.path.join(base_dir, "static")
)
def get_db_connection():
    # Use an absolute path so Vercel doesn't get lost
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    db_path = os.path.join(base_dir, 'kareoke.db')
    
    # This check helps us see the error in the logs if the file is missing
if not os.path.exists(db_path):
    return None
        
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn
# --- PASTE YOUR API KEY HERE ---
YOUTUBE_API_KEY = "AIzaSyCm6N6r9KxIGvtBA0bTmZVMlWodEumD5lY"

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/songs')
def get_songs():
    conn = get_db_connection()
    songs = conn.execute('SELECT id, title, artist FROM songs').fetchall()
    conn.close()
    return jsonify([dict(row) for row in songs])

@app.route('/api/songs/<int:song_id>')
def get_song_detail(song_id):
    conn = get_db_connection()
    song = conn.execute('SELECT * FROM songs WHERE id = ?', (song_id,)).fetchone()
    conn.close()
    if song is None:
        return jsonify({'error': 'Song not found'}), 404
    song_dict = dict(song)
    song_dict['rhythm_map'] = json.loads(song_dict['rhythm_map'])
    return jsonify(song_dict)

@app.route('/api/search')
def search_youtube():
    query = request.args.get('q')
    if not query:
        return jsonify({'error': 'No query provided'}), 400
    search_url = f"https://www.googleapis.com/youtube/v3/search?part=snippet&q={query} karaoke&type=video&maxResults=5&key={YOUTUBE_API_KEY}"
    response = requests.get(search_url)
    if response.status_code != 200:
        return jsonify({'error': 'YouTube API failed'}), 500
    data = response.json()
    results = []
    for item in data.get('items', []):
        results.append({
            'id': item['id']['videoId'],
            'title': item['snippet']['title'],
            'thumbnail': item['snippet']['thumbnails']['default']['url']
        })
    return jsonify(results)

if __name__ == '__main__':
    app.run(debug=True, port=5000)

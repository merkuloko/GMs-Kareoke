GMs Kareoke

A full-stack karaoke web application that allows users to search songs, join a live singing queue, and track leaderboard scores in real time. 
The system integrates with YouTube for song discovery and uses Supabase for cloud-based data storage, with SQLite as a local fallback.

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

Features

Song Management

* Fetch songs from Supabase (cloud) or SQLite (local fallback)
* Structured song data with:
    * Title & artist
    * YouTube video ID
    * Rhythm mapping (timing-based gameplay support)

YouTube Search Integration

* Search karaoke songs using the YouTube Data API
* Automatically appends “karaoke” to queries
* Returns video previews with thumbnails

Mobile Queue System

* Mobile-friendly interface for users to:
    * Enter their name
    * Search songs
    * Add songs to the live queue
* QR code generation for quick access

Live Queue Management

* Add songs to a shared live queue (Supabase)
* Mark songs as played
* Clear queue when needed

Leaderboard System

* Submit scores after performances
* Stores:
    * Singer name
    * Score
    * Song title
* Displays Top 5 performers
* Supports clearing leaderboard

☁️ Dual Database Support

* Primary: Supabase (REST API)
* Fallback: SQLite
* Automatic switching depending on configuration

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

Frontend (HTML/CSS/JS)
        ↓
Flask Backend (index.py)
        ↓
-----------------------------------
| Supabase (Cloud Database)       |
| SQLite (Local Fallback)         |
-----------------------------------
        ↓
External APIs:
- YouTube Data API
- QR Code Generator API

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

Project Structure
project-root/
│
├── api/
│   └── index.py              # Main Flask application (routes + logic)
│
├── templates/
│   ├── index.html            # Main UI
│   └── mobile.html           # Mobile queue interface
│
├── static/
│   ├── css/
│   ├── js/
│   └── assets/
│
├── karaoke.db                # Local SQLite database (optional)
├── .env                      # Environment variables (DO NOT COMMIT)
├── requirements.txt          # Python dependencies
└── vercel.json               # Deployment configuration

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

Installation & Setup
git clone https://github.com/your-username/gms-karaoke.git
cd gms-karaoke

2. Install Dependencies
pip install -r requirements.txt

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

3. Configure Environment Variables

Create a .env file:
YOUTUBE_API=your_youtube_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
MOBILE_QUEUE_URL=http://127.0.0.1:5000/mobile
KARAOKE_WRITE_SECRET=use-a-long-random-secret
ALLOWED_ORIGINS=http://127.0.0.1:5000,http://localhost:5000

All queue and leaderboard writes require `KARAOKE_WRITE_SECRET`; production
requests fail closed if it is missing. Keep `YOUTUBE_API` and Supabase keys
server-side and configure `ALLOWED_ORIGINS` with only trusted frontend origins.

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

Running the Application
python api/index.py

Server will run on:
http://127.0.0.1:5000

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

API Endpoints

Songs

* GET /api/songs → Fetch all songs
* GET /api/songs/<id> → Fetch specific song

Search

* GET /api/search?q=<query> → Search YouTube karaoke videos

Leaderboard

* GET /api/leaderboard → Get top scores
* POST /api/leaderboard → Submit score
* DELETE /api/leaderboard → Clear leaderboard

Live Queue

* POST /api/live-queue → Add song to queue
* PATCH /api/live-queue/<id> → Mark as played
* DELETE /api/live-queue/<id> → Remove one queued song
* PATCH /api/live-queue/reorder → Persist the host's queue order
* DELETE /api/live-queue → Clear queue

Config / Utilities

* GET /api/config → App configuration
* GET /api/queue-qr → Generate QR for mobile access

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

Security Notes

* Never commit .env file
* Rotate API keys if exposed
* Restrict CORS origins in production
* Use Supabase Row-Level Security (RLS) for access control

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

Deployment

This project is configured for deployment using Vercel:

* vercel.json routes all requests to the Flask backend
* Supports serverless deployment

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

Future Improvements

* Real-time updates using Supabase Realtime subscriptions
* Authentication system (admin vs user)
* Song request moderation
* UI/UX enhancements for mobile
* Score analytics and history tracking

⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻⸻

Author

GM Mercullo

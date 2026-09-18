# GM's Karaoke System 🎤

A modern, multi-tenant Karaoke management application featuring a streaming-app aesthetic, room-based session isolation, and a seamless mobile remote queueing system. 

Built with a Flask backend, a React host console, and Supabase for cloud data persistence.

Features

* **Multi-Tenant Architecture:** Independent "Rooms" allow multiple hosts to run isolated karaoke sessions simultaneously.
* **Mobile Remote Queuing:** Guests scan a dynamic QR code or enter a 5-character Room Code to request songs directly from their smartphones.
* **Smart Onboarding:** Device-specific routing ensures hosts get the full console (with scoring/mic support), TVs get a streamlined display-only mode, and phones are routed to the mobile queue.
* **Queue Automation:** Gapless progression and instant autoplay when adding tracks to an empty queue.
* **YouTube Data API Integration:** Live search directly against YouTube's catalog, automatically filtering for embed-friendly videos.
* **Cloud & Local Persistence:** Supabase cloud database for production deployments (Vercel), with a seamless local SQLite fallback for offline development.
* **Security:** Rate limiting and a strict write-authorization token (`KARAOKE_WRITE_SECRET`) prevent queue spam and unauthorized mutations.

Tech Stack

* **Backend:** Python, Flask
* **Frontend (Host):** React, Tailwind-style custom CSS (Dark Mode)
* **Frontend (Mobile):** Vanilla JS, HTML/CSS
* **Database:** Supabase (PostgreSQL), SQLite3 (Local Fallback)
* **Hosting:** Vercel (Serverless Functions)

Local Development Setup

1. Prerequisites
* Python 3.9+
* A YouTube Data API v3 Key
* (Optional) A Supabase Project

2. Installation
Clone the repository and set up a virtual environment:
```bash
git clone https://github.com/yourusername/GMs-Kareoke.git
cd GMs-Kareoke
python -m venv .venv
source .venv/bin/activate  # On Windows use: .venv\Scripts\activate
pip install -r requirements.txt

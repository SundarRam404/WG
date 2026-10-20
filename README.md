# Domso

Her daily rites: tablets, water (2.5 L blood orb), hair wash. Goth theme, installs to the iPhone home screen.

- Live: https://sundarram404.github.io/WG/
- Install: open in **Safari** → Share → **Add to Home Screen**
- Data: localStorage + Firestore doc `shared/domso` (same Firebase project as GAIN)
- Reminders: `push/` is a Cloudflare Worker (free cron, every minute) that reads the doc and sends Web Push. One-time setup: `bash push/setup.sh`
- Old app: GAIN + the gym app are archived in `archive/gain/` (still opens at `/WG/archive/gain/`)

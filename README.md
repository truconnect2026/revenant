# Revenant

An honest field instrument that turns a phone into an environmental sensor readout. It reads the device's **real sensors** and flags readings that break sharply from their own settled baseline. It never synthesizes or randomizes data, and never claims to detect the paranormal.

## What it measures

| Channel | Sensor | Unit | API |
|---------|--------|------|-----|
| **EMF** | Magnetometer | uT (magnitude) | Generic Sensor API (Chromium only) |
| **Sound** | Microphone | dBFS (RMS) + live spectrum | Web Audio AnalyserNode |
| **Motion** | Accelerometer + Gyroscope | m/s^2 + deg/s | DeviceMotion |

## Anomaly detection

Each channel keeps a rolling window of its own recent samples and derives mean + sample stddev. An event fires when `|reading - mean| / stddev >= threshold` (approx 4 sigma for EMF/sound, 4.5 sigma for motion). Samples are scored **before** insertion so spikes don't dilute the baseline. A warmup period of ~60 samples and a 1.5s cooldown between events prevent false positives and repeated logging.

## Platform support

- **Magnetometer**: Chrome/Edge on Android over HTTPS only. iOS Safari does not expose the Generic Sensor API. The panel shows a clear "no channel" message with guidance.
- **Microphone**: Works on iOS + Android. Requires user tap to grant permission.
- **Motion**: Works broadly. iOS 13+ requires `DeviceMotionEvent.requestPermission()` from a user gesture.
- **All sensors require HTTPS** (secure context).

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Note: sensors won't work over plain HTTP on a phone. For device testing, either:

1. **Deploy to Vercel** (recommended) and open the URL on your phone
2. **Tunnel localhost** with ngrok: `ngrok http 3000`, then open the HTTPS URL on device

## Deploy to Vercel

```bash
npx vercel
```

Or connect the repo to Vercel for automatic deployments. The app works with zero configuration — sessions are stored in memory by default.

## Optional: Postgres persistence

To persist sessions across deploys, add a Vercel Postgres database:

1. In the Vercel dashboard, add a Postgres store to your project
2. The `POSTGRES_URL` env var is set automatically
3. The app detects it and switches from in-memory to Postgres — no code changes needed

Schema is created automatically on first request.

## Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Web Sensor APIs
- Vercel (deploy target)

## Design philosophy

This is a **real instrument**, not a spooky toy. Gimmicky apps fake readings with random numbers — this one refuses to. If a sensor isn't available, the panel says so plainly instead of inventing a number.

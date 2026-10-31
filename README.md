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

## Learning loop and the Lab

Revenant can test which detections are real by comparing against ground truth.

- **Session types**: *Investigate* (normal hunt), *Control* (a place with no claims, same setup; measures false alarms) and *Calibrate* (make known sounds and movements on purpose).
- **Test marks**: during a session, tap a mark (Knock, Voice, Magnet…) and then do it. Events within 2 s before to 4 s after are tagged as tests automatically.
- **Felt something + Blind mode**: log subjective moments with the readouts hidden, so the screen can't prompt them.
- **Labels**: every event can be tagged with its real cause (HVAC, footsteps, …) or marked unexplained, in the live log, past sessions or the Lab.
- **Score log**: each channel's raw σ score is stored at 10 Hz so thresholds can be re-tested after the fact.

Open **`/lab`** to see the analysis built from this device's data: dataset overview, a k-nearest-neighbours source model with a leave-one-session-out confusion matrix and an "unknown" reject option, a learning curve, a feature map, what each sensor catches per stimulus, a threshold sweep (detection vs false alarms per hour), investigation-vs-control rates with corrected p-values, a felt-vs-sensor permutation test, a residue queue, and a log for testing other ghost-hunting gear. Every rate shows its sample size and 95% interval; panels without enough data say what's missing instead of drawing a chart. The lab only recommends threshold changes — applying one is a deliberate tap and is logged.

Set `LAB_PASSCODE` in the Vercel project to lock `/lab` behind a passcode. Data lives in the browser's IndexedDB; use *Export dataset* / *Import dataset* on the Lab overview to merge data from several phones.

**Server sync (optional):** add a Neon Postgres database and a Vercel Blob store to the project (they set `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`), then use *Sync now* on the Lab overview on each phone. Sessions, score logs, gear trials and model history merge on the server by id; audio clips are stored privately and stream through the passcode-gated API. For local testing without either, start the server with `LAB_SYNC_MEMORY=1` (data lives in server memory; ignored on Vercel).

Moving the app to another repo or address? See [docs/MIGRATION.md](docs/MIGRATION.md) — browser data is tied to the site address, so export first.

Run the analysis unit tests with `npm test`.

## Community research

Revenant is set up as an open, community-run research project:

- **Contribute (opt-in):** the *Community research* card on the main page explains what is shared and asks for consent. GPS, location names, exact times and device details are stripped on the phone and again on the server; audio needs a separate opt-in. Contributors can withdraw and delete everything they sent.
- **Place type:** sessions can be tagged Home, Cemetery, Historic site… — that is the only location context the community dataset gets.
- **Background training:** a daily Vercel Cron (`vercel.json`, needs `CRON_SECRET`) trains the source models on the community dataset, builds the spec sheet and leaves a *draft* research log. Nothing publishes on its own.
- **Public pages:** `/research` (research logs, each with a social preview image), `/research/spec` (printable spec sheet — models, detection rates, false alarms, method, limitations) and `/privacy`.
- **Lab → Research tab:** switch the lab between *My data* and *Community*, run training, edit a log, publish it, or copy it as Markdown, a short social post or a long caption.

Licences: code under AGPL-3.0 (`LICENSE`); see `docs/DATA_LICENSE.md`, `docs/CONTRIBUTOR_TERMS.md` and `docs/OPEN_SOURCE.md` before making the repo public or opening contributions.

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

To persist sessions across deploys, add a Neon Postgres database from the Vercel Marketplace:

1. In the Vercel dashboard, add Neon Postgres to your project
2. The `DATABASE_URL` (or `POSTGRES_URL`) env var is set automatically
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

## Credits

Built by [David Andrew Jones](https://github.com/truconnect2026) — initial build, sensor
pipeline (magnetometer, microphone, motion hooks), the rolling-baseline anomaly detection in
`lib/anomaly.ts`, spectrogram rendering, and session persistence.

[Curt Stephens](https://github.com/animeaddict124) — Motion Sentry mode, per-channel
include/exclude controls, event-log UX, and the visual and interaction passes.

Portions of this codebase were written with AI assistance, as recorded in the commit trailers.

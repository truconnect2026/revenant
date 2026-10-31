# Moving Revenant to your own GitHub repo and Vercel subdomain

A checklist for moving from `truconnect2026/revenant` + `revenant-chi.vercel.app` to
a repo on your GitHub account and a new address on your Vercel account. Do the
steps in order: step 1 has to happen while the old site still works.

## 1. Save your data from the old site first

Sessions live in each phone's browser storage (IndexedDB), and that storage
belongs to one web address. A new subdomain starts empty, so carry the data
over by file:

- On every phone you've recorded with, open `revenant-chi.vercel.app`, expand
  **Past Sessions**, and tap **Export** on each session you want to keep. Each
  tap downloads one `.json` file plus one audio file per clip. The old app names
  the audio files `.webm`, but they're WAV inside — keep them as they are.
- If you've used the lab on a preview address, open its **Overview → Files** and
  tap **Export dataset** (tick *include audio clips*).

## 2. Create the new GitHub repo

1. Go to github.com/new. Owner: **animeaddict124**. Name it (e.g. `revenant`), set it
   to **Private**, and leave README, .gitignore and license **unticked** so the repo
   starts empty.
2. In VS Code's terminal, in your local copy (`C:\Users\steph\Documents\REPOS\revenant2`):

   ```bash
   git remote rename origin david
   git fetch david
   git remote add origin https://github.com/animeaddict124/revenant.git
   git push origin david/main:refs/heads/main
   git push origin david/lab/learning-loop:refs/heads/lab/learning-loop
   git fetch origin
   git checkout main
   git branch -u origin/main
   ```

   This copies the full history and both branches. `david` stays as a second
   remote so you can still pull anything he pushes to the old repo.
3. The README's Credits section names both of you — keep it.

## 3. Create the Vercel project and pick the subdomain

1. On vercel.com: **Add New → Project**, then import `animeaddict124/revenant`. If the
   repo isn't listed, use the link on that screen to give Vercel's GitHub app access
   to it. Framework is detected as Next.js; leave the build settings as they are.
2. The project name sets the free address: `<project-name>.vercel.app`. If that name
   is taken, Vercel adds a suffix. To choose the address yourself, open the project's
   **Domains** settings and add any free `something.vercel.app` name, for example
   `revenant-lab.vercel.app`.
3. To use a subdomain of a domain you own instead (e.g. `revenant.yourdomain.com`),
   add it in the same Domains screen and create the DNS record Vercel shows you
   (usually a CNAME to `cname.vercel-dns.com`) at your domain registrar.

## 4. Storage and settings

In the project's **Storage** tab:

| Add | Sets | Needed for |
|---|---|---|
| **Neon** (Postgres, from the Marketplace) — connect to this project | `DATABASE_URL` (and `POSTGRES_URL`) | Lab server sync, session backup |
| **Blob** store — connect to this project | `BLOB_READ_WRITE_TOKEN` | Audio clips in sync |

In **Settings → Environment Variables**:

| Name | Value | Needed for |
|---|---|---|
| `LAB_PASSCODE` | a passcode you choose | Locks `/lab` and the sync API. Without it the lab is open to anyone with the link. |
| `OPENAI_API_KEY` | your key (optional) | The *Analyze* (transcribe) button on clips |

Never set `LAB_SYNC_MEMORY` on Vercel — it's for local testing only and is ignored there anyway.

Redeploy after adding storage or variables (Deployments → ⋯ → Redeploy) so they take effect.

## 5. Put the lab live

On your new repo, open a pull request from `lab/learning-loop` into `main` and merge
it. Vercel deploys `main` to your new address. Until then the lab is only on that
branch's preview address.

## 6. Bring your data in

On each phone, at the new address:

1. Allow the microphone and motion prompts again — permissions are per address.
2. Open `/lab`, enter the passcode, go to **Overview → Files → Import files**, and
   select the session `.json` files **and** their audio files from step 1 in the
   same pick (or a dataset file). Audio is matched to its event by file name.
3. Tap **Sync now**. Do this on every phone; each one ends up with everyone's data.

Check: the Overview counts match what you exported, **Sync now** reports *Synced*, and
a clip from another phone plays in the Residue tab.

## 7. Retire the old site

Once the new address has everything, ask David to delete the project from his Vercel
account (project Settings → Advanced → Delete). That takes `revenant-chi.vercel.app`
offline, so update any links you've shared first.

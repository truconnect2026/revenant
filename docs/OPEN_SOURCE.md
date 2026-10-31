# Going open source — checklist

1. **Agreement from every code owner.** Revenant started in David Andrew Jones's
   repository; get his written OK to release it under AGPL-3.0-or-later before
   making the repo public.
2. **Secrets.** Confirm no keys are committed (`git log -p | grep -i key` and
   GitHub secret scanning). Environment variables live only in Vercel.
3. **Licences.** `LICENSE` (AGPL-3.0) is in the repo root; see `DATA_LICENSE.md`
   for the dataset and writing.
4. **Contributor terms + privacy.** Have `CONTRIBUTOR_TERMS.md` and `/privacy`
   reviewed before inviting the public to contribute.
5. **Make the repo public** on GitHub, then add a short CONTRIBUTING section:
   how to run it (`npm install`, `npm run dev`, `LAB_SYNC_MEMORY=1` for sync
   without a database), and `npm test` before opening a pull request.

# Contributor terms (draft)

> Draft for review by a lawyer before the community dataset opens to the public.
> The in-app consent screen and `/privacy` page describe the same rules in plain
> language; keep all three in step and bump `CONSENT_VERSION` in
> `src/lib/community/privacy.ts` whenever the meaning changes, so every
> contributor re-confirms.

## What a contributor agrees to

1. **They recorded the session** and have the right to share it.
2. **What is shared:** sensor readings and score logs, events and their labels,
   test marks, felt-something marks, session type, chosen place type, an optional
   state or country, the date and hour (exact time is shifted to the top of the
   hour), and phone type.
3. **What is never shared:** GPS or any coordinates, the free-text location
   name, exact clock time, device id or browser details. These are removed on
   the phone and again on the server.
4. **Audio is separate:** clips are shared only with a second, explicit opt-in.
5. **Licence to the project:** the contributor grants the Revenant maintainers a
   worldwide, non-exclusive, royalty-free licence to store, analyse, publish and
   sublicense the contribution **in this de-identified form**, including in an
   open research dataset and in paid data products.
6. **Withdrawal:** the contributor can delete everything they contributed at any
   time from the app. Aggregate statistics already published cannot be withdrawn.
7. **Revenue sharing (open question):** decide before any data is sold whether
   contributors receive anything (credits, revenue share, free Pro). Changing this
   later means re-consent.

## Before selling any data

- Get these terms reviewed for every place contributors live (US state privacy
  laws differ; GDPR applies to EU residents).
- Re-check that no field can re-identify a person, especially for rare place
  types in small regions. Publish only groups with enough sessions.
- Keep a record of which consent version covered each contribution
  (`consentVersion` on the contributor record).

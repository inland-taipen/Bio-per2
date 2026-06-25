# Personalizing this app for a new subject

This is a **per-instance** app: one deployment = one subject. To create the next
person's instance, fork the repo and follow this list. It should take ~20 minutes.

## 1. Edit `subject.config.js` (required — the single source of truth)
Update every field: `name`, `honorific`, `pageTitle`, the whole `ui` block
(logo text, title, subtitle, nameplate, pull quote, `timeline[]`, `bioFacts[]`),
the LLM context (`interviewerBackground`, `onboardingBackground`), and the
`openings` messages.

> ⚠ **Board roles / factual claims** drift over time and are recited *to the
> subject* by the interviewer. Verify them against the subject's own latest
> public disclosure before deploying, and update the "VERIFIED" date comment.

## 2. Swap the asset files in `/public`
Replace `portrait.png`, `crest.png`, `hero-bg.png`, and `favicon.png` with the
new subject's images (keep the same filenames).

## 3. Update the HTML fallback text in `public/index.html` (cosmetic)
The welcome screen is populated at runtime from `/api/config`, but the HTML also
contains the current subject's text as a **fallback** (shown for a split second
before JS runs). Find/replace the old name and strings in `index.html` so a slow
load never flashes the wrong person. Elements to update carry `id="cfg-..."`.

## 4. Update `package.json`
Change `name` and `description` to the new subject.

## 5. Run the leftover sweep
```bash
grep -rin "<old-subject-surname>" . --exclude-dir=node_modules --exclude-dir=.git
```
Hits should only be in `subject.config.js` and asset filenames. Fix anything else.

## 6. Deploy on Railway
- Provision a **Volume**, mount path `/data`.
- Set env vars: `DATA_DIR=/data`, `ACCESS_CODE=<secret>`, `GROQ_API_KEY=<key>`.
- Keep `numReplicas = 1` (the Volume + sql.js write model require it).
- Start fresh: the new instance has its own empty `biography.db` on the volume.

## Local development
Create a `.env` (gitignored) with `GROQ_API_KEY`, and optionally `ACCESS_CODE`
(omit it to disable the unlock gate locally) and `DATA_DIR`. Then `npm start`.

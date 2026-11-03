# Contributing to ASTN

safetytalent.org is used by real applicants and course teams. Anything merged into `main` is live a few minutes later, so this page walks through a change from start to finish and lists what to check at each step. Setup instructions are in the [README](README.md).

## How a change reaches production

- **Pushing to `main` publishes the change.** Vercel, the service that hosts the site, picks it up automatically. It first updates the backend (Convex: the database and the server code) and then the website. If the backend update fails, nothing is published, so the site never ends up half updated.
- **Other branches and pull requests get a preview link, but only for the website.** The backend is not updated for previews, so a preview that depends on new backend code will not work.
- **Automatic checks run on every push, but they do not stop a release.** GitHub runs them (`.github/workflows/ci.yml`): code style, type errors, the build, tests, and a quick load of real pages. The change goes live even if they fail, so wait until they pass before you call it done.
- **The live site is checked after every release and every hour.** A job loads the home page and the application link of every open opportunity. If something fails, GitHub emails whoever pushed last.

## 1. Set up your computer

Install the project's packages with **pnpm**, the tool CI and Vercel use. Bun is only used here to run scripts and tests.

- Run `pnpm install`. If you don't have pnpm, run `npx -y pnpm@10.32.1 install` or `corepack enable`.
- Never run `bun install` or `npm install`. They leave behind packages that pnpm does not remove, and the tools then quietly pick up the wrong versions.

**If a tool fails with an error that has nothing to do with your code**, your installed packages are probably mixed up. These errors are a sure sign:

- `vp dev` fails with "Failed to convert napi value into rust type `bool`".
- `vp build` fails with `MISSING_EXPORT` from `@tanstack/router-core`.
- The commit check rejects `--no-error-on-unmatched-pattern`.

Fix it with `rm -rf node_modules && pnpm install`. If the error persists after reinstalling, ask in #astn-feedback before working around it.

## 2. While you work

- **Use your own test database.** Run `bunx convex dev`, which creates a development copy of the backend with its own data. Never test against production data.
- **Commit in small steps.** Each commit is one change, with a message that starts with its type and says what changed in plain words. For example:
  - `fix(polls): only Send submits availability` for a fix
  - `feat(forms): ...` for something new
  - `chore: ...` for maintenance

  Anyone reading the history later should understand each commit without opening it.

- **Let the commit check run.** Every commit automatically formats the files you changed and checks them for mistakes. If it fails, read the message: it usually names the file and line to fix. Don't skip it with `--no-verify`.

## 3. Before you push

1. **Run the same checks as CI:**
   ```bash
   pnpm run lint && pnpm run lint:convex
   pnpm exec tsc -p convex/tsconfig.json --noEmit
   bun test src convex
   vp build
   ```
   `vp check --no-fmt` is a faster check of the website code alone.
2. **Try the change yourself in the browser, twice.** First logged in as an admin, then as someone who is not an admin, or logged out. Most breakages happen on a page that visitors see and admins never open.
3. **Use the tools that let you test without anyone else seeing:**
   - **Draft opportunities are private.** New and duplicated opportunities start as `draft`. Their application link only works for admins and for people with access to that course, so you can fill in the real form before anyone else can. Switch the opportunity to `active` when it is ready.
   - **Create a new opportunity to test forms.** A new opportunity starts from the org's canonical form (admins edit it in Admin → Canonicals), and its questions can be changed until someone applies. An opportunity that already has applications keeps its form locked.
   - **Simulate several applicants with your own inbox.** Apply with Gmail aliases: `you+qa1@gmail.com`, `you+qa2@gmail.com`, and so on. ASTN treats each alias as a different person, and every email arrives in your inbox. Give the test opportunity a course tag, because course features (the form's course name, next edition, links between editions) only work with one. Keep it active only while you test, and archive it when you are done: while it is active it is public, and it can be taken for that course's open edition.
   - **Preview a survey** from the opportunity's Feedback tab. It shows the survey exactly as respondents will see it, including edits you have not saved.
   - **Send yourself an email first.** On the opportunity's Emails tab, "Compose broadcast" opens the page for writing an email to applicants. Its "Send a test email" box sends it only to you, so you can see it in your inbox before anyone else gets it.

## 4. After it ships

- **Confirm the live site check passed** after your release. A successful Vercel deploy only means the build worked, not that the pages load.
- **If something looks wrong, say so right away** in #astn-feedback, with what you saw and when. Website errors are recorded in Sentry, but backend errors are kept only for a short time, so the sooner someone looks, the more there is to see.
- **A release that fails in about two seconds, before building, was probably blocked by Vercel.** Vercel refuses to publish when a package has a known security flaw. Ask someone with access to the Vercel project for the first line of the log.

## Changes that need extra care

If your change touches one of these areas, follow its rules on top of the steps above.

### Pages people outside the team use

Application forms, polls, surveys and any public page. The people using them can't ask how something works, and often can't undo what they did. Check that:

- **Nothing happens without a clear action.** Information is sent or saved only when the person asks for it, they can see what they are sending, and they get a clear confirmation afterwards.
- **The text reads naturally.** Questions, hints, pop-ups and error messages are short, in the language of the page, and say what to do next.
- **It works on a phone as well as on a computer.** Every screen, pop-up and table can be read and used at phone width.
- **The unusual cases make sense.** A missing answer, a closed opportunity or an old link each show a message that explains what is going on.

### Emails to applicants

- **Most emails wait for someone to press Send.** Changing an application's status never sends an email. It adds a draft to the opportunity's Outbox, and someone on the team sends it from there.
- **Two emails do go out on their own:**
  - the confirmation when someone applies;
  - the availability emails from a poll's shared link.
- **Check the Outbox before you press Send.** When an opportunity starts using email templates after decisions have already been made, ASTN creates a draft for each of those decisions. Make sure each one should go out.

### Links already shared

Application, poll and survey links are pasted in Slack, WhatsApp and old emails, and they must keep working. An opportunity can be opened by its readable name or by its id, and both work forever. Don't rename or remove a page address that people may have saved.

### Updating packages

- **Open the pages the automatic checks don't cover.** The checks load the home page and the application links, but not the admin pages, polls or surveys. Open those yourself and confirm they show their content.
- **Remove packages the update made obsolete.** When an update replaces a package with a new one, the old one can stay installed and break the site.

### Database and backend code

These rules come from mistakes that took the site down:

- **New opportunity fields go in two places.** Every field added to `orgOpportunities` must also be added to `opportunityReturnValidator` in `convex/orgOpportunities.ts`. If you miss it, the admin pages stop loading.
- **Change the shape of existing data in two separate releases.** Convex refuses data that doesn't match the declared shape. So:
  1. First release: allow both the old and the new shape, and run a script that converts every record to the new shape. Write the script so that running it twice does no harm.
  2. Second release: once every record is converted, remove the old shape.

  Before converting anything, save a copy of production with `convex export`.

- **Keep form question keys clean.** Question keys are cleaned up in `convex/lib/formFields.ts`; keep it that way. A key like `why?` is not a valid field name, and it only breaks when someone answers that question.
- **Regenerate the generated files after adding a backend file.** Run `npx convex codegen`.

## Known gaps

What still depends on someone noticing in time, roughly in order of impact for the effort:

- **Failures reach one person's inbox.** The live site check can already post to Slack; it only needs a Slack webhook saved as the `SLACK_WEBHOOK_URL` secret in GitHub.
- **Backend errors are not recorded anywhere lasting.** Convex can send them to Sentry automatically, next to the website errors.
- **A release goes live even when the checks fail.** Vercel can be set to wait for the GitHub checks before publishing.
- **There are no regular backups of production.** A copy is only made by hand before a data change. A scheduled backup would cover mistakes nobody planned for.
- **The automatic checks miss pages and rules.** In October 2026 every check passed while all pages that load data were down for 18 hours. The page check now covers application links, but not polls, surveys or admin pages, and the tests cover helper functions, not permissions, form locking or emails.
- **There is no shared test environment.** Previews have no backend of their own, and test opportunities live among the real ones. A test copy of the backend for previews, and a test course tag that the site recognizes everywhere, would keep testing away from applicants.
- **Almost every change goes straight to `main` without a second reader.** A pull request for changes to data, permissions or emails would catch mistakes before they ship.

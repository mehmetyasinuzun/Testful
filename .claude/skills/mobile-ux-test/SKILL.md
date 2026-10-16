---
name: mobile-ux-test
description: >-
  Autonomous mobile UX/UI testing for Android apps (Flutter, Kotlin/Java, React
  Native/Expo). Use when the user wants to test a mobile app, find UX/UI or
  functional bugs, verify a code change didn't break the app, generate test
  scenarios, check whether an app is release/market ready, or run a
  self-healing test→fix loop on an emulator or device. Triggers: "uygulamayı
  test et", "UX/UI test", "mobil test", "beta'ya hazır mı", "bir şey bozuldu mu",
  "test my app", "is my app release ready".
---

# Mobile UX/UI Test Agent (Testful)

You are an autonomous mobile QA engineer. A deterministic CLI (`testful`) does
all device work and returns a verdict; you decide what to run, judge what the
CLI cannot (visuals, intent), and fix code. **All user-facing output is Turkish.**

## Invoking the CLI
Use `testful <cmd>` if on PATH, else `bash .claude/skills/mobile-ux-test/scripts/testful.sh <cmd>`.
Run device commands through the **Bash tool** (PowerShell corrupts binary output).
Add `--json` when you need to parse results: stdout is a compact JSON verdict,
logs go to stderr.

| Exit | Meaning | Your move |
|---|---|---|
| 0 | `ready` — no blocking findings | report, optionally widen coverage |
| 1 | `not-ready` — blocking findings | read `findings` + `next_actions`, fix |
| 2 | usage error | fix the command |
| 3 | `inconclusive` / environment (no device, disk full, Maestro driver) | run `testful doctor`, fix env, rerun. **Never** treat as an app bug |

## Cheat sheet
```
testful doctor --json                         env check (adb, device, maestro, java, disk)
testful init [app_dir]                        .qa/ skeleton + .qa/testful.json + .gitignore
testful smoke [app_dir] --json                no scenarios needed: install → cold start →
                                              crash/ANR → a11y → seeded chaos → verdict
testful observe --json                        current screen: real selectors + a11y issues
testful map [--max 80]                        autonomous crawl → .qa/map/graph.json + map.md
testful author --from-map                     one regression flow per discovered screen (no AI)
testful run [app_dir] [glob] --json           run .qa/scenarios/*.flow.yaml (isolation, 3× retry,
          [--matrix dark,large-font,landscape,offline]   flaky quarantine, crash detection, diff)
testful report <run_dir> --json              re-render after you add findings.extra.json
```
Config: `.qa/testful.json` → `package`, `apk` (auto-installed if missing),
`reverse` (ports for `adb reverse`), `flowTimeoutSec`, `retries`, `prelaunch`,
`isolate`. Secrets: `.qa/env.local` (`EMAIL=...`) → flows use `${MAESTRO_EMAIL}`.

## Default workflow
1. **Doctor.** `testful doctor`. Exit 3 → fix env first, tell the user exactly what's missing.
2. **Build** the APK the project's own way (`flutter build apk --debug`, `./gradlew assembleDebug`, …).
3. **Smoke.** `testful smoke --apk <apk> --json`. Crash/ANR here = stop, root-cause from
   `detail` (stack) + evidence, fix, rebuild, re-smoke.
4. **Coverage.** First time on an app: `testful map` → `testful author --from-map` →
   review `.qa/map/map.md` with the user. Map stops at walls (login/OTP/paywall) and says
   why (`stats.stop_reason`): ask for test creds into `.qa/env.local` and re-map.
5. **Intent scenarios** (source available): write oracle'd pairs for core journeys
   (references/scenario-packs.md). Selectors ONLY from `testful observe` output — never
   guessed from source. Source predicts the FLOW, the tree provides the SELECTORS.
6. **Run.** `testful run --json` (add `--matrix ...` for the RESILIENCE tier).
7. **Judge visuals** only where needed: failed scenarios' debug screenshots and
   `shot: true` steps, asking yes/no against the step's `expect`. Write results to
   `<run_dir>/findings.extra.json`, then `testful report <run_dir>`.
8. **Fix loop** (optional, below). Re-run the affected scenario, then the CORE smoke subset.

After any code change the user makes with you: rebuild → `testful smoke --json` →
`testful run --json`. The report's `diff` tells you new / resolved / persisting.

## Trust rules (built into the CLI — don't fight them)
- Animations off + status-bar demo mode during runs; previous device settings restored.
- Every attempt starts with `pm clear` (disable with `"isolate": false` only if a flow needs state).
- Retry policy: 1st fail → 2 more attempts. All fail = **kesin**. Mixed = **flaky-şüphesi**
  (quarantined, never blocks, never enters the fix loop). Same crash signature twice = kesin.
- Crashes are attributed by package: another process crashing (e.g. emulator services) is
  NOT the app's finding.
- Evidence hierarchy: logcat signature > deterministic assert > vision interpretation.
  Vision-only findings are at most **muhtemel**.

## Fix loop — git safety (non-negotiable)
- Dirty working tree → STOP and ask. Never touch uncommitted user work.
- Branch `qa-fix/<run-id>`; one commit per finding; minimal diffs in project style.
- Re-run only the affected scenario; max 3 attempts → mark `blocked`.
- Afterwards re-run CORE; if a fix broke another flow, revert it and mark `fix-regressed`.
- Testability patches (missing `Key`/`Semantics`/`contentDescription`/`testID`) are findings
  of type `testability`; a11y-missing labels from `smoke`/`observe` are good candidates.

## Walls, auth, PII
- Login/OTP/captcha/paywall/destructive action → pause, show the screen, ask the user.
  Destructive-looking buttons (delete, logout, pay, subscribe, sil, çıkış, öde…) are never
  tapped by the crawler.
- Never hardcode credentials in committed files; `.qa/env.local` is gitignored.
- If a screenshot shows real personal data, stop capturing that flow, warn, and exclude it.

## Support files
- references/scenario-packs.md — oracle format (goal / final_assertion / steps), archetypes, budgets
- references/report-format.md — run folder, report.json schema, statuses, findings.extra.json
- references/engines.md — framework→engine, Maestro/Patrol field lessons, visual regression
  (`assertScreenshot`), adb cheat sheet, Windows rules

# E2E Demo Videos

Latest passing PRD scenario videos are in `apps/web/e2e-videos/latest`:

- `01-overtime-trap.webm`
- `02-timezone-tangle.webm`
- `03-simultaneous-assignment-victor.webm`
- `03-simultaneous-assignment-riley.webm`
- `04-fairness-complaint.webm`
- `05-regret-swap.webm`
- `06-sunday-night-chaos.webm`

GitHub-friendly GIF previews are also provided:

- `01-overtime-trap.gif`
- `02-timezone-tangle.gif`
- `03-simultaneous-assignment-victor.gif`
- `03-simultaneous-assignment-riley.gif`
- `04-fairness-complaint.gif`
- `05-regret-swap.gif`
- `06-sunday-night-chaos.gif`

Notes:

- Scenario 3 uses two browser contexts (Victor and Riley), so it has two recordings.
- Standard Playwright videos are also written to `apps/web/test-results/**/video.webm`.
- To regenerate scenario 3 videos, run Playwright with `E2E_CAPTURE_SIMULTANEOUS_VIDEO=1`.

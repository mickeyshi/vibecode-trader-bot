# 0011 Mobile Reporting PWA

## Context

Operators need live reports on Android. A native application would add a second UI codebase,
distribution signing, store operations, and an authenticated remote API before the dashboard data
contract has stabilized. The existing React dashboard is read-only and already consumes a
normalized operations snapshot.

## Decision

Make the dashboard an installable progressive web application as the first Android client. Keep it
read-only. The app polls the same snapshot endpoint, explicitly labels sample/stale/current data,
surfaces connectivity and last-sync state, and retains the last rendered snapshot during temporary
network loss. Its service worker caches only the application shell; it never caches the live
operations snapshot.

The local Vite server and preview server expose the ignored `reports/live-ops-snapshot.json` through
middleware with `Cache-Control: no-store`. Generated account reports remain outside the compiled
application and version control.

## Tradeoffs

This provides one responsive codebase and an Android home-screen experience quickly, but it is not
a hosted deployment. Android installation over a LAN requires HTTPS, and remote access requires an
authenticated API, authorization, TLS, secrets management, and an explicit hosting decision.

## Consequences

- Mobile reporting can be developed and tested without enabling order entry.
- Offline mode can display the app shell but must identify unavailable or stale live data.
- Native notifications, biometric authentication, and app-store distribution remain optional later
  stages rather than prerequisites for validating the reporting UX.

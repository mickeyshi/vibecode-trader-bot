# 0012 First Hosted Paper Deployment

## Status

Proposed. Creating an account resource, incurring cost, exposing an endpoint, or deploying remains
an explicit operator decision.

## Context

The first hosted deployment must support the existing single-host SQLite recovery database, one
coordinator owner, durable reports, outbound Alpaca HTTPS access, an HTTPS read-only Android PWA,
runtime secrets, health monitoring, backup, and rollback. It must not introduce live-capital
execution or dashboard order controls.

The earlier DigitalOcean App Platform assumption no longer fits: its application filesystem is
ephemeral and App Platform does not support persistent volumes. Moving there would first require a
managed-database migration. A split web-service/worker topology is also premature because the
current SQLite lease and report files intentionally assume one local host.

## Options Considered

### One Fly.io Machine and one volume

Run the read-only web/API surface and bounded paper coordinator on one Machine, with SQLite,
heartbeats, and reports under one mounted volume. Fly volumes are local to a Machine and are not
automatically replicated, which matches the current single-host constraint rather than pretending
to provide multi-host failover. Fly supports encrypted runtime secrets and managed TLS
certificates. Current published pricing starts near $3.32/month for a continuously running shared
CPU Machine with 512 MiB RAM, plus $0.15/GB/month for a volume; actual usage and taxes vary.

Tradeoffs: a volume is tied to local hardware; the first deployment has a single-host failure
domain. Deploy and restore procedures must preserve the SQLite database and its WAL/SHM siblings.
Only one Machine may run the coordinator. Authentication is still an application or identity-proxy
responsibility.

### One Render service and one persistent disk

A paid Render web service or background worker can attach a persistent disk, but the disk is
available to only one service instance. Attaching it prevents horizontal scaling and zero-downtime
deploys. Render cron jobs cannot access persistent disks, so a disk-backed coordinator would need
to run inside the long-lived service instead of as a cron job. This is viable but less direct for
the current bounded scheduling model.

### DigitalOcean App Platform with a managed database

App Platform is operationally approachable and starts at $5/month for a 512 MiB component, but it
has no persistent volumes. Retaining SQLite would lose recovery state during replacement or
deployment. Using App Platform therefore requires migrating execution state and reporting storage
to managed services first; its development database currently adds a separate monthly charge.

### Existing Windows host behind authenticated HTTPS

This is the lowest-migration reporting pilot and preserves current state, but it makes the operator
responsible for host uptime, patching, network reliability, TLS ingress, and identity-aware access.
It is useful for a temporary private mobile pilot, not the preferred first unattended deployment.

## Proposed Decision

Use one small Fly.io Machine with one encrypted persistent volume as the first hosted **paper-only**
deployment target. Keep `instance_count = 1`, place all mutable runtime state under one mount, and
run only one coordinator process. Serve the read-only dashboard and API from the same process or
host so no second service needs direct SQLite access.

Do not provision it until these repository-level prerequisites exist and pass locally:

1. A production HTTP server serves the built PWA, report APIs, `/health/live`, and `/health/ready`.
2. Every non-health route is protected by reviewed authentication and authorization.
3. Container startup validates paper mode, the paper endpoint, the armed kill switch, exactly one
   coordinator owner, and writable persistent paths before becoming ready.
4. The image runs as a non-root user and contains no credentials or generated reports.
5. A backup/restore drill covers SQLite plus WAL/SHM files and retained report history.
6. CI builds and scans the container without credentials; deployment remains a separately approved
   environment with manual promotion and rollback.
7. External heartbeat and alert delivery are configured outside the deployed Machine.

The initial hosted release remains read-only from the dashboard and dry-run-only for scheduled
coordinator activity. A manually confirmed bounded paper submission remains separate. Live-capital
deployment requires a later ADR and all live-capital gates in `SPEC.md`.

## Sources Checked

- [DigitalOcean App Platform storage](https://docs.digitalocean.com/products/app-platform/how-to/store-data/)
- [DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/)
- [Fly.io volume model](https://fly.io/docs/volumes/overview/)
- [Fly.io pricing](https://fly.io/docs/about/pricing/)
- [Fly.io secrets](https://fly.io/docs/apps/secrets/)
- [Render persistent disks](https://render.com/docs/disks)
- [Render cron jobs](https://render.com/docs/cronjobs)

## Review Triggers

- More than one coordinator or region is required.
- The dashboard and coordinator must scale independently.
- Recovery-point or recovery-time objectives exceed a single-volume restore.
- SQLite becomes a throughput, portability, or operational bottleneck.
- Hosted monthly cost exceeds the approved budget.
- Live-capital trading is proposed.

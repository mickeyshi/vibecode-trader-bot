# 0001: Initial Hosting Platform

## Status

Accepted as an initial assumption.

## Context

The project is a small trading bot that should remain understandable, inexpensive, and easy to iterate on. AWS is powerful, but it adds operational overhead early: IAM, networking, deployment pipelines, log routing, secrets, and more places for cost surprises.

## Decision

Use DigitalOcean App Platform as the assumed first hosted deployment target. Keep the app containerized and configuration-driven so the hosting platform can be changed later without rewriting strategy, risk, execution, or data-feed code.

## Expected Shape

- One web/API service for dashboard, health, and control endpoints.
- One background worker for the trading loop, paper trading, scheduled jobs, and feed processing.
- Managed environment variables or secrets for credentials.
- A small managed database only when local files are no longer enough.

## Cost Notes

Initial hosting should be reviewed against an estimated budget of roughly $12-$25/month before paid market data, news feeds, or premium monitoring. Paid data feeds may exceed infrastructure costs and should be evaluated separately.

## Review Triggers

Reevaluate the platform when any of these become true:

- Monthly hosting cost trends above roughly $50-$75 before data-provider fees.
- The bot needs stronger uptime guarantees, multi-region failover, or dedicated networking.
- Background worker behavior becomes difficult to manage on App Platform.
- Logs, metrics, alerts, or audit trails become insufficient for live trading.
- Database, queue, or secret-management needs outgrow the simple deployment.
- Multiple strategies, users, or exchanges require clearer service boundaries.

## Migration Candidates

Likely next platforms are a small VPS, DigitalOcean Droplets, Fly.io, Render, or AWS ECS/Fargate. AWS should be reconsidered when operational maturity matters more than early simplicity.

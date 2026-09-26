# Jev Shooter

A 3D neon arena wave shooter in the browser where **every enemy's tactic — chase / flank / retreat — is decided by [Jev](https://docs.typesafe.ai/api)**, TypeSafe's decision model. All enemies are batched into **one** Jev call per tick.

## Run

```bash
npm install
cp .env.example .env   # paste your JEV_API_KEY
npm run dev
```

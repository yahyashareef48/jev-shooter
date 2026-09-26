# Jev Shooter

A 3D neon arena wave shooter in the browser where **every enemy's tactic (chase / flank / retreat) is decided by [Jev](https://docs.typesafe.ai/api)**, TypeSafe's decision model.

The twist: the whole squad goes to Jev in **one batched call** per tick. Every live enemy gets its own `choice` question, and all of them share one bucketed snapshot of the fight. The answers come back typed and carry probabilities, and the enemies act on them straight away through local steering.

## Run it

```bash
npm install
cp .env.example .env      # paste your key into JEV_API_KEY
npm run dev               # http://localhost:5173
```

- If there is no key, the game runs in **mock mode**. A local stand-in returns the same response shape, so everything still works offline.
- Add `?mock` to the URL to force mock mode, or press **J** in-game to toggle between live and mock.
- The key is read **only** by the Vite dev server (`server/jevProxy.ts`). It is never `VITE_`-prefixed and never reaches the browser bundle.

| Script | What it does |
|---|---|
| `npm run dev` | Game + Jev proxy on one port |
| `npm test` | Vitest suite (buckets, request builder, director, steering, waves, proxy validation) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Typecheck + production build (`npm run preview` serves it with the proxy) |

## Controls

| Key | Action |
|---|---|
| WASD | move |
| Mouse | aim (click the game to lock the pointer) |
| Left click | fire (watch the heat ring: overheating locks the gun) |
| Shift / Space | dash (brief invulnerability) |
| Tab | toggle the AI Director panel |
| J | live ↔ mock Jev |
| P | **Jev pilots you**: it plays both sides (also `?pilot` in the URL) |
| M | mute |
| Esc | pause |

## How the AI works

```
Browser                                             Vite dev server
┌───────────────────────────────┐   POST /api/decide  ┌────────────────────────┐    ┌──────────────────────┐
│ Director (every 1.5s + events)│ ──────────────────▶ │ jevProxy               │ ─▶ │ api.typesafe.ai      │
│  stateBuilder: buckets + one  │                     │  + Bearer JEV_API_KEY  │    │ POST /v1/systemone   │
│  choice question per enemy    │ ◀────────────────── │  validates, times out  │ ◀─ │                      │
│  gate → balance → hysteresis  │   answers+usage     │  mockJev if no key     │    └──────────────────────┘
│  → Enemy.setIntent → steering │                     └────────────────────────┘
└───────────────────────────────┘
```

1. **Snapshot → buckets** (`src/ai/buckets.ts`, `stateBuilder.ts`). Jev reads numbers as text, so everything is bucketed first: health `full…critical`, distance `point-blank…far`, bearing `in front / left / right / behind the player`, weapon `cool…overheated`, whether the enemy is in cover, and nearby allies. Squad counts and a closeness rank let each answer take the rest of the squad into account.
2. **One request per tick** carries a `choice` question for up to 40 enemies (the nearest first). Each enemy type gets its own criteria wording. Enemies beyond the cap are handled locally.
3. **Applying answers** (`src/ai/director.ts`):
   - **Confidence gate:** anything below 0.35 goes to the local fallback brain.
   - **Squad balance:** each question is answered independently, so at most 45% of the squad may flank and 50% may retreat. The units that wanted a capped tactic least are moved to their next-best option, using Jev's own probabilities.
   - **Hysteresis:** a unit keeps its tactic for at least 1 s unless the new choice beats the current one by more than 0.25.
   - **Stale drop:** answers for enemies that died, or that arrive after the wave has changed, are discarded.
   - **Flank sides** are split between left and right so flankers spread out.
4. **Failure:** on a 429, 529 or timeout, the director backs off exponentially (1 s → 8 s). The badge switches to **FALLBACK** and `fallbackBrain.ts` drives everyone, so the game never stalls.
5. **Execution** (`src/ai/steering.ts`):
   - *chase* seeks the player, or holds firing range for gunners.
   - *flank* orbits in arcs of up to 50° toward a point 130° off the player's facing.
   - *retreat* heads for the far side of the best pillar and regenerates there.

### Jev as the pilot (P)

Press **P** (or open `/?pilot`) to let Jev fly the player too. It doesn't need a second call: two more questions ride along in the same batched request.

- `player_move` picks one of `advance`, `strafe_left`, `strafe_right`, `retreat`, `take_cover` or `dash_away`.
- `player_target` picks which enemy to shoot. Its options are the live enemy ids, each with a short description.

Local reflexes in `src/systems/Autopilot.ts` then do the frame-by-frame work:
- Turn the camera toward the target at a human-like speed.
- Fire only when lined up with a visible target, and stop short of overheating the gun.
- Steer around pillars and away from the wall, dash once per `dash_away` decision, and grab health orbs when hurt.

If Jev isn't sure, a local pilot brain (`src/ai/pilot.ts`) fills in. Release the mouse (Esc) to watch while Jev plays. When a piloted run ends, it restarts itself after a few seconds.

The **AI Director panel** (Tab) shows the mode, per-call latency with a sparkline, tokens, running cost, decision counts, and each enemy's chase/flank/retreat probability bar with its confidence and source. The last raw request and response JSON are there too; they can be expanded while the game is paused.

Costs at Jev's listed price ($0.042 / 1M input tokens, output free) come to a fraction of a cent per minute, even with a full squad.

## Project layout

```
server/        jevProxy.ts (Vite middleware), mockJev.ts
src/ai/        types, buckets, stateBuilder, director, fallbackBrain, steering, jevClient
src/core/      config (all tunables), events, input, math
src/entities/  Player, ThirdPersonCamera, Enemy (+ types/visuals), Projectile pool, Pickups
src/render/    Renderer (bloom/vignette/tone mapping/chromatic), Sky, neon reflective floor shader
src/systems/   waves, combat, collisions, FX (particles/shards/shockwaves), WebAudio synth
src/world/     Arena (pillars, energy wall), cover helpers
src/ui/        HUD, radar, off-screen arrows, AI panel, screens
tests/         Vitest suite
```

Everything is procedural, with no external art or audio assets. Tuning lives in `src/core/config.ts`.

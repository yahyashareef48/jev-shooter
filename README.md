# Jev Shooter

A 3D neon arena wave shooter in the browser where **every enemy's tactic (chase / flank / retreat) is decided by [Jev](https://docs.typesafe.ai/api)**, TypeSafe's decision model.

The twist: the whole squad goes to Jev in **one batched call** per tick. Every live enemy gets its own `choice` question, and all of them share one bucketed snapshot of the fight. The answers come back typed and carry probabilities, and the enemies act on them straight away through local steering.

## Run it

This is a local app: clone it, run it, and bring your own [TypeSafe](https://typesafe.ai) key.

```bash
git clone https://github.com/yahyashareef48/jev-shooter.git
cd jev-shooter
npm install
npm run dev               # http://localhost:5173
```

Then press **O** (or click **⚙ Settings**), go to **Jev**, paste your TypeSafe API key and click **Test connection**.

- **Where the key lives:** in your browser's localStorage. It is sent only to your own local dev server (`server/jevProxy.ts`), which forwards it to TypeSafe. You can also put it in `.env` as `JEV_API_KEY` (see `.env.example`); a key set in the game overrides `.env`.
- **Why there is a local server:** TypeSafe's API doesn't accept calls made directly from a web page (CORS), so the small Vite middleware relays them. Don't run the dev server with `--host` on a shared network while a key is set.
- **No key?** The game runs in **mock mode**: a local stand-in returns the same response shape, so everything still works offline. Add `?mock` to the URL to force it, or press **J** to switch between live and mock.

### Settings (O)

Every tunable value is live-editable in-game, and changes apply straight away. Only values you change are saved (in this browser), each can be reset individually or per tab, and you can export or import them as JSON.

| Tab | What you can change |
|---|---|
| **Jev** | Your key, model, live/mock, Test connection; how often calls go out, batch size, timeout, backoff |
| **Enemy AI** | Confidence gate, hysteresis, squad-balance caps; the enemy **question text** and each type's **answer options** (chase / flank / retreat) |
| **Player AI** | The pilot's **question text** and **move options**; aim/turn reflexes, stall breaker, health-orb thresholds |
| **State** | Checkboxes for every field Jev sees (per enemy, player, squad), plus **Preview next request** to see the exact JSON |
| **Gameplay** | Player and enemy stats, waves, health orbs, camera |

Tip: turn on pilot mode (P), open Settings, and edit prompts or state fields while Jev plays itself. The AI panel (Tab) shows how the probabilities shift.

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
| O | settings |
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

- `player_move` picks one of `advance`, `strafe_left`, `strafe_right`, `retreat`, `take_cover` or `dash_away`, plus `grab_health` whenever there's a health orb on the floor. The state tells Jev whether the nearest orb is close or far, and safe or guarded.
- `player_target` picks which enemy to shoot. Its options are the live enemy ids, each with a short description.

Local reflexes in `src/systems/Autopilot.ts` then do the frame-by-frame work:
- Turn the camera toward the target at a human-like speed.
- Fire only when lined up with a visible target, and stop short of overheating the gun.
- Steer around pillars and away from the wall, dash once per `dash_away` decision.
- Treat health orbs as a side quest, not the goal. When badly hurt it detours for one (urgent). When moderately hurt it grabs a close, unguarded orb in passing (opportunistic). At near-full health it ignores them rather than waste the heal. Once it commits to an orb it keeps going until it collects it, the orb expires, or an enemy starts guarding it.

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

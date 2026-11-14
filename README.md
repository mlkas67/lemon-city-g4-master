# Lemon City — Kukirin G4 Master

A 3D open-world browser game built with Three.js and Vite. Explore a ~1000× area procedural city on foot, summon the Kukirin G4 Master scooter, pull wheelies, rob shops and outrun the LCPD.

The city is streamed in 56 m chunks around you and generated deterministically, so the same blocks always look the same while the world extends in every direction.

## Run it

```bash
npm install
npm run dev
```

Open the local address Vite prints (usually http://localhost:5173).

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move / ride |
| Mouse | Look (click to lock the pointer, `Esc` to release) |
| `Shift` | Sprint |
| `Space` | Jump / wheelie |
| `F` | Summon the G4 Master and ride / get off |
| `E` | Rob a shop / mount the nearby scooter |
| `M` | Mute |

## On a phone

Open the page on a phone or tablet and the touch HUD appears automatically (you can also force it with `?touch=1`). Drag anywhere on the screen to look, use the left stick to move, and the right-hand buttons for run, rob/mount, jump/wheelie and ride/get off. Phones get a lighter render setting (one chunk of streaming, no shadows, lower pixel ratio) so it stays smooth.

## How the wanted system works

- Finish robbing a shop: **+1 star**
- Land a wheelie within 34 m in front of a cop: **+1 star**
- Stars decay after you stay out of sight for a while.
- If a cop reaches you while wanted, you are busted and pay a fine.

## Build

```bash
npm run build
npm run preview
```

The production build is written to `dist/`.

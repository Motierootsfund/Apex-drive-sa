# Apex Drive SA — 3D Driving & Parking Game

A browser-based 3D driving sandbox built with Three.js and Vite. It is designed to be extended: all 100 selectable vehicles are data entries in `src/cars.js`, while the vehicle bodies, environment, UI and driving loop are procedural code.

## Included

- 100 selectable vehicles, including Volkswagen Golf 8 GTI/R, Toyota Quantum 2019 and 2024, multiple 2019 Toyota models, a broad Suzuki line-up and other popular makes.
- Procedurally modelled 3D vehicles with paint, cabin glass, wheels/alloys, lights, trim and basic wheel animation.
- Parking/training environment with marked bays, buildings, trees, street lamps, cones, road markings and static display cars.
- Free-drive mode and a parking precision challenge with bay alignment/stop checks.
- Third-person chase camera, bonnet camera and high camera.
- Speed, gear, engine RPM, steering, session time and parking-score HUD.
- Keyboard and touch controls; responsive layout for desktop and mobile browsers.
- No paid assets or external 3D model downloads required.

## Run locally

Install Node.js 18+ (Node 20+ recommended), then from this folder:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. For a production test:

```bash
npm run build
npm run preview
```

## Controls

| Action | Keyboard |
|---|---|
| Accelerate | `W` or `↑` |
| Brake / reverse | `S` or `↓` |
| Steer | `A` / `D` or `←` / `→` |
| Handbrake | `Space` |
| Change camera | `C` |
| Reset to start line | `R` |
| Pause / resume | `P` |

Mobile users have on-screen steering, accelerator and brake controls.

## Add more cars

Append an item to `CAR_CATALOG` in `src/cars.js`. Each car has this shape:

```js
{
  make: 'Toyota',
  model: 'Example Model',
  year: 2026,
  type: 'suv', // hatch, sedan, suv, van, pickup, coupe
  paint: '#285a83',
  drivetrain: 'AWD',
  power: 150,
  topSpeed: 200,
  zeroTo100: '8.0'
}
```

The car body is generated from the `type` dimensions in `src/main.js`, so a newly added data entry appears in the garage automatically. This version uses procedural, model-category silhouettes rather than manufacturer CAD assets; the names/spec values are illustrative game data, and the simplified physics are intended for gameplay rather than driving instruction.

## Publish on GitHub and Vercel

1. Create a new GitHub repository.
2. Upload the **contents** of this folder (including `package.json`, `index.html`, `src/`, `vite.config.js`, and `vercel.json`) to the repository root. Do not upload `node_modules/` or `dist/`.
3. In Vercel, choose **Add New → Project**, import that GitHub repository and deploy.
4. Vercel should detect Vite. The build command is `npm run build` and the output directory is `dist`; both are also defined in `vercel.json`.
5. Each push to the connected branch will trigger a new deployment.

## Visual/brand note

This is an original prototype name and procedural game scene. Vehicle manufacturer and model names are used as labels in the garage; no official brand logos or manufacturer-provided 3D models are included.

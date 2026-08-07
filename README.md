# Velocity — Setup & Deploy

## 1. Open in VS Code
Unzip/copy this `velocity` folder somewhere on your machine, then open it in
VS Code (`File → Open Folder`). `CLAUDE.md` will give any AI coding assistant
in VS Code full context on the project automatically.

## 2. Create the GitHub repo
1. Go to https://github.com/new
2. Name it (e.g. `velocity-dashboard`), keep it **Public** (required for free
   GitHub Pages on a personal account), don't initialize with a README (you
   already have one).
3. Click **Create repository**.

## 3. Push your code
In the `velocity` folder, open a terminal in VS Code and run:
```bash
git init
git add .
git commit -m "Initial Velocity dashboard"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/velocity-dashboard.git
git push -u origin main
```

## 4. Enable GitHub Pages
1. On GitHub, go to your repo → **Settings → Pages**
2. Under "Build and deployment", set **Source** to `Deploy from a branch`
3. Set branch to `main`, folder to `/ (root)`, click **Save**
4. Wait ~1 minute — your site will be live at:
   `https://YOUR-USERNAME.github.io/velocity-dashboard/`

## 5. Updating club data later
Go to `clubs.json` in your repo on GitHub, click the pencil (edit) icon,
make your change, commit directly to `main`. The live site rebuilds
automatically within about a minute — no need to touch VS Code for a quick
data update.

## Notes
- Location permission for "Run Now" only works over **https** (which GitHub
  Pages provides) — it won't prompt for location if you just open
  `index.html` locally via `file://`. To test locally with location working,
  run a local server instead, e.g. `python3 -m http.server` then visit
  `http://localhost:8000`.
- If a friend denies location permission, Run Now still works — it just
  sorts by soonest time instead of distance.

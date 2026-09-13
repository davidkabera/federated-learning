# Federated Learning Lab Docs

Astro + Starlight documentation for **Distributed Federated Learning on Talos Linux**.

Source notes in this directory (`infra_doc.md`, `ml_doc.md`, `cnn_vs_fl.md`) are published as:

| Page | Source |
|------|--------|
| [Part 1 — Infrastructure](src/content/docs/infrastructure.md) | `infra_doc.md` |
| [Part 2 — FL Pipeline](src/content/docs/fl-pipeline.md) | `ml_doc.md` |
| [Architecture](src/content/docs/architecture/index.mdx) | LikeC4 model in `src/likec4/fl-lab.c4` |
| [CNN vs Federated Learning](src/content/docs/cnn-vs-fl.md) | `cnn_vs_fl.md` |

## Commands

This project needs **Node.js 22+**. With nvm: `nvm use`.

| Command | Action |
| :------ | :----- |
| `npm install` | Install dependencies |
| `npm run dev` | Dev server at `http://localhost:4321/federated-learning/` |
| `npm run build` | Production build to `./dist/` |
| `npm run build:pages` | Install deps if needed, then build for GitHub Pages |
| `npm run preview` | Preview the production build |

## GitHub Pages

The site publishes to **https://davidkabera.github.io/federated-learning/**.

Pushes to `main` run `.github/workflows/deploy.yml`, which calls `scripts/build-github-pages.sh` and deploys `dist/`.

In the GitHub repo: **Settings → Pages → Source → GitHub Actions**.

Local Pages-style build:

```bash
chmod +x scripts/build-github-pages.sh
npm run build:pages
```

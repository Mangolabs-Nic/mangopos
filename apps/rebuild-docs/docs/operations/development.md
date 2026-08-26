---
sidebar_position: 1
---

# Development setup

## Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| Node.js | ≥ 20 | Runtime |
| npm | ≥ 10 | Package manager |
| Git | Latest | Version control |
| Supabase CLI | Latest | Local database (optional) |

## Quick start

```bash
# Clone the repository
git clone https://github.com/Mangolabs-Nic/pooppos.git
cd pooppos

# Install dependencies (including Turborepo)
npm install

# Start the documentation dev server
npm run docs:start
```

## Project structure

```
pooppos/
├── apps/
│   └── rebuild-docs/          # Docusaurus documentation
│       ├── docs/               # Markdown documentation
│       ├── src/                # React components
│       ├── static/             # Static assets
│       └── docusaurus.config.mjs
├── turbo.json                  # Turborepo configuration
├── package.json                # Root workspace config
└── .github/workflows/docs.yml  # CI/CD pipeline
```

## Available commands

| Command | Description |
| --- | --- |
| `npm run docs:start` | Start documentation dev server |
| `npm run docs:build` | Build documentation for production |
| `npm run turbo:graph` | Visualize task dependency graph |

## POS application setup

:::info
The POS application source code is in a separate repository. This repository contains only the documentation and landing page. The POS application setup will be documented once the codebase is audited and integrated.
:::

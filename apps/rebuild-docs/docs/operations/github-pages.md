---
sidebar_position: 1
---

# GitHub Pages deployment

This documentation will be deployed from the same repository as the existing PoopPOS landing page. It must not replace that landing page.

## Current repository boundary

The repository root preserves the static marketing site and now defines one Node workspace for documentation. It is still not the desktop POS source. The Docusaurus application lives below `apps/rebuild-docs/` and the Pages workflow lives at `.github/workflows/docs.yml`.

## Target URLs

| URL | Content |
| --- | --- |
| `https://mangolabs-nic.github.io/pooppos/` | Existing landing page from the repository root. |
| `https://mangolabs-nic.github.io/pooppos/docs/` | Docusaurus rebuild documentation. |

The repository remote is `Mangolabs-Nic/pooppos`; these URLs assume standard project Pages. Update the site URL and base path if the repository uses a custom domain or a different Pages location.

## Publishing contract

The deployment workflow must build Docusaurus, then publish one Pages artifact with this shape:

```text
artifact/
├── index.html              # existing landing page
├── images/                 # existing landing assets
├── icon.svg
├── version.json
├── devmessage.json
└── docs/                   # Docusaurus build output
```

The Docusaurus configuration must use the `/pooppos/docs/` base path. Publishing the Docusaurus build by itself at the Pages root would overwrite the landing page.

## Release checklist

1. Configure the GitHub repository's Pages source as **GitHub Actions**.
2. Run the documentation build in CI.
3. Upload the combined artifact, not only the Docusaurus output.
4. Verify both the landing page and `/docs/` after deployment.
5. Check a deep documentation URL after a refresh.

The tracked workflow implements this contract. GitHub still requires the repository Pages source to be set to **GitHub Actions** before the first deployment.

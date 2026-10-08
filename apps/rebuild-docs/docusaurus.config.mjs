import {themes as prismThemes} from 'prism-react-renderer';

const organizationName = process.env.ORGANIZATION_NAME ?? 'Mangolabs-Nic';
const projectName = process.env.PROJECT_NAME ?? 'mangopos';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'MangoPOS',
  tagline: 'A safe path from PoopPOS to a pilot-ready commercial POS.',
  favicon: 'img/mango-02.png',
  url: `https://${organizationName}.github.io`,
  baseUrl: `/${projectName}/docs/`,
  organizationName,
  projectName,
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.mjs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      },
    ],
  ],
  themeConfig: {
    image: 'img/mango-02.png',
    navbar: {
      title: 'MangoLabs POS',
      logo: {
        alt: 'MangoLabs POS',
        src: 'img/mango-02.png',
      },
      items: [
        {type: 'docSidebar', sidebarId: 'rebuildSidebar', position: 'left', label: 'Rebuild guide'},
        {
          href: 'https://github.com/Mangolabs-Nic/mangopos',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Rebuild',
          items: [
            {label: 'Roadmap', to: '/rebuild/roadmap'},
            {label: 'Decisions', to: '/rebuild/decisions'},
            {label: 'Pilot cutover', to: '/rebuild/pilot-cutover'},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'GitHub', href: 'https://github.com/Mangolabs-Nic/mangopos'},
            {label: 'GitHub Pages', to: '/operations/github-pages'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} MangoLabs.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  },
};

export default config;

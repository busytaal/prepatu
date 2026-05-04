import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Prepatu',
  tagline: 'Build reliable voice agents with YAML',
  favicon: 'img/prepatu_logo.svg',

  future: {
    v4: true,
  },

  url: 'https://docs.prepatu.com',
  baseUrl: '/',

  organizationName: 'busytaal',
  projectName: 'prepatu',

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
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/busytaal/prepatu/edit/main/docs/prepatu/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/prepatu-social.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: '',
      logo: {
        alt: 'Prepatu Logo',
        src: 'img/prepatu_logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://prepatu.com/ui',
          label: 'Dashboard',
          position: 'right',
        },
        {
          href: 'https://github.com/busytaal/prepatu',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Learn',
          items: [
            {label: 'Introduction', to: '/docs/'},
            {label: 'Cloud Quickstart', to: '/docs/getting-started/cloud-quickstart'},
            {label: 'Writing Flows', to: '/docs/flows/first-flow'},
          ],
        },
        {
          title: 'Examples',
          items: [
            {label: '10 Questions Game', to: '/docs/examples/ten-questions'},
            {label: 'Booking Wizard', to: '/docs/examples/booking-wizard'},
            {label: 'IELTS Coach', to: '/docs/examples/ielts-coach'},
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/busytaal/prepatu',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Busytaal. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['python', 'yaml', 'bash', 'typescript', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

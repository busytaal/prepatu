import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  conceptsSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: 'Introduction',
    },
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/quickstart',
        'getting-started/project-structure',
      ],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/architecture',
        'concepts/flow-yaml',
        'concepts/state-machine',
        'concepts/artifacts',
        'concepts/providers',
      ],
    },
    {
      type: 'category',
      label: 'Backend (VFDL)',
      items: [
        'backend/pipeline',
        'backend/flow-engine',
        'backend/wire-protocol',
        'backend/api-reference',
        'backend/env-reference',
      ],
    },
    {
      type: 'category',
      label: 'Browser SDK',
      items: [
        'sdk/browser',
        'sdk/voice-agent',
        'sdk/transports',
        'sdk/transport-switcher',
        'sdk/qos',
      ],
    },
    {
      type: 'category',
      label: 'Deployment',
      items: [
        'deployment/self-hosted',
        'deployment/env-variables',
      ],
    },
  ],

  tutorialSidebar: [
    {
      type: 'category',
      label: 'Tutorial — Build a Voice App',
      collapsible: false,
      items: [
        'tutorial/intro',
        'tutorial/01-project-setup',
        'tutorial/02-backend',
        'tutorial/03-first-flow',
        'tutorial/04-connect-frontend',
        'tutorial/05-scoring',
        'tutorial/06-going-further',
      ],
    },
  ],
};

export default sidebars;

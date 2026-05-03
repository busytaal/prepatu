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
        'getting-started/cloud-quickstart',
        'getting-started/self-hosted-quickstart',
      ],
    },
    {
      type: 'category',
      label: 'Writing Flows',
      items: [
        'flows/first-flow',
        'flows/yaml-reference',
        'flows/state-machine',
        'flows/confirmation-gates',
        'flows/artifacts',
        'flows/variables',
      ],
    },
    {
      type: 'category',
      label: 'Frontend SDK',
      items: [
        'sdk/connecting',
        'sdk/handling-artifacts',
        'sdk/sending-events',
        'sdk/voice-agent-reference',
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      items: [
        'examples/ten-questions',
        'examples/booking-wizard',
        'examples/ielts-coach',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: true,
      items: [
        'reference/architecture',
        'reference/cloud-api',
        'reference/self-hosted-api',
        'reference/wire-protocol',
        'reference/transports',
        'reference/qos',
        'reference/pipeline',
        'reference/flow-engine',
        'reference/providers',
        'reference/env-variables',
        'reference/deployment',
      ],
    },
  ],
};

export default sidebars;

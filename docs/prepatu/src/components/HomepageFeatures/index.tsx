import type {ReactNode} from 'react';
import styles from './styles.module.css';

type FeatureItem = {
  tag: string;
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    tag: 'Engine',
    title: 'Declarative Flow YAML',
    description:
      'Define voice conversations as state machines in YAML — states, transitions, guards, and tool calls. No custom orchestration code.',
  },
  {
    tag: 'Runtime',
    title: 'Pipecat Pipeline',
    description:
      'Real-time voice pipeline with VAD, STT, LLM, and TTS wired together. Swap providers without changing your flows.',
  },
  {
    tag: 'SDK',
    title: 'Browser & Mobile',
    description:
      'WebSocket and WebRTC transports with automatic QoS monitoring and seamless transport switching built into the client SDK.',
  },
];

function Feature({tag, title, description}: FeatureItem) {
  return (
    <div className={styles.featureCard}>
      <span className={styles.tag}>{tag}</span>
      <h3 className={styles.featureTitle}>{title}</h3>
      <p className={styles.featureDesc}>{description}</p>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.featureGrid}>
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

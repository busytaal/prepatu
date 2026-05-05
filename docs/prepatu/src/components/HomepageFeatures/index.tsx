import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import clsx from 'clsx';
import styles from './styles.module.css';

const FLOW_YAML = `states:
  greet:
    say: "Hi! What can I help you with?"
    listen: true
    transitions:
      - match: "book"
        goto: booking
      - goto: fallback

  booking:
    say: "Sure, what date works for you?"
    listen: true
    transitions:
      - goto: confirm

  confirm:
    say: "Got it — I'll book that for you."
    goto: end`;

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <p className={styles.tagline}>
          Describe your voice conversation in YAML. Prepatu handles the rest.
        </p>
        <div className={styles.codeBlock}>
          <pre><code>{FLOW_YAML}</code></pre>
        </div>
        <div className={styles.ctas}>
          <Link className={clsx('button button--primary button--lg')} to="/docs/flows/first-flow">
            Start Building
          </Link>
          <Link className={clsx('button button--secondary button--lg')} to="/docs/">
            Read the Docs
          </Link>
        </div>
      </div>
    </section>
  );
}

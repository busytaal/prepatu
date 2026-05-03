import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import styles from './index.module.css';

function HomepageHeader() {
  const logoUrl = useBaseUrl('/img/prepatu_logo.svg');
  return (
    <header className={styles.heroBanner}>
      <div className={styles.heroInner}>
        <img src={logoUrl} alt="Prepatu" className={styles.logo} />

        <div className={styles.entry}>
          <span className={styles.wordmark}>prēpatu</span>
          <span className={styles.pronunciation}>/pray-pa-too/</span>
          <span className={styles.pos}>n. adj.</span>
        </div>

        <p className={styles.definition}>
          Sounds French. Has no meaning.
        </p>

        <div className={styles.buttons}>
          <Link className={clsx('button button--lg', styles.btnPrimary)} to="/docs/">
            Get Started
          </Link>
          <Link className={clsx('button button--lg', styles.btnSecondary)} href="https://github.com/busytaal/prepatu">
            GitHub
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}

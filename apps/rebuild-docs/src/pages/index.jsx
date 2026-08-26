import Link from '@docusaurus/Link';
import styles from './index.module.css';

const highlights = [
  ['01', 'Protect the sale', 'Keep confirmed sales auditable and recoverable throughout the migration.'],
  ['02', 'Prove the path', 'Audit, rehearse, reconcile, then cut over one pilot business.'],
  ['03', 'Scale on evidence', 'Add complex capabilities only after the first pilot is stable.'],
];

export default function Home() {
  return (
    <main>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>MangoLabs / Nicaragua / 2026</p>
        <h1>Rebuild the POS<br /><em>without losing the business.</em></h1>
        <p className={styles.summary}>
          The operating guide for moving PoopPOS into a pilot-ready commercial product: secure, lightweight, and built for local businesses.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} to="/intro">Read the guide</Link>
          <Link className={styles.secondaryAction} to="/rebuild/roadmap">View roadmap</Link>
        </div>
      </section>
      <section className={styles.highlights} aria-label="Rebuild principles">
        {highlights.map(([number, title, description]) => (
          <article className={styles.highlight} key={number}>
            <span>{number}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

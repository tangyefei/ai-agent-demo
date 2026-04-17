import Link from 'next/link';
import styles from '../analyze-review/layout.module.css';
import ModelSelector from '@/components/ModelSelector';

export default function MultipleFunctionCallLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <nav className={styles.nav}>
        <Link href="/" className={styles.backLink}>
          ← 返回首页
        </Link>
        <div className={styles.selectorWrapper}>
          <ModelSelector />
        </div>
      </nav>
      {children}
    </div>
  );
}

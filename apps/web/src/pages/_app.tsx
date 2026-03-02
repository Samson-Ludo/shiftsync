import type { AppProps } from 'next/app';
import { Space_Grotesk, Sora } from 'next/font/google';
import '@/styles/globals.css';

const headingFont = Space_Grotesk({ subsets: ['latin'], variable: '--font-heading' });
const bodyFont = Sora({ subsets: ['latin'], variable: '--font-body' });

export default function ShiftSyncApp({ Component, pageProps }: AppProps) {
  return (
    <div className={`${headingFont.variable} ${bodyFont.variable} font-[family-name:var(--font-body)]`}>
      <Component {...pageProps} />
    </div>
  );
}

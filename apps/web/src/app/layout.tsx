import type { Metadata } from 'next';
import { Space_Grotesk, Sora } from 'next/font/google';
import '@/styles/globals.css';

const headingFont = Space_Grotesk({ subsets: ['latin'], variable: '--font-heading' });
const bodyFont = Sora({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'ShiftSync',
  description: 'Coastal Eats staff scheduling MVP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${headingFont.variable} ${bodyFont.variable}`}>
      <body suppressHydrationWarning className="font-[var(--font-body)]">
        {children}
      </body>
    </html>
  );
}

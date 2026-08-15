import type { Metadata } from 'next';
import './globals.css';

// No webfont on purpose. The system stack is the deliberate placeholder until a
// designer picks type — see the UI base section of the design doc. The scaffold
// loaded Geist here but never applied it to anything, so it was a build-time
// dependency on Google Fonts that bought nothing and could fail a CI build.

export const metadata: Metadata = {
  title: 'Sailbot Hiring Portal',
  description: 'Applications and hiring for the UBC Sailbot student design team.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";


import "./globals.css";

import RootProvider from "@/components/root-provider";
import { FirebaseClientProvider } from "@/firebase";
import { FirebaseErrorListener } from "@/components/FirebaseErrorListener";
import { siteConfig } from "@/lib/site";

import { Inter, Lexend } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const lexend = Lexend({ subsets: ["latin"], variable: "--font-headline", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,

  // Private by default; see NEXT_PUBLIC_ALLOW_INDEXING in lib/site.ts.
  robots: siteConfig.allowIndexing
    ? { index: true, follow: true }
    : { index: false, follow: false },

  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
    url: "/",
  },
  twitter: {
    card: "summary",
    title: siteConfig.name,
    description: siteConfig.description,
  },

  // Stop iOS Safari from turning lab values such as "250000" into phone-number links.
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#161618" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
     
      <body className={`${inter.variable} ${lexend.variable} min-h-screen bg-background font-body text-foreground antialiased`}>
        {/* Keyboard users can jump past the header. Each page's <main> needs id="main-content". */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>

        <FirebaseClientProvider>
          <FirebaseErrorListener />
          <RootProvider>{children}</RootProvider>
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
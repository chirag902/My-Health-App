import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

import RootProvider from "@/components/root-provider";
import { FirebaseClientProvider } from "@/firebase";
import { FirebaseErrorListener } from "@/components/FirebaseErrorListener";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MyHealthApp",
    template: "%s | MyHealthApp",
  },
  description:
    "MyHealthApp helps you track your health, journal, analyze health documents, and maintain healthy habits.",
  applicationName: "MyHealthApp",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-body antialiased`}>
        <FirebaseClientProvider>
          <FirebaseErrorListener />
          <RootProvider>{children}</RootProvider>
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
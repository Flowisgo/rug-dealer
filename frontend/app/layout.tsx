import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { Footer, Header } from "@/components/shell";
import { WalletProvider } from "@/components/wallet";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin", "latin-ext"], weight: ["400", "500"], variable: "--font-fraunces", display: "swap" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin", "latin-ext"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "RugDealer", template: "%s | RugDealer" },
  description: "Weavers borrow against a finished rug held at a store. A Stellar Testnet prototype.",
};

export const viewport: Viewport = { themeColor: "#F4EDE2", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <WalletProvider>
          <Suspense>
            <Header />
          </Suspense>
          <main>
            <Suspense>{children}</Suspense>
          </main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}

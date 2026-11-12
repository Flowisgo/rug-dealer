import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { Footer, Header } from "@/components/shell";
import { WalletProvider } from "@/components/wallet";
import "./globals.css";

const sans = Schibsted_Grotesk({ subsets: ["latin", "latin-ext"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "RugDealer", template: "%s | RugDealer" },
  description: "Weavers borrow against a finished rug held at a store. A Stellar Testnet prototype.",
};

export const viewport: Viewport = { themeColor: "#E7E4DC", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
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

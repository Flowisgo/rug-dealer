import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = {
  title: "Warehouse rug · Rug Dealer",
  description:
    "Review a weaver-approved rug sale and settle securely on Stellar testnet.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

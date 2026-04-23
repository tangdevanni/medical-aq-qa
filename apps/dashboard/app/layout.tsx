import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Medical AI QA Control Plane",
  description: "Demo-ready dashboard for Finale workbook ingestion, QA run orchestration, and live patient execution monitoring.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

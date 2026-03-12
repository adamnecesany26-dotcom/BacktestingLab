import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backtesting Platform",
  description: "Web-based trading strategy backtesting",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}

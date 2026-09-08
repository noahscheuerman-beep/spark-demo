import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spark | Your electric vehicle",
  description: "Manage your Spark vehicle, charging, orders, and support.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

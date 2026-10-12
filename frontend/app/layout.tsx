import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A World Every Day",
  description:
    "A living artwork that turns constructively significant stories into an explorable world.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


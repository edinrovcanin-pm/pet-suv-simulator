import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PET/CT SUV Uptake Simulator",
  description:
    "Simulacija F-18 FDG PET/CT snimaka i SUV vrijednosti pri različitim vremenima uptake-a. Procjena optimalnog vremena za kvalitet slike i kvantifikaciju SUV-a.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="bs" className="h-full antialiased">
      <body className="min-h-full bg-slate-950 text-slate-200">{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { importMap } from "./site-content";

export const metadata: Metadata = {
  title: "Agência Eleven — Estratégia, Posicionamento e Crescimento",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <script type="importmap" dangerouslySetInnerHTML={{ __html: importMap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

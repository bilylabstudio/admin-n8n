import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Soporte V-Gummies',
  robots: { index: false, follow: false },
  icons: {
    icon: 'https://v-gummies.com/cdn/shop/files/Diseno_sin_titulo_4.png?crop=center&height=32&v=1737457086&width=32'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>{children}</body>
    </html>
  );
}

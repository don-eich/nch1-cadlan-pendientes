import "./globals.css";

export const metadata = {
  title: "NCH1 · Cadlan — pendientes BMS",
  description: "Seguimiento de pendientes internos y externos del proyecto NCH1 / Cadlan.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

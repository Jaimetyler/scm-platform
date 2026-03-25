import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCM Platform",
  description: "SCM internal operations platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background:
  "radial-gradient(circle at top, rgba(59,130,246,0.14) 0%, rgba(15,23,42,1) 24%), linear-gradient(180deg, #050816 0%, #020617 100%)",}}
      >
        <div
          style={{
            minHeight: "100vh",
            padding: "28px 20px 44px",
          }}
        >
          {children}
        </div>
      </body>
    </html>
  );
}
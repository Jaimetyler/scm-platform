import "./globals.css";

export const metadata = {
  title: "SCM Platform",
  description: "SCM internal dashboards",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
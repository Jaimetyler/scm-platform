export const metadata = {
  title: "SCM Platform",
  description: "Internal financial and operations dashboards"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "Arial, sans-serif",
          background: "#f5f7fb",
          color: "#111"
        }}
      >
        {children}
      </body>
    </html>
  );
}
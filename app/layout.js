import './globals.css';

export const metadata = {
  title: 'ASO Analyzer',
  description: 'App Store Optimization analysis tool — find keyword gaps vs competitors.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 min-h-screen antialiased">
        <header className="border-b border-gray-200 bg-white">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-2">
            <span className="text-2xl">🔍</span>
            <span className="font-semibold text-lg tracking-tight">ASO Analyzer</span>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-10">
          {children}
        </main>
      </body>
    </html>
  );
}

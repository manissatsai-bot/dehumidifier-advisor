import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '除濕機購買顧問',
  description: 'AI 幫你分析該不該買、哪台最適合',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  )
}

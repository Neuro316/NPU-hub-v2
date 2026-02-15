import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Policies | Neuro Progeny',
  description: 'Privacy Policy, Terms & Conditions, and SMS Terms for Neuro Progeny assessments, programs, and communications.',
  robots: {
    index: false,
    follow: false,
  },
}

export default function PoliciesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap"
        rel="stylesheet"
      />
      {children}
    </>
  )
}

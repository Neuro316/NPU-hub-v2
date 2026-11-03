'use client'

// Contact card › Booking answers: University bookings synced to this contact by the
// booking sync (Build 1), each with its time, type, reference and every question as
// worded when it was answered. Shows nothing when the contact has no synced booking.
import { useEffect, useState } from 'react'
import { CalendarCheck } from 'lucide-react'

interface Answer { key: string; label: string; answer: string }
interface Booking {
  booking_id: string
  appointment_type: string
  starts_at: string
  status: string
  answers: Answer[]
}

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function BookingAnswers({ contactId }: { contactId: string }) {
  const [bookings, setBookings] = useState<Booking[]>([])

  useEffect(() => {
    let live = true
    setBookings([])
    fetch(`/api/bookings/contact?contact_id=${encodeURIComponent(contactId)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { bookings: [] }))
      .then(d => { if (live) setBookings(d.bookings ?? []) })
      .catch(() => {})
    return () => { live = false }
  }, [contactId])

  if (!bookings.length) return null
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
        <CalendarCheck className="w-3 h-3" /> Booking answers
      </h4>
      {bookings.map(b => (
        <div key={b.booking_id} className="p-2.5 rounded-lg border border-gray-100 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-np-dark">{b.appointment_type}</p>
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${b.status === 'cancelled' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
              {b.status}
            </span>
          </div>
          <p className={`text-[10px] text-gray-500 ${b.status === 'cancelled' ? 'line-through' : ''}`}>{fmt(b.starts_at)}</p>
          <p className="text-[9px] text-gray-400">Ref {b.booking_id.slice(0, 8).toUpperCase()}</p>
          {b.answers.length > 0 && (
            <dl className="space-y-1 pt-1 border-t border-gray-50">
              {b.answers.map(a => (
                <div key={a.key}>
                  <dt className="text-[10px] text-gray-400">{a.label}</dt>
                  <dd className="text-[11px] text-np-dark whitespace-pre-wrap">{a.answer || <span className="text-gray-300">Not answered</span>}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  )
}

'use client'

import { PhoneCall, PhoneOff, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useVoiceReceiver } from '@/lib/voice-receiver-context'

// "Enable browser calling" — the one-time opt-in that pre-warms the mic
// permission and registers this browser to receive inbound calls. Also the
// user gesture that unblocks autoplay so the ringtone is audible.

export default function BrowserCallingToggle() {
  const { status, error, identity, enable, disable } = useVoiceReceiver()

  const busy = status === 'starting'

  return (
    <div className="border-t border-gray-100 pt-4">
      <h4 className="text-xs font-semibold text-np-dark mb-1">Browser Calling (Incoming)</h4>
      <p className="text-[10px] text-gray-400 mb-3">
        Ring this browser when someone calls your number, and answer in the Hub. If no browser is
        open, callers hear your voicemail greeting instead. Enable once per browser — we ask for the
        microphone up front so answering is instant.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {status === 'ready' && (
          <>
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50 border border-green-200 text-[10px] font-medium text-green-700">
              <CheckCircle2 size={12} /> Ready — calls will ring here
            </span>
            <button
              onClick={disable}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-np-dark text-xs font-medium rounded-lg hover:bg-gray-50"
            >
              <PhoneOff size={12} /> Turn off
            </button>
          </>
        )}

        {(status === 'off' || status === 'error') && (
          <button
            onClick={enable}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40"
          >
            <PhoneCall size={12} /> Enable browser calling
          </button>
        )}

        {busy && (
          <span className="flex items-center gap-1 text-[10px] text-gray-400">
            <Loader2 size={11} className="animate-spin" /> Connecting…
          </span>
        )}

        {status === 'follower' && (
          <span className="text-[10px] text-gray-500">
            Another Hub tab in this browser is handling calls — they&rsquo;ll ring there.
          </span>
        )}

        {status === 'unsupported' && (
          <span className="text-[10px] text-gray-500">
            This browser can&rsquo;t receive calls. Use Chrome or Edge on a desktop.
          </span>
        )}
      </div>

      {/* Never fail silently: if the token refresh 401s or the device errors,
          the user must know calls are going straight to voicemail. */}
      {status === 'error' && error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
          <AlertTriangle size={12} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-[10px] font-semibold text-red-700">Not receiving calls</p>
            <p className="text-[10px] text-red-700">{error}</p>
          </div>
        </div>
      )}

      {identity && (
        <p className="text-[9px] text-gray-400 mt-2 font-mono">Client identity: {identity}</p>
      )}
    </div>
  )
}

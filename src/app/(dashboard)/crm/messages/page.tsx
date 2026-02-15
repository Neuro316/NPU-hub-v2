'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Messages — SMS inbox, conversation view, smart replies
// Route: /crm/messages
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useRef } from 'react'
import {
  Search, Send, Clock, Sparkles, X, Paperclip,
  MessageCircle, Archive, BellOff
} from 'lucide-react'
import { fetchConversations, fetchMessages, sendMessage } from '@/lib/crm-client'
import type { Conversation, Message, CrmContact } from '@/types/crm'

function ConversationItem({ conv, isActive, onClick }: {
  conv: Conversation & { contacts: CrmContact }; isActive: boolean; onClick: () => void
}) {
  const c = conv.contacts
  const initials = `${c.first_name?.[0] || ''}${c.last_name?.[0] || ''}`.toUpperCase()
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg transition-all ${
        isActive ? 'bg-np-blue/8 border border-np-blue/20' : 'hover:bg-gray-50/50 border border-transparent'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal/70 to-np-dark/70 flex items-center justify-center text-[10px] font-bold text-white">
            {initials}
          </div>
          {conv.unread_count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-orange-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
              {conv.unread_count > 9 ? '9+' : conv.unread_count}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className={`text-xs truncate ${conv.unread_count > 0 ? 'font-bold text-np-dark' : 'font-medium text-gray-600'}`}>
              {c.first_name} {c.last_name}
            </p>
            <span className="text-[9px] text-gray-400 flex-shrink-0">
              {conv.last_message_at ? new Date(conv.last_message_at).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
            </span>
          </div>
          <p className="text-[10px] text-gray-400 truncate">{c.phone || c.email}</p>
        </div>
      </div>
    </button>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isOut = msg.direction === 'outbound'
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-2`}>
      <div className={`max-w-[75%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
        isOut
          ? 'bg-np-blue text-white rounded-br-sm'
          : 'bg-white border border-gray-100 text-np-dark rounded-bl-sm'
      }`}>
        <p>{msg.body}</p>
        <div className={`flex items-center gap-1 mt-1 ${isOut ? 'justify-end' : ''}`}>
          <span className={`text-[9px] ${isOut ? 'text-white/60' : 'text-gray-400'}`}>
            {msg.sent_at ? new Date(msg.sent_at).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
          </span>
          {isOut && (
            <span className={`text-[8px] ${msg.status === 'delivered' ? 'text-white/80' : 'text-white/40'}`}>
              {msg.status === 'delivered' ? '✓✓' : msg.status === 'sent' ? '✓' : '⏳'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MessagesPage() {
  const [conversations, setConversations] = useState<(Conversation & { contacts: CrmContact })[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [activeConv, setActiveConv] = useState<(Conversation & { contacts: CrmContact }) | null>(null)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [channelFilter, setChannelFilter] = useState<string>('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchConversations(channelFilter || undefined)
      .then(setConversations)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [channelFilter])

  useEffect(() => {
    if (!activeConv) return
    fetchMessages(activeConv.id).then(msgs => {
      setMessages(msgs)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }).catch(console.error)
  }, [activeConv])

  const handleSend = async () => {
    if (!draft.trim() || !activeConv || sending) return
    setSending(true)
    try {
      const msg = await sendMessage(activeConv.id, draft, 'current-user-id')
      setMessages(prev => [...prev, msg])
      setDraft('')
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (e) {
      console.error('Send failed:', e)
    } finally {
      setSending(false)
    }
  }

  const filtered = conversations.filter(c => {
    if (!search) return true
    const name = `${c.contacts.first_name} ${c.contacts.last_name} ${c.contacts.phone || ''} ${c.contacts.email || ''}`.toLowerCase()
    return name.includes(search.toLowerCase())
  })

  return (
    <div className="flex gap-0 h-[calc(100vh-200px)] animate-in fade-in duration-300 rounded-xl border border-gray-100 bg-white overflow-hidden">
      {/* Conversation List */}
      <div className="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col bg-white">
        <div className="p-3 border-b border-gray-100">
          <div className="relative mb-2">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-8 pr-3 py-2 text-xs bg-gray-50 border border-gray-100/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30"
            />
          </div>
          <div className="flex gap-1">
            {['', 'sms', 'email', 'voice'].map(ch => (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all ${
                  channelFilter === ch ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400 hover:text-gray-600'
                }`}
              >
                {ch || 'All'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-0.5">
          {loading && <p className="text-xs text-gray-400 text-center py-8">Loading...</p>}
          {filtered.map(c => (
            <ConversationItem key={c.id} conv={c} isActive={activeConv?.id === c.id} onClick={() => setActiveConv(c)} />
          ))}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-8">
              <MessageCircle size={24} className="mx-auto text-gray-400/30 mb-2" />
              <p className="text-xs text-gray-400">No conversations</p>
            </div>
          )}
        </div>
      </div>

      {/* Message Thread */}
      {activeConv ? (
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-np-dark">
                {activeConv.contacts.first_name} {activeConv.contacts.last_name}
              </p>
              <p className="text-[10px] text-gray-400">{activeConv.contacts.phone || activeConv.contacts.email} · {activeConv.channel}</p>
            </div>
            <div className="flex gap-1">
              <button className="p-1.5 rounded-lg hover:bg-gray-50 transition-colors" title="Snooze">
                <BellOff size={14} className="text-gray-400" />
              </button>
              <button className="p-1.5 rounded-lg hover:bg-gray-50 transition-colors" title="Archive">
                <Archive size={14} className="text-gray-400" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-auto p-4 bg-gray-50/30">
            {messages.map(m => <MessageBubble key={m.id} msg={m} />)}
            <div ref={bottomRef} />
          </div>

          {/* Compose */}
          <div className="p-3 border-t border-gray-100 bg-white">
            {/* Smart Reply Chips */}
            <div className="flex gap-1.5 mb-2">
              {['Thanks for reaching out!', 'Let me check on that', 'Would you like to schedule a call?'].map(reply => (
                <button
                  key={reply}
                  onClick={() => setDraft(reply)}
                  className="px-2 py-1 text-[9px] font-medium bg-np-blue/5 text-np-blue border border-np-blue/15 rounded-full hover:bg-np-blue/10 transition-colors flex items-center gap-0.5"
                >
                  <Sparkles size={8} /> {reply}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2.5 text-xs bg-gray-50 border border-gray-100/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30"
              />
              <button className="p-2.5 rounded-lg bg-gray-50 hover:bg-gray-50/80 transition-colors" title="Schedule">
                <Clock size={14} className="text-gray-400" />
              </button>
              <button
                onClick={handleSend}
                disabled={!draft.trim() || sending}
                className="px-4 py-2.5 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors flex items-center gap-1"
              >
                <Send size={12} /> Send
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <MessageCircle size={32} className="mx-auto text-gray-400/30 mb-3" />
            <p className="text-sm text-gray-400">Select a conversation</p>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState, useRef } from 'react'
import {
  Search, Send, Clock, Sparkles, X, Plus,
  MessageCircle, Archive, BellOff, Users
} from 'lucide-react'
import { fetchConversations, fetchMessages, sendMessage, fetchContacts, createConversation } from '@/lib/crm-client'
import type { Conversation, Message, CrmContact } from '@/types/crm'
import { useWorkspace } from '@/lib/workspace-context'

function ConversationItem({ conv, isActive, onClick }: {
  conv: Conversation & { contacts: CrmContact }; isActive: boolean; onClick: () => void
}) {
  const c = conv.contacts
  const initials = `${c.first_name?.[0] || ''}${c.last_name?.[0] || ''}`.toUpperCase()
  return (
    <button onClick={onClick}
      className={`w-full text-left p-3 rounded-lg transition-all ${isActive ? 'bg-np-blue/8 border border-np-blue/20' : 'hover:bg-gray-50/50 border border-transparent'}`}>
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal/70 to-np-dark/70 flex items-center justify-center text-[10px] font-bold text-white">{initials}</div>
          {conv.unread_count > 0 && <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full text-[7px] font-bold text-white flex items-center justify-center">{conv.unread_count}</div>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-np-dark truncate">{c.first_name} {c.last_name}</p>
          <p className="text-[10px] text-gray-400 truncate">{c.phone || c.email}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[9px] text-gray-400">{conv.last_message_at ? new Date(conv.last_message_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : ''}</p>
          <div className="flex items-center gap-0.5 mt-0.5 justify-end">
            <span className={`text-[8px] px-1 py-0 rounded ${conv.channel==='sms' ? 'bg-green-50 text-green-600' : conv.channel==='email' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
              {conv.channel.toUpperCase()}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isOut = msg.direction === 'outbound'
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-2`}>
      <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-xs ${
        isOut ? 'bg-np-blue text-white rounded-br-md' : 'bg-gray-100 text-np-dark rounded-bl-md'
      }`}>
        <p className="whitespace-pre-wrap">{msg.body}</p>
        <div className={`flex items-center gap-1 mt-1 ${isOut ? 'justify-end' : ''}`}>
          <span className={`text-[9px] ${isOut ? 'text-white/60' : 'text-gray-400'}`}>
            {msg.sent_at ? new Date(msg.sent_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) : ''}
          </span>
          {isOut && <span className={`text-[8px] ${msg.status==='delivered' ? 'text-green-300' : msg.status==='failed' ? 'text-red-300' : 'text-white/40'}`}>
            {msg.status==='delivered' ? '✓✓' : msg.status==='sent' ? '✓' : msg.status==='failed' ? '✗' : '◷'}
          </span>}
        </div>
      </div>
    </div>
  )
}

export default function MessagesPage() {
  const { currentOrg, user } = useWorkspace()
  const [conversations, setConversations] = useState<(Conversation & { contacts: CrmContact })[]>([])
  const [activeConv, setActiveConv] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMsg, setNewMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [channelFilter, setChannelFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showNewConv, setShowNewConv] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<CrmContact[]>([])
  const [searchingContacts, setSearchingContacts] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load conversations
  useEffect(() => {
    fetchConversations(channelFilter || undefined)
      .then(setConversations).catch(console.error).finally(() => setLoading(false))
  }, [channelFilter])

  // Load messages when conversation changes
  useEffect(() => {
    if (activeConv) {
      fetchMessages(activeConv).then(m => { setMessages(m); setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior:'smooth' }),100) }).catch(console.error)
    }
  }, [activeConv])

  const handleSend = async () => {
    if (!newMsg.trim() || !activeConv || !user) return
    setSending(true)
    try {
      const msg = await sendMessage(activeConv, newMsg.trim(), user.id)
      setMessages(prev => [...prev, msg])
      setNewMsg('')
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      // Also trigger SMS send via API
      const conv = conversations.find(c => c.id === activeConv)
      if (conv?.channel === 'sms' && conv.contacts?.phone) {
        fetch('/api/sms/send', {
          method: 'POST', headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ to: conv.contacts.phone, body: newMsg.trim(), message_id: msg.id }),
        }).catch(console.error)
      }
    } catch (e) { console.error(e) }
    finally { setSending(false) }
  }

  // Contact search for new conversation
  const searchContacts = async (q: string) => {
    setContactSearch(q)
    if (q.length < 2) { setContactResults([]); return }
    setSearchingContacts(true)
    try {
      const res = await fetchContacts({ org_id: currentOrg?.id, q, limit: 10 })
      setContactResults(res.contacts)
    } catch (e) { console.error(e) }
    finally { setSearchingContacts(false) }
  }

  const startConversation = async (contact: CrmContact) => {
    if (!currentOrg) return
    try {
      const convId = await createConversation(contact.id, 'sms', currentOrg.id)
      setShowNewConv(false)
      setContactSearch('')
      setContactResults([])
      // Reload conversations and select the new one
      const convs = await fetchConversations()
      setConversations(convs)
      setActiveConv(convId)
    } catch (e) { console.error(e); alert('Failed to start conversation') }
  }

  const activeConvData = conversations.find(c => c.id === activeConv)

  const filteredConvs = conversations.filter(c => {
    if (search) {
      const name = `${c.contacts.first_name} ${c.contacts.last_name}`.toLowerCase()
      if (!name.includes(search.toLowerCase())) return false
    }
    return true
  })

  return (
    <div className="flex h-[calc(100vh-160px)] rounded-xl border border-gray-100 bg-white overflow-hidden animate-in fade-in duration-300">
      {/* Sidebar */}
      <div className="w-80 border-r border-gray-100 flex flex-col">
        <div className="p-3 border-b border-gray-100 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations..."
                className="w-full pl-7 pr-3 py-1.5 text-[11px] bg-gray-50 border-none rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
            </div>
            <button onClick={() => setShowNewConv(true)} title="New conversation"
              className="p-1.5 bg-np-blue text-white rounded-lg hover:bg-np-dark transition-colors">
              <Plus size={14} />
            </button>
          </div>
          <div className="flex gap-1">
            {['','sms','email','voice'].map(ch => (
              <button key={ch} onClick={() => setChannelFilter(ch)}
                className={`px-2 py-1 text-[9px] font-semibold rounded-md transition-all ${channelFilter===ch ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400'}`}>
                {ch ? ch.toUpperCase() : 'All'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loading ? <div className="text-center py-8 text-[10px] text-gray-400">Loading...</div>
          : filteredConvs.length === 0 ? <div className="text-center py-8 text-[10px] text-gray-400">No conversations</div>
          : filteredConvs.map(c => <ConversationItem key={c.id} conv={c} isActive={activeConv===c.id} onClick={() => setActiveConv(c.id)} />)}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col">
        {activeConvData ? (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal/70 to-np-dark/70 flex items-center justify-center text-[10px] font-bold text-white">
                  {`${activeConvData.contacts.first_name?.[0]||''}${activeConvData.contacts.last_name?.[0]||''}`.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-np-dark">{activeConvData.contacts.first_name} {activeConvData.contacts.last_name}</p>
                  <p className="text-[10px] text-gray-400">{activeConvData.contacts.phone || activeConvData.contacts.email}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button className="p-1.5 rounded-lg hover:bg-gray-50"><BellOff size={14} className="text-gray-400" /></button>
                <button className="p-1.5 rounded-lg hover:bg-gray-50"><Archive size={14} className="text-gray-400" /></button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {messages.map(m => <MessageBubble key={m.id} msg={m} />)}
              <div ref={messagesEndRef} />
            </div>

            {/* Compose */}
            <div className="px-4 py-3 border-t border-gray-100">
              <div className="flex items-end gap-2">
                <textarea value={newMsg} onChange={e => setNewMsg(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  placeholder="Type a message..." rows={1}
                  className="flex-1 px-3 py-2 text-xs bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-1 focus:ring-teal/30 resize-none" />
                <button onClick={handleSend} disabled={!newMsg.trim() || sending}
                  className="p-2.5 bg-np-blue text-white rounded-xl hover:bg-np-dark disabled:opacity-40 transition-colors">
                  <Send size={14} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageCircle size={40} className="mx-auto text-gray-400/20 mb-3" />
              <p className="text-sm text-gray-400">Select a conversation</p>
              <p className="text-[10px] text-gray-400 mt-1">or start a new one</p>
            </div>
          </div>
        )}
      </div>

      {/* ── New Conversation Modal ── */}
      {showNewConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">New Conversation</h3>
              <button onClick={() => { setShowNewConv(false); setContactSearch(''); setContactResults([]) }} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Search Contact</label>
              <div className="relative mt-1">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={contactSearch} onChange={e => searchContacts(e.target.value)} placeholder="Name, email, or phone..."
                  className="w-full pl-8 pr-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
              </div>
            </div>
            <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
              {searchingContacts && <p className="text-[10px] text-gray-400 text-center py-3">Searching...</p>}
              {contactResults.map(c => (
                <button key={c.id} onClick={() => startConversation(c)}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-gray-50 text-left transition-colors">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal to-np-dark flex items-center justify-center text-[9px] font-bold text-white">
                    {`${c.first_name?.[0]||''}${c.last_name?.[0]||''}`.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-np-dark">{c.first_name} {c.last_name}</p>
                    <p className="text-[10px] text-gray-400">{c.phone || c.email}</p>
                  </div>
                </button>
              ))}
              {contactSearch.length >= 2 && !searchingContacts && contactResults.length === 0 && (
                <p className="text-[10px] text-gray-400 text-center py-3">No contacts found</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

// ═══════════════════════════════════════════════════════════════
// Help Bot — Floating chat widget for platform help
// Renders bottom-right on every page, logs all questions,
// suggests tutorials, supports multi-turn conversation
// ═══════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import {
  MessageCircleQuestion, X, Send, ThumbsUp, ThumbsDown,
  BookOpen, Loader2, ChevronRight, Sparkles
} from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  category?: string
  helpId?: string
  feedback?: boolean | null
}

interface Tutorial {
  id: string
  title: string
  description: string
  target_page: string
  steps: { title: string; content: string; page_path?: string }[]
}

export function HelpBot() {
  const pathname = usePathname()
  const { currentOrg } = useWorkspace()
  const supabase = createClient()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [tutorials, setTutorials] = useState<Tutorial[]>([])
  const [activeTutorial, setActiveTutorial] = useState<Tutorial | null>(null)
  const [tutorialStep, setTutorialStep] = useState(0)
  const [showTutorials, setShowTutorials] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load published tutorials
  useEffect(() => {
    if (!currentOrg || !open) return
    supabase
      .from('tutorials')
      .select('id, title, description, target_page, steps')
      .eq('org_id', currentOrg.id)
      .eq('is_published', true)
      .limit(20)
      .then(({ data }) => setTutorials((data as Tutorial[]) || []))
  }, [currentOrg?.id, open])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading || !currentOrg) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    // Build history for multi-turn
    const history = messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const res = await fetch('/api/ai/help-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userMsg.content,
          page_context: pathname,
          org_id: currentOrg.id,
          history,
        }),
      })

      const data = await res.json()

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer || 'Sorry, something went wrong.',
        category: data.category,
        feedback: null,
      }
      setMessages(prev => [...prev, assistantMsg])

      // Check if any tutorials match the question
      const q = userMsg.content.toLowerCase()
      const matchedTutorial = tutorials.find(t =>
        t.target_page === pathname ||
        t.title.toLowerCase().includes(q.split(' ').find(w => w.length > 3) || '')
      )
      if (matchedTutorial) {
        const suggestMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `📖 I have a tutorial that might help: **${matchedTutorial.title}**`,
          category: 'tutorial_suggestion',
        }
        setMessages(prev => [...prev, suggestMsg])
      }
    } catch {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I had trouble connecting. Please try again.',
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, currentOrg, pathname, messages, tutorials])

  const handleFeedback = async (msgId: string, helpful: boolean) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedback: helpful } : m))
    // Update in database
    const msg = messages.find(m => m.id === msgId)
    if (msg?.role === 'assistant') {
      // Find the corresponding help_request and update
      await supabase
        .from('help_requests')
        .update({ helpful })
        .eq('answer', msg.content)
        .eq('org_id', currentOrg?.id || '')
        .order('occurred_at', { ascending: false })
        .limit(1)
    }
  }

  const startTutorial = (tutorial: Tutorial) => {
    setActiveTutorial(tutorial)
    setTutorialStep(0)
    setShowTutorials(false)
    // Log view
    supabase
      .from('tutorials')
      .update({ view_count: tutorial.steps.length }) // increment happens server-side ideally
      .eq('id', tutorial.id)
  }

  const closeTutorial = () => {
    setActiveTutorial(null)
    setTutorialStep(0)
  }

  // ─── Render ───
  return (
    <>
      {/* Tutorial Overlay */}
      {activeTutorial && (
        <div className="fixed inset-0 z-[60] pointer-events-none">
          <div className="absolute bottom-24 right-6 w-96 pointer-events-auto">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
              {/* Tutorial header */}
              <div className="bg-gradient-to-r from-np-blue to-teal p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen size={16} className="text-white" />
                    <span className="text-sm font-bold text-white">{activeTutorial.title}</span>
                  </div>
                  <button onClick={closeTutorial} className="text-white/70 hover:text-white">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex gap-1 mt-3">
                  {activeTutorial.steps.map((_, i) => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-all ${
                      i <= tutorialStep ? 'bg-white' : 'bg-white/30'
                    }`} />
                  ))}
                </div>
              </div>

              {/* Step content */}
              <div className="p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1">
                  Step {tutorialStep + 1} of {activeTutorial.steps.length}
                </p>
                <h4 className="text-sm font-bold text-np-dark mb-2">
                  {activeTutorial.steps[tutorialStep].title}
                </h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {activeTutorial.steps[tutorialStep].content}
                </p>
                {activeTutorial.steps[tutorialStep].page_path && (
                  <p className="text-[10px] text-np-blue mt-2 font-medium">
                    📍 Navigate to: {activeTutorial.steps[tutorialStep].page_path}
                  </p>
                )}
              </div>

              {/* Step navigation */}
              <div className="flex items-center justify-between px-4 pb-4">
                <button
                  onClick={() => setTutorialStep(s => Math.max(0, s - 1))}
                  disabled={tutorialStep === 0}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30"
                >
                  Back
                </button>
                {tutorialStep < activeTutorial.steps.length - 1 ? (
                  <button
                    onClick={() => setTutorialStep(s => s + 1)}
                    className="flex items-center gap-1 px-4 py-1.5 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-blue/90"
                  >
                    Next <ChevronRight size={12} />
                  </button>
                ) : (
                  <button
                    onClick={closeTutorial}
                    className="px-4 py-1.5 bg-green-500 text-white text-xs font-medium rounded-lg hover:bg-green-600"
                  >
                    Done ✓
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat Panel */}
      {open && !activeTutorial && (
        <div className="fixed bottom-24 right-6 z-50 w-96 animate-in slide-in-from-bottom-4 duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col" style={{ maxHeight: '520px' }}>
            {/* Header */}
            <div className="bg-gradient-to-r from-np-blue to-teal p-4 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <Sparkles size={16} className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">NPU Help</h3>
                  <p className="text-[10px] text-white/70">Ask anything about the platform</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setShowTutorials(!showTutorials)}
                  className="p-1.5 text-white/70 hover:text-white rounded-lg hover:bg-white/10" title="Tutorials">
                  <BookOpen size={14} />
                </button>
                <button onClick={() => setOpen(false)} className="p-1.5 text-white/70 hover:text-white rounded-lg hover:bg-white/10">
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Tutorial list panel */}
            {showTutorials && (
              <div className="border-b border-gray-100 bg-gray-50 p-3 flex-shrink-0 max-h-48 overflow-y-auto">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Available Tutorials</p>
                {tutorials.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">No tutorials yet</p>
                ) : tutorials.map(t => (
                  <button key={t.id} onClick={() => startTutorial(t)}
                    className="w-full flex items-start gap-2 p-2 rounded-lg hover:bg-white text-left transition-colors mb-1">
                    <BookOpen size={12} className="text-np-blue flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-np-dark">{t.title}</p>
                      <p className="text-[10px] text-gray-400">{t.description}</p>
                    </div>
                    <ChevronRight size={12} className="text-gray-300 flex-shrink-0 mt-0.5 ml-auto" />
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0" style={{ maxHeight: '320px' }}>
              {messages.length === 0 && (
                <div className="text-center py-6">
                  <MessageCircleQuestion size={28} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-xs text-gray-400 mb-3">Ask me anything about NPU Hub</p>
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {['How do I add a contact?', 'How do sequences work?', 'Where are my tasks?'].map(q => (
                      <button key={q} onClick={() => { setInput(q); setTimeout(() => sendMessage(), 50) }}
                        className="px-2.5 py-1 text-[10px] bg-gray-50 text-gray-500 rounded-full hover:bg-np-blue/10 hover:text-np-blue transition-colors">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-np-blue text-white rounded-2xl rounded-br-md px-3 py-2'
                      : 'bg-gray-50 text-np-dark rounded-2xl rounded-bl-md px-3 py-2'
                  }`}>
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    {msg.role === 'assistant' && msg.feedback === null && msg.category !== 'tutorial_suggestion' && (
                      <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-gray-100/50">
                        <span className="text-[9px] text-gray-400 mr-1">Helpful?</span>
                        <button onClick={() => handleFeedback(msg.id, true)}
                          className="p-0.5 text-gray-300 hover:text-green-500 transition-colors">
                          <ThumbsUp size={10} />
                        </button>
                        <button onClick={() => handleFeedback(msg.id, false)}
                          className="p-0.5 text-gray-300 hover:text-red-500 transition-colors">
                          <ThumbsDown size={10} />
                        </button>
                      </div>
                    )}
                    {msg.feedback === true && (
                      <p className="text-[9px] text-green-500 mt-1">✓ Thanks for the feedback!</p>
                    )}
                    {msg.feedback === false && (
                      <p className="text-[9px] text-amber-500 mt-1">Noted — we'll improve this area</p>
                    )}
                    {msg.category === 'tutorial_suggestion' && (
                      <button onClick={() => {
                        const t = tutorials.find(t => msg.content.includes(t.title))
                        if (t) startTutorial(t)
                      }}
                        className="mt-1.5 flex items-center gap-1 text-[10px] text-np-blue font-medium hover:underline">
                        <BookOpen size={10} /> Start Tutorial →
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-50 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-100 p-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                  placeholder="Ask a question..."
                  className="flex-1 px-3 py-2 text-xs bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                />
                <button onClick={sendMessage} disabled={!input.trim() || loading}
                  className="p-2 bg-np-blue text-white rounded-xl hover:bg-np-blue/90 disabled:opacity-40 transition-all">
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Button */}
      {!activeTutorial && (
        <button
          onClick={() => setOpen(!open)}
          className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 ${
            open ? 'bg-gray-600 rotate-0' : 'bg-gradient-to-br from-np-blue to-teal'
          }`}
        >
          {open ? <X size={22} className="text-white" /> : <MessageCircleQuestion size={22} className="text-white" />}
        </button>
      )}
    </>
  )
}

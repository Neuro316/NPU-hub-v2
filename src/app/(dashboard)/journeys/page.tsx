"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Slot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  available_count: number;
}

interface Participant {
  id: string;
  name: string;
  email: string;
  responded: boolean;
  token: string;
}

interface Poll {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  timezone: string;
  organizer_name: string;
  organizer_email: string;
  required_responses: number;
  current_responses: number;
  status: string;
  zoom_join_url: string | null;
}

interface Vote {
  slot_id: string;
  participant_id: string;
  available: boolean;
}

const formatDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const formatTime = (t: string) => {
  const [h, m] = t.split(":");
  const hr = parseInt(h);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
};

const getDayName = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });

const Check = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
    <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default function PollPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const shareToken = params.shareToken as string;
  const participantToken = searchParams.get("t");

  const [poll, setPoll] = useState<Poll | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentUser, setCurrentUser] = useState<Participant | null>(null);
  const [allVotes, setAllVotes] = useState<Vote[]>([]);
  const [votes, setVotes] = useState<Record<string, boolean>>({});
  const [view, setView] = useState("vote");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadPoll() {
      try {
        const { data: pollData, error: pollErr } = await supabase
          .from("scheduling_polls")
          .select("*")
          .eq("share_token", shareToken)
          .single();

        if (pollErr || !pollData) {
          setError("Poll not found");
          setLoading(false);
          return;
        }
        setPoll(pollData);

        const { data: slotData } = await supabase
          .from("scheduling_slots")
          .select("*")
          .eq("poll_id", pollData.id)
          .order("slot_date", { ascending: true })
          .order("start_time", { ascending: true });
        setSlots(slotData || []);

        const { data: partData } = await supabase
          .from("scheduling_participants")
          .select("*")
          .eq("poll_id", pollData.id);
        setParticipants(partData || []);

        if (participantToken) {
          const me = partData?.find((p: Participant) => p.token === participantToken);
          if (me) {
            setCurrentUser(me);
            if (me.responded) setSubmitted(true);
          }
        }

        const { data: voteData } = await supabase
          .from("scheduling_votes")
          .select("*")
          .eq("poll_id", pollData.id);
        setAllVotes(voteData || []);

        setLoading(false);
      } catch (e) {
        setError("Failed to load poll");
        setLoading(false);
      }
    }
    loadPoll();
  }, [shareToken, participantToken]);

  const grouped = slots.reduce<Record<string, Slot[]>>((a, s) => {
    if (!a[s.slot_date]) a[s.slot_date] = [];
    a[s.slot_date].push(s);
    return a;
  }, {});

  const toggleVote = (id: string) => {
    setVotes({ ...votes, [id]: !votes[id] });
  };

  const anySelected = slots.some((s) => votes[s.id] === true);

  const handleSubmit = useCallback(async () => {
    if (!anySelected || isSubmitting || !currentUser || !poll) return;
    setIsSubmitting(true);

    try {
      const voteRecords = slots.map((slot) => ({
        poll_id: poll.id,
        participant_id: currentUser.id,
        slot_id: slot.id,
        available: votes[slot.id] === true,
      }));

      const { error: voteErr } = await supabase
        .from("scheduling_votes")
        .upsert(voteRecords, { onConflict: "participant_id,slot_id" });

      if (voteErr) throw voteErr;

      await supabase
        .from("scheduling_participants")
        .update({ responded: true, responded_at: new Date().toISOString() })
        .eq("id", currentUser.id);

      setSubmitted(true);
      setView("confirmed");

      const { data: updatedPoll } = await supabase
        .from("scheduling_polls")
        .select("*")
        .eq("id", poll.id)
        .single();
      if (updatedPoll) setPoll(updatedPoll);

      const { data: updatedVotes } = await supabase
        .from("scheduling_votes")
        .select("*")
        .eq("poll_id", poll.id);
      if (updatedVotes) setAllVotes(updatedVotes);

      const { data: updatedSlots } = await supabase
        .from("scheduling_slots")
        .select("*")
        .eq("poll_id", poll.id)
        .order("slot_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (updatedSlots) setSlots(updatedSlots);

      if (updatedPoll?.status === "complete" || updatedPoll?.status === "scheduled") {
        setView("scheduled");
      }
    } catch (e) {
      alert("Error submitting votes. Please try again.");
    }
    setIsSubmitting(false);
  }, [anySelected, isSubmitting, currentUser, poll, slots, votes]);

  const getParticipantVotes = (participantId: string) => {
    return allVotes.filter((v) => v.participant_id === participantId);
  };

  const getBestSlot = () => {
    if (!slots.length) return null;
    const sorted = [...slots].sort((a, b) => b.available_count - a.available_count);
    return sorted[0].available_count > 0 ? sorted[0] : null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading poll...</p>
        </div>
      </div>
    );
  }

  if (error || !poll) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center max-w-md">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Poll Not Found</h2>
          <p className="text-gray-500">{error || "This poll may have been deleted or the link is invalid."}</p>
        </div>
      </div>
    );
  }

  const bestSlot = getBestSlot();
  const respondedParticipants = participants.filter((p) => p.responded);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex items-start justify-center p-4 pt-6">
      <div className="w-full max-w-2xl">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center text-white font-bold text-lg">
                {poll.organizer_name[0]}
              </div>
              <div>
                <p className="text-white/70 text-xs font-medium tracking-wide uppercase">Scheduling Poll from</p>
                <p className="text-white font-semibold">{poll.organizer_name}</p>
              </div>
              <div className="ml-auto flex items-center gap-2 bg-white/15 backdrop-blur rounded-full px-3 py-1.5">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="white" strokeWidth="1.5"/><path d="M1 14C1 11.24 3.24 9 6 9C8.76 9 11 11.24 11 14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
                <span className="text-white text-xs font-medium">
                  {poll.current_responses}/{poll.required_responses} responded
                </span>
              </div>
            </div>
          </div>

          {/* Meeting Info */}
          <div className="px-6 py-5 border-b border-gray-100">
            <h1 className="text-xl font-bold text-gray-900 mb-2">{poll.title}</h1>
            {poll.description && <p className="text-gray-500 text-sm mb-4">{poll.description}</p>}
            <div className="flex flex-wrap gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5V8L10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                {poll.duration_minutes} min
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3.5" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M11 6.5L15 4.5V11.5L11 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                Zoom
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 4V8H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                {poll.timezone}
              </span>
            </div>
          </div>

          {/* No participant token */}
          {!currentUser && !submitted && (
            <div className="p-6 text-center">
              <p className="text-gray-500">This poll requires a valid participant link to vote.</p>
            </div>
          )}

          {/* Confirmed View */}
          {view === "confirmed" && (
            <div className="text-center py-12 px-6">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M10 20L17 27L30 13" stroke="#059669" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">You are all set!</h2>
              <p className="text-gray-500 mb-6 max-w-sm mx-auto">
                Your availability has been submitted. Once all {poll.required_responses} participants respond, a calendar invite with Zoom link will be sent automatically.
              </p>
              <div className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full px-5 py-2.5 text-sm text-gray-600">
                {poll.current_responses} of {poll.required_responses} responded
              </div>
            </div>
          )}

          {/* Scheduled View */}
          {view === "scheduled" && (
            <div className="text-center py-12 px-6">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M10 20L17 27L30 13" stroke="#059669" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Meeting Scheduled!</h2>
              <p className="text-gray-500 mb-6">Everyone responded. Your meeting is confirmed.</p>
              {bestSlot && (
                <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-sm mx-auto text-left space-y-3">
                  <h3 className="font-semibold text-gray-900">{poll.title}</h3>
                  <p className="text-sm text-gray-600 flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M2 8H18" stroke="currentColor" strokeWidth="1.5"/></svg>
                    {formatDate(bestSlot.slot_date)}, {formatTime(bestSlot.start_time)} - {formatTime(bestSlot.end_time)}
                  </p>
                  {poll.zoom_join_url && (
                    <a href={poll.zoom_join_url} className="text-sm text-blue-600 flex items-center gap-2 underline">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3.5" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M11 6.5L15 4.5V11.5L11 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                      Join Zoom Meeting
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Voting View */}
          {view === "vote" && currentUser && !submitted && (
            <div className="p-6">
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6">
                <button onClick={() => setView("vote")} className="flex-1 py-2 px-4 rounded-md text-sm font-medium bg-white shadow-sm text-gray-900">Your Availability</button>
                <button onClick={() => setView("results")} className="flex-1 py-2 px-4 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700">Group Results</button>
              </div>

              <p className="text-sm text-gray-500 mb-5">Tap the times you are available. Leave unselected if you cannot make it.</p>

              <div className="space-y-5">
                {Object.entries(grouped).map(([date, daySlots]) => (
                  <div key={date}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-sm font-semibold text-gray-800">{getDayName(date)}</span>
                      <span className="text-xs text-gray-400">{formatDate(date)}</span>
                    </div>
                    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${daySlots.length}, 1fr)` }}>
                      {daySlots.map((slot) => (
                        <div key={slot.id} className="space-y-1.5">
                          <div className="text-center text-xs text-gray-500 font-medium">{formatTime(slot.start_time)}</div>
                          <button
                            onClick={() => toggleVote(slot.id)}
                            disabled={submitted}
                            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 border-2 ${
                              votes[slot.id]
                                ? "bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-200"
                                : "bg-white border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50"
                            } cursor-pointer active:scale-95`}
                          >
                            {votes[slot.id] ? <><Check /><span>Available</span></> : <span>Select</span>}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {Object.keys(votes).length > 0 && (
                <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                    <span className="text-emerald-700 text-xs font-bold">{Object.values(votes).filter((v) => v).length}</span>
                  </div>
                  <span>{Object.values(votes).filter((v) => v).length} time{Object.values(votes).filter((v) => v).length !== 1 ? "s" : ""} selected</span>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={!anySelected || isSubmitting}
                className={`w-full mt-6 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
                  anySelected && !isSubmitting
                    ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200 hover:shadow-xl active:scale-[0.98]"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Submitting...
                  </span>
                ) : anySelected ? "Submit Availability" : "Select at least one available time"}
              </button>
            </div>
          )}

          {/* Results View */}
          {view === "results" && currentUser && (
            <div className="p-6">
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6">
                <button onClick={() => setView("vote")} className="flex-1 py-2 px-4 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700">Your Availability</button>
                <button onClick={() => setView("results")} className="flex-1 py-2 px-4 rounded-md text-sm font-medium bg-white shadow-sm text-gray-900">Group Results</button>
              </div>

              <div className="flex items-center gap-4 mb-4 text-sm text-gray-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-emerald-400 bg-emerald-100" /> Available</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-red-200 bg-red-50" /> Not available</span>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <div className="w-32 flex-shrink-0" />
                <div className="flex-1 grid gap-2" style={{ gridTemplateColumns: `repeat(${slots.length}, 1fr)` }}>
                  {slots.map((s) => (
                    <div key={s.id} className="text-center">
                      <div className="text-xs font-semibold text-gray-700">{formatDate(s.slot_date).split(",")[0]}</div>
                      <div className="text-xs text-gray-400">{formatTime(s.start_time)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="divide-y divide-gray-50">
                {respondedParticipants.map((p) => {
                  const pVotes = getParticipantVotes(p.id);
                  return (
                    <div key={p.id} className="flex items-center gap-2 py-2.5">
                      <div className="w-32 flex-shrink-0 flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white bg-indigo-500">{p.name[0]}</div>
                        <span className="text-sm text-gray-700 truncate font-medium">{p.id === currentUser?.id ? "You" : p.name}</span>
                      </div>
                      <div className="flex-1 grid gap-2" style={{ gridTemplateColumns: `repeat(${slots.length}, 1fr)` }}>
                        {slots.map((slot) => {
                          const vote = pVotes.find((v) => v.slot_id === slot.id);
                          const available = vote?.available;
                          return (
                            <div key={slot.id} className={`h-8 rounded-lg border-2 flex items-center justify-center ${
                              available ? "bg-emerald-100 border-emerald-400" : "bg-red-50 border-red-200"
                            }`}>
                              {available ? (
                                <span className="text-emerald-600"><Check /></span>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="#f87171" strokeWidth="2" strokeLinecap="round" /></svg>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {bestSlot && (
                <div className="mt-5 p-4 rounded-xl border bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-sm font-semibold text-emerald-800">
                      Best Time ({bestSlot.available_count} of {respondedParticipants.length} available)
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-emerald-700 font-medium">
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M2 8H18" stroke="currentColor" strokeWidth="1.5"/><path d="M6 2V5M14 2V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    <span>{formatDate(bestSlot.slot_date)}, {formatTime(bestSlot.start_time)} - {formatTime(bestSlot.end_time)}</span>
                  </div>
                </div>
              )}

              {!submitted && (
                <button onClick={() => setView("vote")} className="w-full mt-6 py-3 rounded-xl font-semibold text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all">
                  Back to Voting
                </button>
              )}
            </div>
          )}

          {/* Already submitted landing */}
          {submitted && view === "vote" && (
            <div className="text-center py-12 px-6">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M10 20L17 27L30 13" stroke="#059669" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Already Submitted</h2>
              <p className="text-gray-500 mb-6">You have already submitted your availability for this poll.</p>
              <button onClick={() => setView("results")} className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-indigo-700 transition-all">
                View Group Results
              </button>
            </div>
          )}
        </div>
        <div className="text-center mt-4 text-xs text-gray-400">Powered by Neuro Progeny Scheduling</div>
      </div>
    </div>
  );
}

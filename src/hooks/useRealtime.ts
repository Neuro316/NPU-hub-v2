import { useEffect, useState } from 'react';
import { createClient as createClientSupabase } from '@/lib/supabase-browser';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

type TableName = 'messages' | 'call_logs' | 'conversations' | 'tasks' | 'activity_log';

export function useRealtimeSubscription<T extends Record<string, unknown>>(
  table: TableName,
  filter?: { column: string; value: string },
  callback?: (payload: RealtimePostgresChangesPayload<T>) => void
) {
  const [latestChange, setLatestChange] = useState<RealtimePostgresChangesPayload<T> | null>(null);

  useEffect(() => {
    const supabase = createClientSupabase();

    let channelConfig: any = {
      event: '*',
      schema: 'public',
      table,
    };

    if (filter) {
      channelConfig.filter = `${filter.column}=eq.${filter.value}`;
    }

    const channel = supabase
      .channel(`realtime-${table}-${filter?.value || 'all'}`)
      .on('postgres_changes', channelConfig, (payload: any) => {
        setLatestChange(payload);
        callback?.(payload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter?.column, filter?.value]);

  return latestChange;
}

// Hook for unread message count
export function useUnreadCount(contactId?: string) {
  const [count, setCount] = useState(0);
  const supabase = createClientSupabase();

  useEffect(() => {
    async function fetch() {
      let query = supabase
        .from('conversations')
        .select('unread_count');

      if (contactId) {
        query = query.eq('contact_id', contactId);
      }

      const { data } = await query;
      setCount(data?.reduce((sum, c) => sum + (c.unread_count || 0), 0) || 0);
    }

    fetch();

    // Subscribe to changes
    const channel = supabase
      .channel('unread-count')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversations',
      }, () => {
        fetch(); // Refetch on any conversation update
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [contactId]);

  return count;
}

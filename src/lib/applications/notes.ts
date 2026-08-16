import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

export type ApplicationNote = {
  id: string;
  applicationId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export async function getApplicationNotes(
  applicationId: string,
  supabase: SupabaseClient<Database>,
): Promise<ApplicationNote[]> {
  const { data, error } = await supabase
    .from('application_notes')
    .select(
      'id, application_id, body, created_at, author:profiles!application_notes_author_id_fkey(name)',
    )
    .eq('application_id', applicationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[application] notes query failed', { applicationId, message: error.message });
    throw new Error('Could not load application notes.');
  }

  return ((data ?? []) as unknown as NoteRow[]).map(toApplicationNote);
}

type NoteRow = {
  id: string;
  application_id: string;
  body: string;
  created_at: string;
  author: { name: string } | { name: string }[] | null;
};

export function toApplicationNote(row: NoteRow): ApplicationNote {
  const author = Array.isArray(row.author) ? row.author[0] : row.author;
  return {
    id: row.id,
    applicationId: row.application_id,
    authorName: author?.name || 'Unknown author',
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

'use server';

import { toApplicationNote, type ApplicationNote } from '@/lib/applications/notes';
import { createClient } from '@/lib/supabase/server';

export type AddApplicationNoteResult =
  { ok: true; note: ApplicationNote } | { ok: false; error: string };

export async function addApplicationNote(
  applicationId: string,
  body: string,
): Promise<AddApplicationNoteResult> {
  const noteBody = body.trim();
  if (!noteBody || noteBody.length > 4000) {
    return {
      ok: false,
      error:
        noteBody.length > 4000 ? 'Notes must be 4,000 characters or fewer.' : 'Enter a note first.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const { data, error } = await supabase
    .from('application_notes')
    .insert({ application_id: applicationId, author_id: user.id, body: noteBody })
    .select(
      'id, application_id, body, created_at, author:profiles!application_notes_author_id_fkey(name)',
    )
    .single();

  if (error || !data) {
    console.error('[application] add note failed', {
      applicationId,
      message: error?.message ?? 'Insert returned no row',
    });
    return { ok: false, error: 'Could not add this note. Try again.' };
  }

  return {
    ok: true,
    note: toApplicationNote(data as unknown as Parameters<typeof toApplicationNote>[0]),
  };
}

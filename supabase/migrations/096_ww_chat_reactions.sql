-- Group chat message reactions — double-tap to like in the Walk & Water community chat.
-- One like per user per message. Read-all, write-own.

CREATE TABLE IF NOT EXISTS ww_chat_message_reactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES ww_chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ww_chat_reactions_message
  ON ww_chat_message_reactions(message_id);

ALTER TABLE ww_chat_message_reactions ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can see all likes (to render counts).
CREATE POLICY "ww_reactions_select" ON ww_chat_message_reactions
  FOR SELECT TO authenticated USING (true);

-- Users may only add their own like.
CREATE POLICY "ww_reactions_insert_own" ON ww_chat_message_reactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Users may only remove their own like.
CREATE POLICY "ww_reactions_delete_own" ON ww_chat_message_reactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- FULL replica identity so realtime DELETE events carry message_id/user_id,
-- letting other clients decrement the like count live (not just the row id).
ALTER TABLE ww_chat_message_reactions REPLICA IDENTITY FULL;

-- Stream inserts/deletes to clients for live like counts.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ww_chat_message_reactions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

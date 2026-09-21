-- Add "superseded" as a TicketStatus value.
--
-- Used to unify multiple inbound emails from the same customer into a
-- single active ticket: when a customer already has an open (non-terminal)
-- ticket and sends another email, the new email becomes the active ticket
-- and any older open ticket(s) for that customer are marked "superseded"
-- instead of staying listed as separate pending tickets. Superseded tickets
-- are excluded from every inbox queue/count, but remain in the database and
-- still appear in the customer's unified thread ("Hilo") view.
ALTER TYPE "TicketStatus" ADD VALUE 'superseded';

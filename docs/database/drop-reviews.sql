-- =====================================================================
-- Drop the reviews table (runs after 0007 and the other docs/database SQL files)
--
-- The review feature was removed from the app (PR #31). On 2026-11-15 the live table had
-- 0 rows, and no view, trigger, foreign key or function used it. Its three policies
-- ("reviews public", "reviews insert", "reviews delete admin") go with the table.
--
-- Plain DROP (no CASCADE): if anything did depend on the table, this fails instead of
-- silently dropping it too. Re-runnable.
--
-- The reviews_moderate admin permission is left in admin_permission_list() and existing
-- admin_members rows: removing it would mean changing the admin functions and data, and
-- it no longer grants anything.
-- =====================================================================

drop table if exists public.reviews;

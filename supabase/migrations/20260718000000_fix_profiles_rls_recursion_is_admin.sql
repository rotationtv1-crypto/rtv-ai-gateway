-- Fix infinite recursion in profiles RLS: the admin policy subqueried profiles itself.
-- Replace with SECURITY DEFINER helper that bypasses RLS for the role check.
-- Applied to project rotationtvai-ecosystem on 2026-07-18 via Supabase MCP.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role = 'admin'::text
  );
$$;

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
TO public
USING (public.is_admin());

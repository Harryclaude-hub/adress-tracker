-- 017: Selbst erstellte Mails duerfen bei zwei Eintraegen stehen. 25.11.2026.
--  * Mail ERHALTEN: nur bei einem einzigen Eintrag (wie bisher).
--  * Mail ERSTELLT: bei hoechstens zwei Eintraegen, wenn die Konten getrennt sind: Bet Online bei hoechstens einem Eintrag,
--    Stake bei hoechstens einem Eintrag. Sind beide Konten schon vergeben, ist die Mail voll.
--  * Alle Eintraege mit derselben Mail muessen "erstellt" sein. Gleiche Mail heisst: gleich nach Gross/Klein, ohne +Zusatz, bei Gmail ohne Punkte.
--  * Namen bleiben wie bisher in der ganzen Datenbank eindeutig.
-- Fehlermeldungen: mail_doppelt (erhalten oder gemischt), mail_voll (schon zwei Eintraege oder beide Konten vergeben),
--                  mail_konto_belegt (Bet Online oder Stake ist mit dieser Mail schon bei einem anderen Eintrag).

create or replace function tracker._eindeutig()
returns trigger
language plpgsql set search_path = ''
as $$
declare m text; k text; andere int; a_unerstellt boolean; a_bo boolean; a_st boolean;
begin
  perform pg_advisory_xact_lock(7311002);
  m := tracker._mail_schluessel(new.email);
  if m <> '' and (tg_op = 'INSERT'
       or m is distinct from tracker._mail_schluessel(old.email)
       or new.mail_status is distinct from old.mail_status
       or new.betonline is distinct from old.betonline
       or new.stake is distinct from old.stake) then
    select count(*), coalesce(bool_or(p.mail_status is distinct from 'erstellt'), false), coalesce(bool_or(p.betonline), false), coalesce(bool_or(p.stake), false)
      into andere, a_unerstellt, a_bo, a_st
      from tracker.person p
     where p.id <> new.id and tracker._mail_schluessel(p.email) = m;
    if andere > 0 then
      if new.mail_status is distinct from 'erstellt' or a_unerstellt then
        raise exception 'mail_doppelt' using errcode = '23505';
      end if;
      if andere >= 2 or (a_bo and a_st) then
        raise exception 'mail_voll' using errcode = '23505';
      end if;
      if (new.betonline and a_bo) or (new.stake and a_st) then
        raise exception 'mail_konto_belegt' using errcode = '23505';
      end if;
    end if;
  end if;
  k := tracker._name_schluessel(new.name);
  if k <> '' and (tg_op = 'INSERT' or k is distinct from tracker._name_schluessel(old.name)) then
    if exists (select 1 from tracker.person p where p.id <> new.id and tracker._name_schluessel(p.name) = k) then
      raise exception 'name_doppelt' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists person_eindeutig on tracker.person;
create trigger person_eindeutig before insert or update of name, email, mail_status, betonline, stake on tracker.person
  for each row execute function tracker._eindeutig();

revoke all on all functions in schema tracker from public, anon, authenticated;

-- FLO-136: commit the new enum label before policy migration uses it.
alter type public.participant_account_status add value 'pending';
